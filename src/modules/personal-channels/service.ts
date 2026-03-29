import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  AssistantChannel,
  ChannelIdentityStatus,
  MessagingChannel,
} from "@prisma/client";
import makeWASocket, {
  areJidsSameUser,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type proto,
  useMultiFileAuthState as createMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { getSessionUserById } from "@/modules/users/service";
import type { SessionUser } from "@/shared/auth/types";
import { env } from "@/shared/config/env";
import {
  getSharedWhatsAppAssistantCodexCookie,
  getWhatsAppAssistantProviderStatus,
} from "@/shared/config/assistant-provider";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";

const execFileAsync = promisify(execFile);
const silentLogger = pino({ level: "silent" });

type WhatsAppRuntimeStatus =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "connected"
  | "error";

type IMessageRuntimeStatus =
  | "unavailable"
  | "disconnected"
  | "connected"
  | "error";

type WhatsAppRuntime = {
  userId: string;
  authDir: string;
  status: WhatsAppRuntimeStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  selfJid: string | null;
  selfLid: string | null;
  lastSelfChatJid: string | null;
  lastError: string | null;
  socket: WASocket | null;
  sentMessageIds: string[];
  connecting: Promise<void> | null;
  stopRequested: boolean;
  reconnectTimer: NodeJS.Timeout | null;
};

type IMsgCursor = {
  lastRowId: number;
};

type PersonalChannelsStatus = {
  assistantProvider: {
    ready: boolean;
    configuredAt: string | null;
    configuredByName: string | null;
    mode: "api_key" | "codex";
  };
  whatsApp: {
    available: boolean;
    status: WhatsAppRuntimeStatus;
    phoneNumber: string | null;
    qrDataUrl: string | null;
    lastError: string | null;
    usesPersonalAccount: true;
    selfChatOnly: true;
  };
  iMessage: {
    available: boolean;
    status: IMessageRuntimeStatus;
    handle: string | null;
    lastError: string | null;
    hostOnly: true;
    dbPath: string;
  };
};

type SqliteMessageRow = {
  rowid: number;
  guid: string;
  text: string;
  handle_id: string | null;
  is_from_me: number;
  created_at: string | null;
};

function normalizePhone(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const compact = value.replace(/[^\d+]/g, "");
  return compact.length > 0 ? compact : null;
}

function normalizeIMessageHandle(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function isPhoneLikeIMessageHandle(value: string) {
  return /^[+\d\s().-]+$/.test(value);
}

function buildIMessageHandleCandidates(value: string) {
  const candidates = new Set<string>([value]);

  if (!isPhoneLikeIMessageHandle(value)) {
    return Array.from(candidates);
  }

  const normalizedPhone = normalizePhone(value);
  if (!normalizedPhone) {
    return Array.from(candidates);
  }

  const digits = normalizedPhone.replace(/[^\d]/g, "");
  if (!digits) {
    return Array.from(candidates);
  }

  candidates.add(digits);
  candidates.add(`+${digits}`);

  if (digits.length === 10) {
    candidates.add(`30${digits}`);
    candidates.add(`+30${digits}`);
  }

  if (digits.length === 12 && digits.startsWith("30")) {
    candidates.add(`+${digits}`);
  }

  return Array.from(candidates);
}

function escapeSqliteLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function getWhatsAppAuthDir(userId: string) {
  return join(process.cwd(), env.personalChannelsDir, "whatsapp", userId);
}

async function getPersonalChannelUserKeys(userId: string) {
  const db = await getDatabaseClient();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      auth0UserId: true,
    },
  });

  return Array.from(
    new Set(
      [userId, user?.id ?? null, user?.auth0UserId ?? null].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

async function migrateLegacyWhatsAppAuthDir(userId: string) {
  const canonicalDir = getWhatsAppAuthDir(userId);
  if (await fileExists(canonicalDir)) {
    return canonicalDir;
  }

  const userKeys = await getPersonalChannelUserKeys(userId);
  for (const key of userKeys) {
    if (key === userId) {
      continue;
    }

    const legacyDir = getWhatsAppAuthDir(key);
    if (!(await fileExists(legacyDir))) {
      continue;
    }

    await mkdir(join(process.cwd(), env.personalChannelsDir, "whatsapp"), {
      recursive: true,
    });
    await rename(legacyDir, canonicalDir).catch(() => null);

    if (await fileExists(canonicalDir)) {
      return canonicalDir;
    }
  }

  return canonicalDir;
}

function getWhatsAppSelfJid(jid: string | null | undefined) {
  if (!jid) {
    return null;
  }

  const [localPart, domain] = jid.split("@");
  if (!localPart || !domain) {
    return null;
  }

  return `${localPart.split(":")[0]}@${domain}`;
}

function getWhatsAppPhoneFromJid(jid: string | null | undefined) {
  if (!jid) {
    return null;
  }

  return normalizePhone(jid.split("@")[0]?.split(":")[0] ?? null);
}

function isSameWhatsAppUser(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) {
    return false;
  }

  try {
    return areJidsSameUser(left, right);
  } catch {
    return left === right;
  }
}

function isWhatsAppSelfChat(runtime: WhatsAppRuntime, remoteJid: string | null | undefined) {
  if (!remoteJid) {
    return false;
  }

  if (isSameWhatsAppUser(remoteJid, runtime.selfJid)) {
    return true;
  }

  if (isSameWhatsAppUser(remoteJid, runtime.selfLid)) {
    return true;
  }

  const remotePhone = getWhatsAppPhoneFromJid(remoteJid);
  return Boolean(remotePhone && runtime.phoneNumber && remotePhone === runtime.phoneNumber);
}

function rememberSentMessageId(runtime: WhatsAppRuntime, messageId: string | null | undefined) {
  if (!messageId) {
    return;
  }

  runtime.sentMessageIds.push(messageId);
  if (runtime.sentMessageIds.length > 200) {
    runtime.sentMessageIds.splice(0, runtime.sentMessageIds.length - 200);
  }
}

function hasSeenSentMessage(runtime: WhatsAppRuntime, messageId: string | null | undefined) {
  if (!messageId) {
    return false;
  }

  return runtime.sentMessageIds.includes(messageId);
}

function getWhatsAppMessageBody(message: proto.IWebMessageInfo) {
  const payload = message.message;
  if (!payload) {
    return null;
  }

  if (typeof payload.conversation === "string" && payload.conversation.trim().length > 0) {
    return payload.conversation.trim();
  }

  if (
    typeof payload.extendedTextMessage?.text === "string" &&
    payload.extendedTextMessage.text.trim().length > 0
  ) {
    return payload.extendedTextMessage.text.trim();
  }

  if (
    typeof payload.imageMessage?.caption === "string" &&
    payload.imageMessage.caption.trim().length > 0
  ) {
    return payload.imageMessage.caption.trim();
  }

  if (
    typeof payload.videoMessage?.caption === "string" &&
    payload.videoMessage.caption.trim().length > 0
  ) {
    return payload.videoMessage.caption.trim();
  }

  if (payload.ephemeralMessage?.message) {
    return getWhatsAppMessageBody({
      ...message,
      message: payload.ephemeralMessage.message,
    } as proto.IWebMessageInfo);
  }

  if (payload.viewOnceMessageV2?.message) {
    return getWhatsAppMessageBody({
      ...message,
      message: payload.viewOnceMessageV2.message,
    } as proto.IWebMessageInfo);
  }

  return null;
}

function detectLocale(body: string) {
  return /[Α-Ωα-ω]/.test(body) ? "el" : "en";
}

function getDisconnectStatusCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "output" in error &&
    typeof error.output === "object" &&
    error.output !== null &&
    "statusCode" in error.output
  ) {
    return Number(error.output.statusCode);
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }

  return null;
}

