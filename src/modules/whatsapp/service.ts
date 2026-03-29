import {
  AssistantChannel,
  DomainEntityType,
  WhatsAppDetectedActorType,
  WhatsAppDirection,
  WhatsAppProcessedStatus,
} from "@prisma/client";
import {
  approveAssistantActionRequest,
  sendAssistantMessage,
  rejectAssistantActionRequest,
} from "@/modules/assistant/service";
import { sendWhatsAppTextMessage } from "@/modules/whatsapp/outbound";
import {
  consumeWhatsAppPairingCommand,
  getWhatsAppProviderCookie,
  markWhatsAppIdentityIncoming,
  markWhatsAppIdentityOutgoing,
  resolveVerifiedWhatsAppIdentity,
} from "@/modules/whatsapp/linking";
import { env } from "@/shared/config/env";
import { getDatabaseClient } from "@/shared/db/readiness";

type RawWhatsAppMessage = {
  id?: unknown;
  from?: unknown;
  timestamp?: unknown;
  text?: {
    body?: unknown;
  };
};

type RawWhatsAppChangeValue = {
  metadata?: {
    display_phone_number?: unknown;
  };
  messages?: RawWhatsAppMessage[];
};

function normalizePhone(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const compact = value.replace(/[^\d+]/g, "");
  return compact.length > 0 ? compact : null;
}

function getMessageBody(message: RawWhatsAppMessage) {
  if (typeof message.text?.body === "string" && message.text.body.trim().length > 0) {
    return message.text.body.trim();
  }

  return JSON.stringify(message);
}

function extractIncomingMessages(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const entries = Array.isArray((payload as { entry?: unknown[] }).entry)
    ? ((payload as { entry: unknown[] }).entry as unknown[])
    : [];

  return entries.flatMap((entry) => {
    const changes = Array.isArray((entry as { changes?: unknown[] }).changes)
      ? ((entry as { changes: unknown[] }).changes as unknown[])
      : [];

    return changes.flatMap((change) => {
      const value =
        typeof (change as { value?: unknown }).value === "object" &&
        (change as { value?: unknown }).value !== null
          ? ((change as { value: RawWhatsAppChangeValue }).value as RawWhatsAppChangeValue)
          : null;

      if (!value?.messages?.length) {
        return [];
      }

      return value.messages.map((message) => ({
        providerMessageId:
          typeof message.id === "string" && message.id.trim().length > 0
            ? message.id.trim()
            : null,
        senderPhone: normalizePhone(message.from),
        receiverPhone: normalizePhone(value.metadata?.display_phone_number),
        body: getMessageBody(message),
        receivedAt:
          typeof message.timestamp === "string" && /^\d+$/.test(message.timestamp)
            ? new Date(Number(message.timestamp) * 1000)
            : new Date(),
      }));
    });
  });
}

function detectLocaleFromMessage(body: string) {
  return /[Α-Ωα-ω]/.test(body) ? "el" : "en";
}

function parseDecisionCommand(body: string) {
  const match = body.trim().match(/^(approve|reject)\s+([a-z0-9]+)$/i);
  if (!match) {
    return null;
  }

  return {
    decision: match[1].toLowerCase() as "approve" | "reject",
    actionRequestId: match[2],
  };
}

