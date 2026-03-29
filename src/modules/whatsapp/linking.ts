import type { SessionUser } from "@/shared/auth/types";
import { env } from "@/shared/config/env";
import {
  clearWhatsAppAssistantProvider,
  configureWhatsAppAssistantProviderFromCookie,
  getSharedWhatsAppAssistantCodexCookie,
  getWhatsAppAssistantProviderStatus,
} from "@/shared/config/assistant-provider";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getSessionUserById } from "@/modules/users/service";
import {
  consumeWhatsAppPairingCode,
  createWhatsAppPairingSession,
  findVerifiedUserByWhatsAppPhone,
  getUserWhatsAppLinkStatus,
  revokeWhatsAppIdentity,
  touchWhatsAppIdentityActivity,
} from "@/modules/whatsapp/linking/service";

const PAIRING_COMMAND_PATTERN = /^(?:link|pair)\s+([a-z0-9-]{6,20})$/i;

export type ResolvedWhatsAppIdentity = {
  identityId: string;
  phoneNumber: string;
  user: SessionUser;
};

async function buildProviderState() {
  const providerStatus = await getWhatsAppAssistantProviderStatus();
  const configuredBy = providerStatus.configuredByUserId
    ? await getSessionUserById(providerStatus.configuredByUserId)
    : null;

  return {
    configured: providerStatus.ready,
    configuredAt: providerStatus.configuredAt,
    configuredByName: configuredBy?.fullName ?? null,
  };
}

export async function getWhatsAppLinkStatus(user: SessionUser) {
  const [linkStatus, provider] = await Promise.all([
    getUserWhatsAppLinkStatus(user.id),
    buildProviderState(),
  ]);

  return {
    linkedIdentity: linkStatus.identity?.verifiedAt
      ? {
          phoneNumber: linkStatus.identity.phoneNumber,
          verifiedAt: linkStatus.identity.verifiedAt,
        }
      : null,
    pendingPairing: linkStatus.pendingPairingExpiresAt
      ? {
          expiresAt: linkStatus.pendingPairingExpiresAt,
        }
      : null,
    provider,
    businessNumber: env.whatsappDisplayPhoneNumber ?? null,
  };
}

export async function createWhatsAppPairing(user: SessionUser) {
  return createWhatsAppPairingSession(user);
}

export async function revokeWhatsAppLink(user: SessionUser) {
  await revokeWhatsAppIdentity(user);
}

export async function configureWhatsAppProvider(
  user: SessionUser,
  codexSessionCookie: string | undefined,
) {
  await configureWhatsAppAssistantProviderFromCookie({
    cookieValue: codexSessionCookie,
    configuredByUserId: user.id,
  });

  return getWhatsAppLinkStatus(user);
}

export async function disconnectWhatsAppProvider() {
  await clearWhatsAppAssistantProvider();
}

export async function getWhatsAppProviderCookie() {
  const providerStatus = await getWhatsAppAssistantProviderStatus();
  if (!providerStatus.ready) {
    return undefined;
  }

  return getSharedWhatsAppAssistantCodexCookie();
}

export async function resolveVerifiedWhatsAppIdentity(phoneNumber: string) {
  const linkedIdentity = await findVerifiedUserByWhatsAppPhone(phoneNumber);
  if (!linkedIdentity?.user?.isActive) {
    return null;
  }

  const sessionUser = await getSessionUserById(linkedIdentity.userId);
  if (!sessionUser?.isActive) {
    return null;
  }

  return {
    identityId: linkedIdentity.id,
    phoneNumber: linkedIdentity.externalAddress,
    user: sessionUser,
  } satisfies ResolvedWhatsAppIdentity;
}

export async function resolveVerifiedWhatsAppUser(phoneNumber: string) {
  const linkedIdentity = await resolveVerifiedWhatsAppIdentity(phoneNumber);
  return linkedIdentity?.user ?? null;
}

export async function markWhatsAppIdentityIncoming(identityId: string) {
  await touchWhatsAppIdentityActivity({
    identityId,
    direction: "incoming",
  });
}

export async function markWhatsAppIdentityOutgoing(identityId: string) {
  await touchWhatsAppIdentityActivity({
    identityId,
    direction: "outgoing",
  });
}

export async function consumeWhatsAppPairingCommand(input: {
  senderPhone: string;
  body: string;
}) {
  const match = input.body.trim().match(PAIRING_COMMAND_PATTERN);
  if (!match) {
    return {
      handled: false as const,
    };
  }

  try {
    const pairing = await consumeWhatsAppPairingCode({
      senderPhone: input.senderPhone,
      code: match[1],
    });

    const sessionUser = await getSessionUserById(pairing.user.id);
    if (!sessionUser?.isActive) {
      throw new BusinessRuleError(
        "WHATSAPP_LINKED_USER_INACTIVE",
        "Ο λογαριασμός δεν είναι διαθέσιμος για σύνδεση. Επικοινώνησε με τον admin.",
        409,
      );
    }

    return {
      handled: true as const,
      success: true as const,
      user: sessionUser,
      identityId: pairing.identityId,
      phoneNumber: pairing.phoneNumber,
      message: `Το WhatsApp συνδέθηκε επιτυχώς με τον λογαριασμό ${sessionUser.fullName}.`,
    };
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return {
        handled: true as const,
        success: false as const,
        message: error.message,
      };
    }

    throw error;
  }
}