function mapIMessageErrorMessage(error: unknown) {
  const rawMessage = getErrorMessage(error) ?? "iMessage access failed.";

  if (
    rawMessage.includes("authorization denied") ||
    rawMessage.includes("Operation not permitted")
  ) {
    return "macOS blocked access to Messages data. Give Full Disk Access to the app that runs this server, then restart the dev server and try again.";
  }

  if (rawMessage.includes("unable to open database")) {
    return "Messages data is not readable yet. Check that Messages is signed in and that the server process has Full Disk Access, then try again.";
  }

  return rawMessage;
}

async function ensureAssistantProviderReady() {
  const status = await getWhatsAppAssistantProviderStatus();
  if (!status.ready && !env.openAiApiKey) {
    throw new BusinessRuleError(
      "CHANNEL_ASSISTANT_PROVIDER_NOT_READY",
      "The shared OpenAI assistant provider is not ready yet.",
      409,
    );
  }

  return {
    status,
    codexCookie: await getSharedWhatsAppAssistantCodexCookie(),
  };
}

async function upsertVerifiedIdentity(input: {
  userId: string;
  channel: MessagingChannel;
  externalAddress: string;
}) {
  const db = await getDatabaseClient();
  const now = new Date();
  const userKeys = await getPersonalChannelUserKeys(input.userId);

  await db.userChannelIdentity.updateMany({
    where: {
      userId: {
        in: userKeys,
      },
      channel: input.channel,
      status: ChannelIdentityStatus.VERIFIED,
      NOT: {
        externalAddress: input.externalAddress,
      },
    },
    data: {
      status: ChannelIdentityStatus.REVOKED,
      revokedAt: now,
    },
  });

  await db.userChannelIdentity.upsert({
    where: {
      channel_externalAddress: {
        channel: input.channel,
        externalAddress: input.externalAddress,
      },
    },
    update: {
      userId: input.userId,
      status: ChannelIdentityStatus.VERIFIED,
      verifiedAt: now,
      revokedAt: null,
    },
    create: {
      userId: input.userId,
      channel: input.channel,
      externalAddress: input.externalAddress,
      status: ChannelIdentityStatus.VERIFIED,
      verifiedAt: now,
    },
  });
}

