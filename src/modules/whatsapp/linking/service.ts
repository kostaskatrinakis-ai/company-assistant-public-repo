import { createHmac, randomBytes } from "node:crypto";
import {
  AuditActorSource,
  ChannelIdentityStatus,
  ChannelPairingSessionStatus,
  DomainEntityType,
  MessagingChannel,
} from "@prisma/client";
import { recordAuditEvent } from "@/modules/audit/service";
import type { SessionUser } from "@/shared/auth/types";
import { env } from "@/shared/config/env";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";

function getPairingSecret() {
  const secret = env.auth0Secret ?? env.localAuthSecret;
  if (!secret) {
    throw new Error("A signing secret is required for WhatsApp pairing.");
  }

  return secret;
}

export function normalizeWhatsAppAddress(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const compact = value.replace(/[^\d+]/g, "");
  return compact.length > 0 ? compact : null;
}

function hashPairingCode(code: string) {
  return createHmac("sha256", getPairingSecret())
    .update(code.replace(/[^A-Za-z0-9]/g, "").trim().toUpperCase())
    .digest("hex");
}

function generatePairingCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);

  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

export async function getUserWhatsAppLinkStatus(userId: string) {
  const db = await getDatabaseClient();
  const [identity, pendingSession] = await Promise.all([
    db.userChannelIdentity.findFirst({
      where: {
        userId,
        channel: MessagingChannel.WHATSAPP,
        status: ChannelIdentityStatus.VERIFIED,
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.channelPairingSession.findFirst({
      where: {
        userId,
        channel: MessagingChannel.WHATSAPP,
        status: ChannelPairingSessionStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    identity: identity
      ? {
          phoneNumber: identity.externalAddress,
          status: identity.status,
          verifiedAt: identity.verifiedAt?.toISOString() ?? null,
        }
      : null,
    pendingPairingExpiresAt: pendingSession?.expiresAt.toISOString() ?? null,
  };
}

export async function createWhatsAppPairingSession(user: SessionUser) {
  const db = await getDatabaseClient();
  const existingIdentity = await db.userChannelIdentity.findFirst({
    where: {
      userId: user.id,
      channel: MessagingChannel.WHATSAPP,
      status: ChannelIdentityStatus.VERIFIED,
    },
  });

  if (existingIdentity) {
    throw new BusinessRuleError(
      "WHATSAPP_ALREADY_LINKED",
      "Υπάρχει ήδη συνδεδεμένος WhatsApp αριθμός. Κάνε πρώτα αποσύνδεση.",
      409,
    );
  }

  await db.channelPairingSession.updateMany({
    where: {
      userId: user.id,
      channel: MessagingChannel.WHATSAPP,
      status: ChannelPairingSessionStatus.PENDING,
    },
    data: {
      status: ChannelPairingSessionStatus.REVOKED,
      revokedAt: new Date(),
    },
  });

  const code = generatePairingCode();
  const expiresAt = new Date(
    Date.now() + Math.max(5, env.whatsappPairingCodeTtlMinutes) * 60 * 1000,
  );

  await db.channelPairingSession.create({
    data: {
      userId: user.id,
      channel: MessagingChannel.WHATSAPP,
      pairingCodeHash: hashPairingCode(code),
      status: ChannelPairingSessionStatus.PENDING,
      expiresAt,
    },
  });

  await recordAuditEvent({
    actorUserId: user.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.UNKNOWN,
    entityId: user.id,
    eventName: "whatsapp.pairing.started",
    afterJson: {
      channel: MessagingChannel.WHATSAPP,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    code,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function revokeWhatsAppIdentity(user: SessionUser) {
  const db = await getDatabaseClient();
  const existingIdentity = await db.userChannelIdentity.findFirst({
    where: {
      userId: user.id,
      channel: MessagingChannel.WHATSAPP,
      status: ChannelIdentityStatus.VERIFIED,
    },
  });

  await db.channelPairingSession.updateMany({
    where: {
      userId: user.id,
      channel: MessagingChannel.WHATSAPP,
      status: ChannelPairingSessionStatus.PENDING,
    },
    data: {
      status: ChannelPairingSessionStatus.REVOKED,
      revokedAt: new Date(),
    },
  });

  if (!existingIdentity) {
    return {
      revoked: false,
    };
  }

  await db.userChannelIdentity.update({
    where: { id: existingIdentity.id },
    data: {
      status: ChannelIdentityStatus.REVOKED,
      revokedAt: new Date(),
    },
  });

  await recordAuditEvent({
    actorUserId: user.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.UNKNOWN,
    entityId: existingIdentity.id,
    eventName: "whatsapp.identity.revoked",
    afterJson: {
      phoneNumber: existingIdentity.externalAddress,
    },
  });

  return {
    revoked: true,
  };
}

export async function consumeWhatsAppPairingCode(input: {
  senderPhone: string;
  code: string;
}) {
  const normalizedPhone = normalizeWhatsAppAddress(input.senderPhone);
  if (!normalizedPhone) {
    throw new BusinessRuleError(
      "WHATSAPP_INVALID_PHONE",
      "Ο αριθμός WhatsApp δεν είναι έγκυρος.",
      422,
    );
  }

  const db = await getDatabaseClient();
  const pairingCodeHash = hashPairingCode(input.code);
  const session = await db.channelPairingSession.findFirst({
    where: {
      channel: MessagingChannel.WHATSAPP,
      pairingCodeHash,
      status: ChannelPairingSessionStatus.PENDING,
    },
    include: {
      user: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    throw new BusinessRuleError(
      "WHATSAPP_PAIRING_INVALID",
      "Ο κωδικός σύνδεσης δεν είναι έγκυρος.",
      404,
    );
  }

  if (session.expiresAt <= new Date()) {
    await db.channelPairingSession.update({
      where: { id: session.id },
      data: {
        status: ChannelPairingSessionStatus.EXPIRED,
      },
    });

    throw new BusinessRuleError(
      "WHATSAPP_PAIRING_EXPIRED",
      "Ο κωδικός σύνδεσης έληξε. Δημιούργησε νέο από το app.",
      410,
    );
  }

  const conflictingIdentity = await db.userChannelIdentity.findFirst({
    where: {
      channel: MessagingChannel.WHATSAPP,
      externalAddress: normalizedPhone,
      status: ChannelIdentityStatus.VERIFIED,
      NOT: {
        userId: session.userId,
      },
    },
  });

  if (conflictingIdentity) {
    await db.channelPairingSession.update({
      where: { id: session.id },
      data: {
        attemptCount: {
          increment: 1,
        },
      },
    });

    throw new BusinessRuleError(
      "WHATSAPP_PHONE_ALREADY_LINKED",
      "Αυτός ο αριθμός είναι ήδη συνδεδεμένος με άλλον χρήστη.",
      409,
    );
  }

  const phoneConflict = await db.user.findFirst({
    where: {
      phoneNumber: normalizedPhone,
      NOT: {
        id: session.userId,
      },
    },
    select: { id: true },
  });

  if (phoneConflict) {
    throw new BusinessRuleError(
      "WHATSAPP_PHONE_ALREADY_LINKED",
      "Αυτός ο αριθμός είναι ήδη δηλωμένος σε άλλον χρήστη.",
      409,
    );
  }

  await db.userChannelIdentity.updateMany({
    where: {
      userId: session.userId,
      channel: MessagingChannel.WHATSAPP,
      status: ChannelIdentityStatus.VERIFIED,
    },
    data: {
      status: ChannelIdentityStatus.REVOKED,
      revokedAt: new Date(),
    },
  });

  const identity = await db.userChannelIdentity.upsert({
    where: {
      channel_externalAddress: {
        channel: MessagingChannel.WHATSAPP,
        externalAddress: normalizedPhone,
      },
    },
    update: {
      userId: session.userId,
      status: ChannelIdentityStatus.VERIFIED,
      verifiedAt: new Date(),
      revokedAt: null,
    },
    create: {
      userId: session.userId,
      channel: MessagingChannel.WHATSAPP,
      externalAddress: normalizedPhone,
      status: ChannelIdentityStatus.VERIFIED,
      verifiedAt: new Date(),
    },
  });

  await db.channelPairingSession.update({
    where: { id: session.id },
    data: {
      status: ChannelPairingSessionStatus.CONSUMED,
      consumedAt: new Date(),
    },
  });

  await db.user.update({
    where: { id: session.userId },
    data: {
      phoneNumber: normalizedPhone,
    },
  });

  await recordAuditEvent({
    actorUserId: session.userId,
    actorSource: AuditActorSource.WHATSAPP,
    entityType: DomainEntityType.UNKNOWN,
    entityId: identity.id,
    eventName: "whatsapp.identity.verified",
    afterJson: {
      phoneNumber: normalizedPhone,
      channel: MessagingChannel.WHATSAPP,
    },
  });

  return {
    identityId: identity.id,
    phoneNumber: normalizedPhone,
    user: session.user,
  };
}

export async function findVerifiedUserByWhatsAppPhone(senderPhone: string) {
  const normalizedPhone = normalizeWhatsAppAddress(senderPhone);
  if (!normalizedPhone) {
    return null;
  }

  const db = await getDatabaseClient();
  return db.userChannelIdentity.findFirst({
    where: {
      channel: MessagingChannel.WHATSAPP,
      externalAddress: normalizedPhone,
      status: ChannelIdentityStatus.VERIFIED,
    },
    include: {
      user: true,
    },
  });
}

export async function touchWhatsAppIdentityActivity(input: {
  identityId: string;
  direction: "incoming" | "outgoing";
}) {
  const db = await getDatabaseClient();
  await db.userChannelIdentity.update({
    where: { id: input.identityId },
    data:
      input.direction === "incoming"
        ? {
            lastIncomingAt: new Date(),
          }
        : {
            lastOutgoingAt: new Date(),
          },
  });
}
