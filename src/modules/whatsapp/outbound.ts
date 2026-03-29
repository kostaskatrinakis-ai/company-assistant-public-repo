import {
  AuditActorSource,
  DomainEntityType,
  WhatsAppDetectedActorType,
  WhatsAppDirection,
  WhatsAppProcessedStatus,
} from "@prisma/client";
import { recordAuditEvent } from "@/modules/audit/service";
import type { SessionUser } from "@/shared/auth/types";
import { env } from "@/shared/config/env";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";

function normalizePhone(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  return compact.length > 0 ? compact : null;
}

export async function sendWhatsAppTextMessage(input: {
  to: string;
  body: string;
  actor?: SessionUser;
  linkedEntityType?: DomainEntityType;
  linkedEntityId?: string | null;
}) {
  const normalizedTo = normalizePhone(input.to);
  if (!normalizedTo) {
    throw new BusinessRuleError(
      "WHATSAPP_INVALID_PHONE",
      "Ο αριθμός τηλεφώνου για WhatsApp δεν είναι έγκυρος.",
      422,
    );
  }

  if (!env.whatsappPhoneNumberId || !env.whatsappAccessToken) {
    throw new BusinessRuleError(
      "WHATSAPP_NOT_CONFIGURED",
      "Το outbound WhatsApp δεν είναι ρυθμισμένο.",
      503,
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${env.whatsappGraphVersion}/${env.whatsappPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsappAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizedTo,
        type: "text",
        text: {
          body: input.body,
        },
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | {
        messages?: Array<{
          id?: string;
        }>;
        error?: {
          message?: string;
        };
      }
    | null;

  const db = await getDatabaseClient();
  const providerMessageId = payload?.messages?.[0]?.id ?? null;

  if (!response.ok) {
    await db.whatsAppMessage.create({
      data: {
        providerMessageId,
        direction: WhatsAppDirection.OUTGOING,
        senderPhone: null,
        receiverPhone: normalizedTo,
        body: input.body,
        linkedEntityType: input.linkedEntityType ?? DomainEntityType.UNKNOWN,
        linkedEntityId: input.linkedEntityId ?? null,
        detectedActorType: WhatsAppDetectedActorType.UNKNOWN,
        processedStatus: WhatsAppProcessedStatus.FAILED,
      },
    });

    throw new BusinessRuleError(
      "WHATSAPP_SEND_FAILED",
      payload?.error?.message ?? "Αποτυχία αποστολής WhatsApp μηνύματος.",
      502,
    );
  }

  const message = await db.whatsAppMessage.create({
    data: {
      providerMessageId,
      direction: WhatsAppDirection.OUTGOING,
      senderPhone: null,
      receiverPhone: normalizedTo,
      body: input.body,
      linkedEntityType: input.linkedEntityType ?? DomainEntityType.UNKNOWN,
      linkedEntityId: input.linkedEntityId ?? null,
      detectedActorType: WhatsAppDetectedActorType.INTERNAL_USER,
      processedStatus: WhatsAppProcessedStatus.LINKED,
    },
  });

  await recordAuditEvent({
    actorUserId: input.actor?.id ?? null,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.UNKNOWN,
    entityId: message.id,
    eventName: "whatsapp.outbound.sent",
    afterJson: {
      id: message.id,
      providerMessageId: message.providerMessageId,
      receiverPhone: message.receiverPhone,
      linkedEntityType: message.linkedEntityType,
      linkedEntityId: message.linkedEntityId,
    },
  });

  return {
    id: message.id,
    providerMessageId: message.providerMessageId,
    receiverPhone: message.receiverPhone,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}