async function revokeIdentity(userId: string, channel: MessagingChannel) {
  const db = await getDatabaseClient();
  const userKeys = await getPersonalChannelUserKeys(userId);
  await db.userChannelIdentity.updateMany({
    where: {
      userId: {
        in: userKeys,
      },
      channel,
      status: ChannelIdentityStatus.VERIFIED,
    },
    data: {
      status: ChannelIdentityStatus.REVOKED,
      revokedAt: new Date(),
    },
  });
}

async function getVerifiedIdentity(userId: string, channel: MessagingChannel) {
  const db = await getDatabaseClient();
  const userKeys = await getPersonalChannelUserKeys(userId);
  const identity = await db.userChannelIdentity.findFirst({
    where: {
      userId: {
        in: userKeys,
      },
      channel,
      status: ChannelIdentityStatus.VERIFIED,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (identity && identity.userId !== userId) {
    return db.userChannelIdentity.update({
      where: { id: identity.id },
      data: {
        userId,
      },
    });
  }

  return identity;
}

async function touchIdentityActivity(input: {
  identityId?: string | null;
  direction: "incoming" | "outgoing";
}) {
  if (!input.identityId) {
    return;
  }

  const db = await getDatabaseClient();
  await db.userChannelIdentity.update({
    where: { id: input.identityId },
    data:
      input.direction === "incoming"
        ? { lastIncomingAt: new Date() }
        : { lastOutgoingAt: new Date() },
  }).catch(() => {});
}

async function waitForWhatsAppRuntimeState(
  runtime: WhatsAppRuntime,
  timeoutMs = 12_000,
) {
  const timeoutAt = Date.now() + timeoutMs;

  while (Date.now() < timeoutAt) {
    if (
      runtime.status === "pairing" ||
      runtime.status === "connected" ||
      runtime.status === "error" ||
      runtime.status === "disconnected"
    ) {
      return runtime.status;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  return runtime.status;
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function shouldReconnectWhatsApp(statusCode: number | null) {
  return (
    statusCode === DisconnectReason.restartRequired ||
    statusCode === DisconnectReason.connectionClosed ||
    statusCode === DisconnectReason.connectionLost ||
    statusCode === DisconnectReason.timedOut ||
    statusCode === DisconnectReason.unavailableService
  );
}

function getWhatsAppNotificationTargetJid(
  runtime: WhatsAppRuntime | null,
  externalAddress: string | null | undefined,
) {
  return (
    runtime?.lastSelfChatJid ??
    runtime?.selfLid ??
    runtime?.selfJid ??
    (externalAddress
      ? `${externalAddress.replace(/[^\d]/g, "")}@s.whatsapp.net`
      : null)
  );
}

function getWhatsAppUnavailableReason(runtime: WhatsAppRuntime | null) {
  if (!runtime) {
    return "WhatsApp session is not running in this server process.";
  }

  if (runtime.status === "pairing") {
    return "WhatsApp needs QR relink before notifications can be delivered.";
  }

  if (runtime.status === "connecting") {
    return "WhatsApp is still reconnecting. Try again in a few seconds.";
  }

  if (runtime.status === "disconnected") {
    return runtime.lastError ?? "WhatsApp session is disconnected.";
  }

  if (runtime.status === "error") {
    return runtime.lastError ?? "WhatsApp session failed.";
  }

  return runtime.lastError ?? "WhatsApp session is unavailable.";
}

class PersonalChannelsGateway {
  private whatsAppRuntimes = new Map<string, WhatsAppRuntime>();

  private iMessagePoller: NodeJS.Timeout | null = null;

  private iMessageCursors = new Map<string, IMsgCursor>();

  private iMessageLastError: string | null = null;

  private iMessageStarting = false;

  async getStatus(user: SessionUser): Promise<PersonalChannelsStatus> {
    await this.ensureIMessagePolling();
    const [providerInfo, whatsAppStatus, iMessageIdentity] = await Promise.all([
      this.getAssistantProviderStatus(),
      this.getWhatsAppStatus(user),
      getVerifiedIdentity(user.id, MessagingChannel.IMESSAGE),
    ]);

    const iMessageAvailable = await this.isIMessageAvailable();

    return {
      assistantProvider: providerInfo,
      whatsApp: whatsAppStatus,
      iMessage: {
        available: iMessageAvailable,
        status: !iMessageAvailable
          ? "unavailable"
          : this.iMessageLastError
            ? "error"
            : iMessageIdentity
              ? "connected"
              : "disconnected",
        handle: iMessageIdentity?.externalAddress ?? null,
        lastError: this.iMessageLastError,
        hostOnly: true,
        dbPath: env.imessageDbPath,
      },
    };
  }

  async connectWhatsApp(user: SessionUser) {
    await this.ensureWhatsAppRuntime(user, true);
    const runtime = this.whatsAppRuntimes.get(user.id);
    if (runtime) {
      await waitForWhatsAppRuntimeState(runtime);
    }
    return this.getStatus(user);
  }

  async disconnectWhatsApp(user: SessionUser) {
    const runtime = this.whatsAppRuntimes.get(user.id);
    if (runtime?.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }

    if (runtime?.socket) {
      runtime.stopRequested = true;
      try {
        await runtime.socket.logout();
      } catch {
        // ignore local logout failures
      }

      runtime.socket.end(new Error("WhatsApp session disconnected by user."));
    }

    this.whatsAppRuntimes.delete(user.id);
    const userKeys = await getPersonalChannelUserKeys(user.id);
    await Promise.all(
      userKeys.map((key) =>
        rm(getWhatsAppAuthDir(key), { recursive: true, force: true }).catch(() => {}),
      ),
    );
    await revokeIdentity(user.id, MessagingChannel.WHATSAPP);

    return this.getStatus(user);
  }

  async connectIMessage(user: SessionUser, handle: string) {
    const normalizedHandle = normalizeIMessageHandle(handle);
    if (!normalizedHandle) {
      throw new BusinessRuleError(
        "IMESSAGE_HANDLE_REQUIRED",
        "Enter the iMessage phone number or email you use on this Mac.",
        422,
      );
    }

    if (!(await this.isIMessageAvailable())) {
      throw new BusinessRuleError(
        "IMESSAGE_NOT_AVAILABLE",
        "iMessage is not available on this Mac. Check Messages sign-in and Full Disk Access.",
        409,
      );
    }

    let resolvedHandle: string | null = null;
    let suggestedHandle: string | null = null;

    try {
      const resolution = await this.resolveKnownIMessageHandle(normalizedHandle);
      resolvedHandle = resolution.resolvedHandle;
      suggestedHandle = resolution.suggestedHandle;
    } catch (error) {
      const message = mapIMessageErrorMessage(error);
      this.iMessageLastError = message;
      throw new BusinessRuleError("IMESSAGE_ACCESS_DENIED", message, 409);
    }

    if (!resolvedHandle) {
      throw new BusinessRuleError(
        "IMESSAGE_HANDLE_NOT_FOUND",
        suggestedHandle
          ? `This iMessage handle is not known on this Mac yet. Did you mean ${suggestedHandle}?`
          : "This iMessage handle is not known on this Mac yet. Open the exact conversation once in Messages and use the same phone or email here.",
        422,
      );
    }

    await upsertVerifiedIdentity({
      userId: user.id,
      channel: MessagingChannel.IMESSAGE,
      externalAddress: resolvedHandle,
    });

    await this.initializeIMessageCursor(resolvedHandle);
    this.iMessageLastError = null;
    await this.ensureIMessagePolling();

    return this.getStatus(user);
  }

  async disconnectIMessage(user: SessionUser) {
    const identity = await getVerifiedIdentity(user.id, MessagingChannel.IMESSAGE);
    if (identity) {
      this.iMessageCursors.delete(identity.externalAddress);
    }

    await revokeIdentity(user.id, MessagingChannel.IMESSAGE);
    this.iMessageLastError = null;
    return this.getStatus(user);
  }

  private async getAssistantProviderStatus() {
    const provider = await getWhatsAppAssistantProviderStatus();
    const configuredBy = provider.configuredByUserId
      ? await getSessionUserById(provider.configuredByUserId)
      : null;

    return {
      ready: provider.ready,
      configuredAt: provider.configuredAt,
      configuredByName: configuredBy?.fullName ?? null,
      mode: provider.mode,
    };
  }

  private async getWhatsAppStatus(user: SessionUser) {
    const authDir = await migrateLegacyWhatsAppAuthDir(user.id);
    const hasAuthDir = await fileExists(authDir);
    const runtime = this.whatsAppRuntimes.get(user.id) ?? null;
    const linkedIdentity = await getVerifiedIdentity(user.id, MessagingChannel.WHATSAPP);

    if (!runtime && hasAuthDir) {
      await this.ensureWhatsAppRuntime(user, false);
    }

    const nextRuntime = this.whatsAppRuntimes.get(user.id) ?? null;

    return {
      available: true,
      status:
        nextRuntime?.status ??
        (linkedIdentity && hasAuthDir ? "connecting" : "disconnected"),
      phoneNumber: nextRuntime?.phoneNumber ?? linkedIdentity?.externalAddress ?? null,
      qrDataUrl: nextRuntime?.qrDataUrl ?? null,
      lastError:
        nextRuntime?.lastError ??
        (linkedIdentity && !hasAuthDir
          ? "WhatsApp auth session is missing locally. Reconnect to resume."
          : null),
      usesPersonalAccount: true as const,
      selfChatOnly: true as const,
    };
  }

  private async ensureWhatsAppNotificationRuntime(userId: string) {
    let runtime = this.whatsAppRuntimes.get(userId) ?? null;
    const sessionUser = await getSessionUserById(userId);
    if (!sessionUser?.isActive) {
      return {
        runtime,
        reason: "Recipient is inactive or unavailable.",
      };
    }

    const needsStart = !runtime?.socket || runtime.status !== "connected";
    if (needsStart) {
      await this.ensureWhatsAppRuntime(sessionUser, true).catch(() => {});
      runtime = this.whatsAppRuntimes.get(userId) ?? null;
      if (runtime) {
        await waitForWhatsAppRuntimeState(runtime, 16_000);
      }
    }

    if (!runtime?.socket || runtime.status !== "connected") {
      await this.ensureWhatsAppRuntime(sessionUser, true).catch(() => {});
      runtime = this.whatsAppRuntimes.get(userId) ?? null;
      if (runtime) {
        await waitForWhatsAppRuntimeState(runtime, 8_000);
      }
    }

    return {
      runtime,
      reason:
        runtime?.socket && runtime.status === "connected"
          ? null
          : getWhatsAppUnavailableReason(runtime),
    };
  }

  private async ensureWhatsAppRuntime(user: SessionUser, forceStart: boolean) {
    let runtime = this.whatsAppRuntimes.get(user.id);
    if (!runtime) {
      runtime = {
        userId: user.id,
        authDir: await migrateLegacyWhatsAppAuthDir(user.id),
        status: "disconnected",
        qrDataUrl: null,
        phoneNumber: null,
        selfJid: null,
        selfLid: null,
        lastSelfChatJid: null,
        lastError: null,
        socket: null,
        sentMessageIds: [],
        connecting: null,
        stopRequested: false,
        reconnectTimer: null,
      };
      this.whatsAppRuntimes.set(user.id, runtime);
    }

    if (runtime.connecting) {
      await runtime.connecting;
      return;
    }

    if (!forceStart && runtime.status === "connected") {
      return;
    }

    runtime.connecting = this.startWhatsAppRuntime(user, runtime);
    await runtime.connecting;
  }

  private async startWhatsAppRuntime(user: SessionUser, runtime: WhatsAppRuntime) {
    runtime.authDir = await migrateLegacyWhatsAppAuthDir(user.id);
    runtime.status = "connecting";
    runtime.lastError = null;
    runtime.qrDataUrl = null;
    runtime.stopRequested = false;

    try {
      await mkdir(runtime.authDir, { recursive: true });

      const { state, saveCreds } = await createMultiFileAuthState(runtime.authDir);
      const { version } = await fetchLatestBaileysVersion();
      const socket = makeWASocket({
        auth: state,
        browser: Browsers.macOS("Company Assistant"),
        logger: silentLogger,
        version,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      runtime.socket = socket;
      socket.ev.on("creds.update", saveCreds);
      socket.ev.on("connection.update", async (update) => {
        if (update.qr) {
          runtime.status = "pairing";
          runtime.qrDataUrl = await QRCode.toDataURL(update.qr, {
            margin: 1,
            width: 256,
          });
        }

        if (update.connection === "open") {
          runtime.status = "connected";
          runtime.qrDataUrl = null;
          const connectedUser = socket.user as
            | {
                id?: string | null;
                lid?: string | null;
                phoneNumber?: string | null;
              }
            | null
            | undefined;
          runtime.selfJid = getWhatsAppSelfJid(connectedUser?.id);
          runtime.selfLid = getWhatsAppSelfJid(connectedUser?.lid);
          runtime.lastSelfChatJid = null;
          runtime.phoneNumber =
            normalizePhone(connectedUser?.phoneNumber) ??
            getWhatsAppPhoneFromJid(connectedUser?.id);
          runtime.lastError = null;
          if (runtime.reconnectTimer) {
            clearTimeout(runtime.reconnectTimer);
            runtime.reconnectTimer = null;
          }

          if (runtime.phoneNumber) {
            await upsertVerifiedIdentity({
              userId: user.id,
              channel: MessagingChannel.WHATSAPP,
              externalAddress: runtime.phoneNumber,
            });
          }
        }

        if (update.connection === "close") {
          const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
          const disconnectMessage =
            getErrorMessage(update.lastDisconnect?.error) ?? "WhatsApp connection closed.";

          runtime.socket = null;
          runtime.connecting = null;

          if (runtime.stopRequested) {
            runtime.status = "disconnected";
            runtime.qrDataUrl = null;
            runtime.lastError = null;
            runtime.phoneNumber = null;
            runtime.selfJid = null;
            runtime.selfLid = null;
            runtime.lastSelfChatJid = null;
            return;
          }

          if (statusCode === DisconnectReason.loggedOut) {
            runtime.status = "disconnected";
            runtime.phoneNumber = null;
            runtime.selfJid = null;
            runtime.selfLid = null;
            runtime.lastSelfChatJid = null;
            runtime.lastError = "WhatsApp session logged out.";
            await revokeIdentity(user.id, MessagingChannel.WHATSAPP);
            await rm(runtime.authDir, { recursive: true, force: true }).catch(() => {});
            return;
          }

          if (shouldReconnectWhatsApp(statusCode)) {
            runtime.status = "connecting";
            runtime.lastError = null;
            runtime.qrDataUrl = null;
            if (runtime.reconnectTimer) {
              clearTimeout(runtime.reconnectTimer);
            }
            runtime.reconnectTimer = setTimeout(() => {
              runtime.reconnectTimer = null;
              if (!runtime.stopRequested) {
                void this.ensureWhatsAppRuntime(user, true).catch((error) => {
                  runtime.status = "error";
                  runtime.lastError =
                    getErrorMessage(error) ?? "WhatsApp reconnect failed.";
                });
              }
            }, statusCode === DisconnectReason.restartRequired ? 250 : 1500);
            return;
          }

          runtime.status = "error";
          runtime.lastError = disconnectMessage;
        }
      });

      socket.ev.on("messages.upsert", async (event) => {
        const sessionUser = await getSessionUserById(user.id);
        if (!sessionUser?.isActive || !runtime.selfJid) {
          return;
        }

        for (const message of event.messages) {
          const remoteJid = message.key.remoteJid ?? null;
          if (!isWhatsAppSelfChat(runtime, remoteJid)) {
            continue;
          }
          const targetJid = remoteJid;
          if (!targetJid) {
            continue;
          }
          runtime.lastSelfChatJid = targetJid;

          if (message.key.id && hasSeenSentMessage(runtime, message.key.id)) {
            continue;
          }

          const body = getWhatsAppMessageBody(message);
          if (!body || body.trim().length < 2) {
            continue;
          }

          try {
            const reply = await this.buildAssistantReply(
              sessionUser,
              AssistantChannel.WHATSAPP,
              body,
            );
            const sent = await socket.sendMessage(targetJid, {
              text: reply,
            });
            rememberSentMessageId(runtime, sent?.key?.id);
            const identity = await getVerifiedIdentity(user.id, MessagingChannel.WHATSAPP);
            await touchIdentityActivity({
              identityId: identity?.id,
              direction: "incoming",
            });
            await touchIdentityActivity({
              identityId: identity?.id,
              direction: "outgoing",
            });
          } catch (error) {
            runtime.lastError =
              error instanceof Error ? error.message : "WhatsApp assistant failed.";
            const sent = await socket.sendMessage(targetJid, {
              text:
                detectLocale(body) === "el"
                  ? `Δεν ολοκληρώθηκε η απάντηση του assistant: ${runtime.lastError}`
                  : `The assistant could not complete the reply: ${runtime.lastError}`,
            }).catch(() => null);
            rememberSentMessageId(runtime, sent?.key?.id);
          }
        }
      });
    } catch (error) {
      runtime.status = "error";
      runtime.lastError = getErrorMessage(error) ?? "WhatsApp connection failed.";
    } finally {
      runtime.connecting = null;
    }
  }

  private async buildAssistantReply(
    user: SessionUser,
    channel: AssistantChannel,
    body: string,
  ) {
    const provider = await ensureAssistantProviderReady();
    const locale = detectLocale(body);
    const { sendAssistantMessage } = await import("@/modules/assistant/service");
    const detail = await sendAssistantMessage({
      body,
      locale,
      channel,
      user,
      codexTokenCookie: provider.codexCookie,
    });

    return (
      detail?.assistantReply ??
      detail?.messages[detail.messages.length - 1]?.body ??
      (locale === "el"
        ? "Δεν μπόρεσα να απαντήσω αυτή τη στιγμή."
        : "I could not answer right now.")
    );
  }

  async sendLinkedUserNotification(input: {
    userId: string;
    body: string;
    channelPreference?: "AUTO" | "WHATSAPP" | "IMESSAGE";
  }) {
    const preference = input.channelPreference ?? "AUTO";
    const whatsAppIdentity = await getVerifiedIdentity(input.userId, MessagingChannel.WHATSAPP);
    const iMessageIdentity = await getVerifiedIdentity(input.userId, MessagingChannel.IMESSAGE);

    if (preference !== "IMESSAGE" && whatsAppIdentity) {
      const { runtime, reason } = await this.ensureWhatsAppNotificationRuntime(
        input.userId,
      );
      const targetJid = getWhatsAppNotificationTargetJid(
        runtime,
        whatsAppIdentity.externalAddress,
      );

      if (!runtime?.socket || runtime.status !== "connected") {
        return {
          delivered: false,
          channel: MessagingChannel.WHATSAPP,
          reason,
        } as const;
      }

      if (!targetJid) {
        return {
          delivered: false,
          channel: MessagingChannel.WHATSAPP,
          reason:
            "WhatsApp self-chat target is not initialized yet. Send one message in 'Message yourself' and try again.",
        } as const;
      }

      try {
        const sent = await runtime.socket.sendMessage(targetJid, {
          text: input.body,
        });
        rememberSentMessageId(runtime, sent?.key?.id);
        await touchIdentityActivity({
          identityId: whatsAppIdentity.id,
          direction: "outgoing",
        });
        return {
          delivered: true,
          channel: MessagingChannel.WHATSAPP,
        } as const;
      } catch (error) {
        return {
          delivered: false,
          channel: MessagingChannel.WHATSAPP,
          reason:
            error instanceof Error ? error.message : "WhatsApp notification failed.",
        } as const;
      }
    }

    if (preference === "WHATSAPP") {
      return {
        delivered: false,
        channel: MessagingChannel.WHATSAPP,
        reason: "No verified WhatsApp channel is linked for this user.",
      } as const;
    }

    if ((preference === "AUTO" || preference === "IMESSAGE") && iMessageIdentity) {
      try {
        await this.sendIMessage(iMessageIdentity.externalAddress, input.body);
        await touchIdentityActivity({
          identityId: iMessageIdentity.id,
          direction: "outgoing",
        });
        return {
          delivered: true,
          channel: MessagingChannel.IMESSAGE,
        } as const;
      } catch (error) {
        return {
          delivered: false,
          channel: MessagingChannel.IMESSAGE,
          reason: mapIMessageErrorMessage(error),
        } as const;
      }
    }

    if (preference === "IMESSAGE") {
      return {
        delivered: false,
        channel: MessagingChannel.IMESSAGE,
        reason: "No verified iMessage channel is linked for this user.",
      } as const;
    }

    return {
      delivered: false,
      channel: "NONE" as const,
      reason: "No connected personal channel was available.",
    };
  }

  private async isIMessageAvailable() {
    if (process.platform !== "darwin") {
      return false;
    }

    return fileExists(env.imessageDbPath);
  }

  private async assertIMessageReadable() {
    await this.runSqliteJsonQuery<{ ok: number }>("SELECT 1 AS ok");
  }

  private async ensureIMessagePolling() {
    if (this.iMessagePoller || this.iMessageStarting) {
      return;
    }

    this.iMessageStarting = true;

    try {
      if (!(await this.isIMessageAvailable())) {
        this.iMessageLastError = "Messages database not available on this Mac.";
        return;
      }

      try {
        await this.assertIMessageReadable();
        this.iMessageLastError = null;
      } catch (error) {
        this.iMessageLastError = mapIMessageErrorMessage(error);
        return;
      }

      this.iMessagePoller = setInterval(() => {
        void this.pollIMessage();
      }, Math.max(2000, env.imessagePollIntervalMs));
      void this.pollIMessage();
    } finally {
      this.iMessageStarting = false;
    }
  }

  private async initializeIMessageCursor(handle: string) {
    const latestRowId = await this.getLatestIMessageRowId(handle);
    this.iMessageCursors.set(handle, { lastRowId: latestRowId });
  }

  private async resolveKnownIMessageHandle(handle: string) {
    const normalizedHandle = normalizeIMessageHandle(handle);
    if (!normalizedHandle) {
      return {
        resolvedHandle: null,
        suggestedHandle: null,
      };
    }

    const candidates = buildIMessageHandleCandidates(normalizedHandle);
    const lowerCandidates = candidates.map((candidate) =>
      `'${escapeSqliteLiteral(candidate.toLowerCase())}'`,
    );

    if (normalizedHandle.includes("@")) {
      const exactRows = await this.runSqliteJsonQuery<{ id: string }>(`
        SELECT id
        FROM handle
        WHERE lower(id) IN (${lowerCandidates.join(", ")})
        ORDER BY ROWID DESC
        LIMIT 1
      `);

      if (exactRows[0]?.id) {
        return {
          resolvedHandle: exactRows[0].id,
          suggestedHandle: null,
        };
      }

      const localPart = escapeSqliteLiteral(normalizedHandle.split("@")[0].toLowerCase());
      const suggestionRows = await this.runSqliteJsonQuery<{ id: string }>(`
        SELECT id
        FROM handle
        WHERE lower(id) LIKE '${localPart}@%'
        ORDER BY ROWID DESC
        LIMIT 1
      `);

      return {
        resolvedHandle: null,
        suggestedHandle: suggestionRows[0]?.id ?? null,
      };
    }

    const digits = candidates
      .map((candidate) => candidate.replace(/[^\d]/g, ""))
      .filter((candidate) => candidate.length > 0);
    const phoneRows =
      digits.length > 0
        ? await this.runSqliteJsonQuery<{ id: string }>(`
            SELECT id
            FROM handle
            WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(id, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') IN (${digits
              .map((candidate) => `'${escapeSqliteLiteral(candidate)}'`)
              .join(", ")})
            ORDER BY ROWID DESC
            LIMIT 1
          `)
        : [];

    return {
      resolvedHandle: phoneRows[0]?.id ?? null,
      suggestedHandle: phoneRows[0]?.id ?? null,
    };
  }

  private async getLatestIMessageRowId(handle: string) {
    const normalizedHandle = normalizeIMessageHandle(handle);
    if (!normalizedHandle) {
      return 0;
    }

    const sql = `
      SELECT COALESCE(MAX(message.ROWID), 0) AS rowid
      FROM message
      LEFT JOIN handle ON handle.ROWID = message.handle_id
      WHERE handle.id = '${normalizedHandle.replace(/'/g, "''")}'
    `;
    const rows = await this.runSqliteJsonQuery<{ rowid: number }>(sql);
    return Number(rows[0]?.rowid ?? 0);
  }

  private async pollIMessage() {
    try {
      const db = await getDatabaseClient();
      const identities = await db.userChannelIdentity.findMany({
        where: {
          channel: MessagingChannel.IMESSAGE,
          status: ChannelIdentityStatus.VERIFIED,
        },
      });

      for (const identity of identities) {
        const sessionUser = await getSessionUserById(identity.userId);
        if (!sessionUser?.isActive || !sessionUser.permissions.includes("assistant.use")) {
          continue;
        }

        if (!this.iMessageCursors.has(identity.externalAddress)) {
          await this.initializeIMessageCursor(identity.externalAddress);
        }

        const cursor = this.iMessageCursors.get(identity.externalAddress);
        if (!cursor) {
          continue;
        }

        const sql = `
          SELECT
            message.ROWID AS rowid,
            message.guid AS guid,
            COALESCE(message.text, '') AS text,
            handle.id AS handle_id,
            message.is_from_me AS is_from_me,
            datetime(message.date / 1000000000 + 978307200, 'unixepoch', 'localtime') AS created_at
          FROM message
          LEFT JOIN handle ON handle.ROWID = message.handle_id
          WHERE handle.id = '${identity.externalAddress.replace(/'/g, "''")}'
            AND COALESCE(message.text, '') <> ''
            AND message.ROWID > ${cursor.lastRowId}
          ORDER BY message.ROWID ASC
          LIMIT 25
        `;

        const rows = await this.runSqliteJsonQuery<SqliteMessageRow>(sql);
        for (const row of rows) {
          cursor.lastRowId = Math.max(cursor.lastRowId, Number(row.rowid ?? 0));

          if (Number(row.is_from_me ?? 0) === 1) {
            continue;
          }

          if (!row.text || row.text.startsWith(env.imessageAssistantPrefix)) {
            continue;
          }

          await touchIdentityActivity({
            identityId: identity.id,
            direction: "incoming",
          });

          const reply = await this.buildAssistantReply(
            sessionUser,
            AssistantChannel.IMESSAGE,
            row.text,
          );

          await this.sendIMessage(
            identity.externalAddress,
            `${env.imessageAssistantPrefix}${reply}`,
          );
          await touchIdentityActivity({
            identityId: identity.id,
            direction: "outgoing",
          });
        }
      }

      this.iMessageLastError = null;
    } catch (error) {
      this.iMessageLastError = mapIMessageErrorMessage(error);
    }
  }

  private async runSqliteJsonQuery<T>(sql: string) {
    const { stdout, stderr } = await execFileAsync("/usr/bin/sqlite3", [
      "-json",
      env.imessageDbPath,
      sql,
    ]);

    if (stderr?.trim()) {
      throw new Error(stderr.trim());
    }

    if (!stdout.trim()) {
      return [] as T[];
    }

    return JSON.parse(stdout) as T[];
  }

  private async sendIMessage(handle: string, body: string) {
    const script = `
      using terms from application "Messages"
        on run argv
          set targetHandle to item 1 of argv
          set messageText to item 2 of argv
          tell application "Messages"
            set targetService to 1st service whose service type = iMessage
            set targetParticipant to participant targetHandle of targetService
            send messageText to targetParticipant
          end tell
        end run
      end using terms from
    `;

    const { stderr } = await execFileAsync("/usr/bin/osascript", [
      "-l",
      "AppleScript",
      "-e",
      script,
      "--",
      handle,
      body,
    ]);

    if (stderr?.trim()) {
      throw new Error(stderr.trim());
    }
  }
}

declare global {
  var __companyAssistantPersonalChannelsGateway:
    | PersonalChannelsGateway
    | undefined;
}

function getGateway() {
  if (!globalThis.__companyAssistantPersonalChannelsGateway) {
    globalThis.__companyAssistantPersonalChannelsGateway =
      new PersonalChannelsGateway();
  }

  return globalThis.__companyAssistantPersonalChannelsGateway;
}

export async function getPersonalChannelsStatus(user: SessionUser) {
  return getGateway().getStatus(user);
}

export async function connectPersonalWhatsApp(user: SessionUser) {
  return getGateway().connectWhatsApp(user);
}

export async function disconnectPersonalWhatsApp(user: SessionUser) {
  return getGateway().disconnectWhatsApp(user);
}

export async function connectIMessageChannel(user: SessionUser, handle: string) {
  return getGateway().connectIMessage(user, handle);
}

export async function disconnectIMessageChannel(user: SessionUser) {
  return getGateway().disconnectIMessage(user);
}

export async function sendLinkedUserNotification(input: {
  userId: string;
  body: string;
  channelPreference?: "AUTO" | "WHATSAPP" | "IMESSAGE";
}) {
  return getGateway().sendLinkedUserNotification(input);
}