export async function persistWhatsAppWebhookPayload(payload: unknown) {
  const db = await getDatabaseClient();
  const messages = extractIncomingMessages(payload);
  const providerCookie = await getWhatsAppProviderCookie();

  let storedCount = 0;
  let duplicateCount = 0;

  for (const message of messages) {
    if (message.providerMessageId) {
      const existing = await db.whatsAppMessage.findUnique({
        where: { providerMessageId: message.providerMessageId },
        select: { id: true },
      });

      if (existing) {
        duplicateCount += 1;
        continue;
      }
    }

    const pairingResult = message.senderPhone
      ? await consumeWhatsAppPairingCommand({
          senderPhone: message.senderPhone,
          body: message.body,
        })
      : { handled: false as const };

    if (pairingResult.handled) {
      await db.whatsAppMessage.create({
        data: {
          providerMessageId: message.providerMessageId,
          direction: WhatsAppDirection.INCOMING,
          senderPhone: message.senderPhone,
          receiverPhone: message.receiverPhone,
          body: message.body,
          linkedEntityType: DomainEntityType.UNKNOWN,
          linkedEntityId: null,
          detectedActorType: pairingResult.success
            ? WhatsAppDetectedActorType.INTERNAL_USER
            : WhatsAppDetectedActorType.UNKNOWN,
          processedStatus: pairingResult.success
            ? WhatsAppProcessedStatus.LINKED
            : WhatsAppProcessedStatus.FAILED,
          linkedUserId: pairingResult.success ? pairingResult.user.id : null,
          channelIdentityId:
            pairingResult.success && "identityId" in pairingResult
              ? pairingResult.identityId
              : null,
          processingNote: pairingResult.success
            ? "whatsapp-pairing-completed"
            : "whatsapp-pairing-failed",
          createdAt: message.receivedAt,
        },
      });

      if (message.senderPhone && pairingResult.message) {
        await sendWhatsAppTextMessage({
          to: message.senderPhone,
          body: pairingResult.message,
          linkedEntityType: DomainEntityType.UNKNOWN,
          linkedEntityId: null,
        }).catch(() => null);
      }

      storedCount += 1;
      continue;
    }

    const linkedIdentity = message.senderPhone
      ? await resolveVerifiedWhatsAppIdentity(message.senderPhone)
      : null;
    const linkedUser = linkedIdentity?.user ?? null;

    const inboundMessage = await db.whatsAppMessage.create({
      data: {
        providerMessageId: message.providerMessageId,
        direction: WhatsAppDirection.INCOMING,
        senderPhone: message.senderPhone,
        receiverPhone: message.receiverPhone,
        body: message.body,
        linkedEntityType: DomainEntityType.UNKNOWN,
        linkedEntityId: null,
        detectedActorType: linkedUser
          ? WhatsAppDetectedActorType.INTERNAL_USER
          : WhatsAppDetectedActorType.UNKNOWN,
        processedStatus: linkedUser
          ? WhatsAppProcessedStatus.PENDING
          : WhatsAppProcessedStatus.IGNORED,
        linkedUserId: linkedUser?.id ?? null,
        channelIdentityId: linkedIdentity?.identityId ?? null,
        processingNote: linkedUser
          ? "verified-whatsapp-identity"
          : "unknown-whatsapp-sender",
        createdAt: message.receivedAt,
      },
    });

    if (!linkedUser) {
      if (message.senderPhone) {
        await sendWhatsAppTextMessage({
          to: message.senderPhone,
          body:
            detectLocaleFromMessage(message.body) === "el"
              ? "Αυτός ο αριθμός δεν είναι συνδεδεμένος με εσωτερικό λογαριασμό. Άνοιξε το app, δημιούργησε pairing code και στείλε link CODE."
              : "This number is not linked to an internal account. Open the app, generate a pairing code, and send link CODE.",
          linkedEntityType: DomainEntityType.UNKNOWN,
          linkedEntityId: null,
        }).catch(() => null);
      }

      storedCount += 1;
      continue;
    }

    const verifiedIdentity = linkedIdentity;
    if (!verifiedIdentity) {
      storedCount += 1;
      continue;
    }

    await markWhatsAppIdentityIncoming(verifiedIdentity.identityId);

    if (!linkedUser.isActive || !linkedUser.permissions.includes("assistant.use")) {
      if (message.senderPhone) {
        await sendWhatsAppTextMessage({
          to: message.senderPhone,
          body:
            detectLocaleFromMessage(message.body) === "el"
              ? "Ο λογαριασμός σου δεν έχει πρόσβαση στον assistant μέσω WhatsApp."
              : "Your account does not have assistant access through WhatsApp.",
          actor: linkedUser,
          linkedEntityType: DomainEntityType.UNKNOWN,
          linkedEntityId: null,
        }).catch(() => null);
      }

      storedCount += 1;
      continue;
    }

    if (!providerCookie && !env.openAiApiKey) {
      if (message.senderPhone) {
        await sendWhatsAppTextMessage({
          to: message.senderPhone,
          body:
            detectLocaleFromMessage(message.body) === "el"
              ? "Ο assistant για το WhatsApp δεν είναι διαθέσιμος αυτή τη στιγμή. Ζήτησε από τον admin να ανανεώσει τη σύνδεση OpenAI."
              : "The WhatsApp assistant is not available right now. Ask an admin to refresh the OpenAI connection.",
          actor: linkedUser,
          linkedEntityType: DomainEntityType.UNKNOWN,
          linkedEntityId: null,
        }).catch(() => null);
      }

      await db.whatsAppMessage.update({
        where: { id: inboundMessage.id },
        data: {
          processedStatus: WhatsAppProcessedStatus.FAILED,
          processingNote: "missing-whatsapp-assistant-provider",
        },
      });

      storedCount += 1;
      continue;
    }

    try {
      const locale = detectLocaleFromMessage(message.body);
      const decisionCommand = parseDecisionCommand(message.body);

      if (decisionCommand && linkedUser.permissions.includes("assistant.execute_actions")) {
        const detail =
          decisionCommand.decision === "approve"
            ? await approveAssistantActionRequest({
                actionRequestId: decisionCommand.actionRequestId,
                user: linkedUser,
                locale,
              })
            : await rejectAssistantActionRequest({
                actionRequestId: decisionCommand.actionRequestId,
                user: linkedUser,
                locale,
              });

        const reply =
          detail?.assistantReply ??
          detail?.messages[detail.messages.length - 1]?.body ??
          (locale === "el"
            ? "Η ενέργεια ενημερώθηκε."
            : "The action was updated.");

        if (message.senderPhone) {
          await sendWhatsAppTextMessage({
            to: message.senderPhone,
            body: reply.slice(0, 1000),
            actor: linkedUser,
            linkedEntityType: DomainEntityType.ASSISTANT_CONVERSATION,
            linkedEntityId: detail?.conversation.id ?? null,
          });
          await markWhatsAppIdentityOutgoing(verifiedIdentity.identityId);
        }
      } else {
        const detail = await sendAssistantMessage({
          body: message.body,
          locale,
          channel: AssistantChannel.WHATSAPP,
          user: linkedUser,
          codexTokenCookie: providerCookie,
        });

        const reply =
          detail?.assistantReply ??
          detail?.messages[detail.messages.length - 1]?.body ??
          (locale === "el"
            ? "Δεν μπόρεσα να απαντήσω αυτή τη στιγμή."
            : "I could not answer right now.");

        if (message.senderPhone) {
          await sendWhatsAppTextMessage({
            to: message.senderPhone,
            body: reply.slice(0, 1000),
            actor: linkedUser,
            linkedEntityType: DomainEntityType.ASSISTANT_CONVERSATION,
            linkedEntityId: detail?.conversation.id ?? null,
          });
          await markWhatsAppIdentityOutgoing(verifiedIdentity.identityId);
        }
      }
    } catch (error) {
      const messageText =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "unknown-whatsapp-processing-error";

      await db.whatsAppMessage.update({
        where: { id: inboundMessage.id },
        data: {
          processedStatus: WhatsAppProcessedStatus.FAILED,
          processingNote: messageText.slice(0, 500),
        },
      });

      if (message.senderPhone) {
        await sendWhatsAppTextMessage({
          to: message.senderPhone,
          body:
            detectLocaleFromMessage(message.body) === "el"
              ? "Η επεξεργασία του μηνύματος απέτυχε. Δοκίμασε ξανά ή άνοιξε το app."
              : "Message processing failed. Try again or open the app.",
          actor: linkedUser,
          linkedEntityType: DomainEntityType.ASSISTANT_CONVERSATION,
          linkedEntityId: null,
        }).catch(() => null);
      }
    }

    storedCount += 1;
  }

  return {
    received: true,
    messageCount: messages.length,
    storedCount,
    duplicateCount,
  };
}
