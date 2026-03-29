"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { translate } from "@/shared/ui/types";

type AssistantConversationDetail = {
  conversation: {
    id: string;
    pendingActions: number;
  };
  messages: Array<{
    id: string;
    senderType: "USER" | "ASSISTANT" | "SYSTEM";
    body: string;
    createdAt: string;
  }>;
  actionRequests: Array<{
    id: string;
    title: string;
    summary: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";
  }>;
};

type AssistantDrawerProps = {
  canExecuteActions: boolean;
  canConfigureWhatsAppProvider: boolean;
};

type PendingActionRequest = {
  id: string;
  conversationId: string;
  requesterName: string;
  title: string;
  summary: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";
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
    status: "disconnected" | "connecting" | "pairing" | "connected" | "error";
    phoneNumber: string | null;
    qrDataUrl: string | null;
    lastError: string | null;
    usesPersonalAccount: true;
    selfChatOnly: true;
  };
  iMessage: {
    available: boolean;
    status: "unavailable" | "disconnected" | "connected" | "error";
    handle: string | null;
    lastError: string | null;
    hostOnly: true;
    dbPath: string;
  };
};

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        data?: T;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? "Request failed.");
  }

  return body.data;
}

function formatMessageTime(value: string, locale: "el" | "en") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "el-GR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getMessageBubbleClass(senderType: AssistantConversationDetail["messages"][number]["senderType"]) {
  if (senderType === "USER") {
    return "ml-auto max-w-[85%] rounded-[1.5rem] bg-slate-950 px-4 py-3 text-sm leading-6 text-white";
  }

  if (senderType === "SYSTEM") {
    return "max-w-[88%] rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900";
  }

  return "max-w-[88%] rounded-[1.5rem] border border-line bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700";
}

export function AssistantDrawer({
  canExecuteActions,
  canConfigureWhatsAppProvider,
}: AssistantDrawerProps) {
  const { locale } = useUiPreferences();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState<AssistantConversationDetail | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingActionRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [codexAuthenticated, setCodexAuthenticated] = useState<boolean | null>(null);
  const [personalChannels, setPersonalChannels] = useState<PersonalChannelsStatus | null>(null);
  const [iMessageHandle, setIMessageHandle] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  async function reloadPendingRequests() {
    const nextPendingRequests = await fetchJson<PendingActionRequest[]>(
      "/api/assistant/action-requests",
    );
    setPendingRequests(nextPendingRequests.filter((item) => item.status === "PENDING"));
  }

  async function reloadPersonalChannelsStatus() {
    const nextStatus = await fetchJson<PersonalChannelsStatus>("/api/assistant/personal-channels");
    setPersonalChannels(nextStatus);
    setIMessageHandle(nextStatus.iMessage.handle ?? "");
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void (async () => {
      let nextPersonalChannels: PersonalChannelsStatus | null = null;

      try {
        try {
          nextPersonalChannels = await fetchJson<PersonalChannelsStatus>(
            "/api/assistant/personal-channels",
          );
        } catch (channelsError) {
          startTransition(() => {
            setChannelError(
              channelsError instanceof Error
                ? channelsError.message
                : "Channel status load failed.",
            );
          });
        }

        const result = await fetchJson<{ authenticated: boolean }>(
          "/api/assistant/codex-auth-status",
        );
        if (!result.authenticated) {
          startTransition(() => {
            setPersonalChannels(nextPersonalChannels);
            setIMessageHandle(nextPersonalChannels?.iMessage.handle ?? "");
            setCodexAuthenticated(false);
            setDetail(null);
            setPendingRequests([]);
          });
          return;
        }

        const conversations = await fetchJson<Array<{ id: string }>>(
          "/api/assistant/conversations",
        );
        const conversation =
          conversations[0] ??
          (await fetchJson<{ id: string }>("/api/assistant/conversations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              channel: "APP",
              contextType: "GLOBAL",
            }),
          }));

        const nextDetail = await fetchJson<AssistantConversationDetail>(
          `/api/assistant/conversations/${conversation.id}/messages`,
        );
        const nextPendingRequests = await fetchJson<PendingActionRequest[]>(
          "/api/assistant/action-requests",
        );

        startTransition(() => {
          setPersonalChannels(nextPersonalChannels);
          setIMessageHandle(nextPersonalChannels?.iMessage.handle ?? "");
          setCodexAuthenticated(true);
          setDetail(nextDetail);
          setPendingRequests(
            nextPendingRequests.filter((item) => item.status === "PENDING"),
          );
          setError(null);
        });
      } catch (nextError) {
        startTransition(() => {
          setCodexAuthenticated(false);
          setError(
            nextError instanceof Error ? nextError.message : "Assistant load failed.",
          );
        });
      }
    })();
  }, [isOpen]);

  // Check for codex_auth query param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codexAuth = params.get("codex_auth");

    if (codexAuth === "success") {
      startTransition(() => {
        setIsOpen(true);
        setCodexAuthenticated(null);
        setError(null);
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("codex_auth");
      window.history.replaceState({}, "", url.toString());
    } else if (codexAuth === "error") {
      startTransition(() => {
        setIsOpen(true);
        setCodexAuthenticated(false);
        setError(params.get("message") ?? "OpenAI login failed.");
      });
      const url = new URL(window.location.href);
      url.searchParams.delete("codex_auth");
      url.searchParams.delete("message");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  function reloadConversation(conversationId: string) {
    startTransition(() => {
      void (async () => {
        try {
          const nextDetail = await fetchJson<AssistantConversationDetail>(
            `/api/assistant/conversations/${conversationId}/messages`,
          );
          await reloadPendingRequests();
          setDetail(nextDetail);
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Assistant refresh failed.");
        }
      })();
    });
  }

  function handleSendMessage() {
    const nextMessage = message.trim();

    if (nextMessage.length < 2 || codexAuthenticated !== true || isSendingMessage) {
      return;
    }

    const previousDetail = detail;
    const previousMessage = message;
    const optimisticMessage = {
      id: `pending-${Date.now()}`,
      senderType: "USER" as const,
      body: nextMessage,
      createdAt: new Date().toISOString(),
    };

    setIsSendingMessage(true);
    setMessage("");
    setError(null);

    void (async () => {
      try {
        const conversationId =
          previousDetail?.conversation.id ??
          (
            await fetchJson<{ id: string }>("/api/assistant/conversations", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                channel: "APP",
                contextType: "GLOBAL",
              }),
            })
          ).id;

        startTransition(() => {
          setDetail({
            conversation: {
              id: conversationId,
              pendingActions: previousDetail?.conversation.pendingActions ?? 0,
            },
            messages: [...(previousDetail?.messages ?? []), optimisticMessage],
            actionRequests: previousDetail?.actionRequests ?? [],
          });
        });

        const nextDetail = await fetchJson<AssistantConversationDetail>("/api/assistant/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            conversationId,
            body: nextMessage,
            locale,
            channel: "APP",
            contextType: "GLOBAL",
          }),
        });

        startTransition(() => {
          setDetail(nextDetail);
        });
        void reloadPendingRequests().catch(() => null);
      } catch (nextError) {
        startTransition(() => {
          setDetail(previousDetail);
          setMessage(previousMessage);
          setError(nextError instanceof Error ? nextError.message : "Assistant send failed.");
        });
      } finally {
        setIsSendingMessage(false);
      }
    })();
  }

  function handleClearChat() {
    startTransition(() => {
      void (async () => {
        try {
          const conversation = await fetchJson<{ id: string }>(
            "/api/assistant/conversations",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                channel: "APP",
                contextType: "GLOBAL",
              }),
            },
          );

          setDetail({
            conversation: {
              id: conversation.id,
              pendingActions: 0,
            },
            messages: [],
            actionRequests: [],
          });
          setMessage("");
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Assistant reset failed.");
        }
      })();
    });
  }

  function handleDecision(actionRequestId: string, decision: "approve" | "reject") {
    startTransition(() => {
      void (async () => {
        try {
          const nextDetail = await fetchJson<AssistantConversationDetail>(
            `/api/assistant/action-requests/${actionRequestId}/${decision}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                locale,
              }),
            },
          );

          await reloadPendingRequests();
          setDetail(nextDetail);
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Decision failed.");
        }
      })();
    });
  }

  function handleCodexLogin() {
    const url = new URL(window.location.href);
    url.searchParams.delete("codex_auth");
    url.searchParams.delete("message");
    const returnTo = `${url.pathname}${url.search}`;
    window.location.href = `/api/assistant/codex-auth-start?returnTo=${encodeURIComponent(returnTo)}`;
  }

  function handleCodexLogout() {
    startTransition(() => {
      void (async () => {
        try {
          await fetch("/api/assistant/codex-auth-logout", { method: "POST" });
          setCodexAuthenticated(false);
          setDetail(null);
          setPendingRequests([]);
          setMessage("");
          setError(null);
        } catch {
          // ignore
        }
      })();
    });
  }

  function handleRefreshChannels() {
    startTransition(() => {
      void (async () => {
        try {
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error ? nextError.message : "Channel refresh failed.",
          );
        }
      })();
    });
  }

  function handleConnectPersonalWhatsApp() {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson<Record<string, unknown>>(
            "/api/assistant/personal-channels/whatsapp/connect",
            { method: "POST" },
          );
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error
              ? nextError.message
              : "WhatsApp personal connection failed.",
          );
        }
      })();
    });
  }

  function handleDisconnectPersonalWhatsApp() {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson<Record<string, unknown>>(
            "/api/assistant/personal-channels/whatsapp/disconnect",
            { method: "POST" },
          );
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error
              ? nextError.message
              : "WhatsApp personal disconnect failed.",
          );
        }
      })();
    });
  }

  function handleConnectWhatsAppProvider() {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson<Record<string, unknown>>(
            "/api/assistant/whatsapp-link/provider",
            { method: "POST" },
          );
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error ? nextError.message : "WhatsApp provider setup failed.",
          );
        }
      })();
    });
  }

  function handleDisconnectWhatsAppProvider() {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson<Record<string, unknown>>(
            "/api/assistant/whatsapp-link/provider",
            { method: "DELETE" },
          );
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error ? nextError.message : "WhatsApp provider disconnect failed.",
          );
        }
      })();
    });
  }

  function handleConnectIMessage() {
    const nextHandle = iMessageHandle.trim();
    if (nextHandle.length < 3) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          await fetchJson<Record<string, unknown>>(
            "/api/assistant/personal-channels/imessage/connect",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                handle: nextHandle,
              }),
            },
          );
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error ? nextError.message : "iMessage connect failed.",
          );
        }
      })();
    });
  }

  function handleDisconnectIMessage() {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson<Record<string, unknown>>(
            "/api/assistant/personal-channels/imessage/disconnect",
            { method: "POST" },
          );
          await reloadPersonalChannelsStatus();
          setChannelError(null);
        } catch (nextError) {
          setChannelError(
            nextError instanceof Error ? nextError.message : "iMessage disconnect failed.",
          );
        }
      })();
    });
  }

  useEffect(() => {
    if (isOpen && codexAuthenticated === true) {
      textareaRef.current?.focus();
    }
  }, [codexAuthenticated, detail?.conversation.id, isOpen]);

  useEffect(() => {
    if (!isOpen || !personalChannels) {
      return;
    }

    if (
      personalChannels.whatsApp.status !== "connecting" &&
      personalChannels.whatsApp.status !== "pairing"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void reloadPersonalChannelsStatus().catch(() => {
        // leave the current error message untouched during background polling
      });
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isOpen, personalChannels]);

  useEffect(() => {
    if (isOpen && codexAuthenticated === true) {
      messagesEndRef.current?.scrollIntoView({
        block: "end",
      });
    }
  }, [codexAuthenticated, detail?.messages.length, isOpen]);

  const hasMessages = Boolean(detail && detail.messages.length > 0);
  const hasComposerContent = message.trim().length > 0;

  function renderChannelsCard() {
    if (!personalChannels) {
      return null;
    }

    return (
      <div className="rounded-[1.6rem] border border-line bg-white/80 p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
          {translate(locale, {
            el: "προσωπικά channels",
            en: "personal channels",
          })}
        </p>
        <div className="mt-3 space-y-3">
          <div className="rounded-[1.2rem] bg-slate-50 px-4 py-3">
            <p className="text-sm font-medium text-slate-900">
              {translate(locale, {
                el: personalChannels.assistantProvider.ready
                  ? "Ο shared assistant provider είναι έτοιμος."
                  : "Ο shared assistant provider δεν είναι ακόμη έτοιμος.",
                en: personalChannels.assistantProvider.ready
                  ? "The shared assistant provider is ready."
                  : "The shared assistant provider is not ready yet.",
              })}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {personalChannels.assistantProvider.ready
                ? translate(locale, {
                    el: `Provider από ${personalChannels.assistantProvider.configuredByName ?? "άγνωστο χρήστη"}.`,
                    en: `Provider set by ${personalChannels.assistantProvider.configuredByName ?? "an unknown user"}.`,
                  })
                : translate(locale, {
                    el: "Χρειάζεται μία ενεργή OpenAI σύνδεση από admin για να απαντούν τα personal channels στον assistant.",
                    en: "A current admin OpenAI connection is required before personal channels can talk to the assistant.",
                  })}
            </p>
            {canConfigureWhatsAppProvider ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleConnectWhatsAppProvider}
                  disabled={isPending || codexAuthenticated !== true}
                  className="rounded-full border border-line px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-50"
                >
                  {translate(locale, {
                    el: personalChannels.assistantProvider.ready
                      ? "Ανανέωση OpenAI provider"
                      : "Χρήση τρέχουσας OpenAI σύνδεσης",
                    en: personalChannels.assistantProvider.ready
                      ? "Refresh OpenAI provider"
                      : "Use current OpenAI connection",
                  })}
                </button>
                {personalChannels.assistantProvider.ready ? (
                  <button
                    type="button"
                    onClick={handleDisconnectWhatsAppProvider}
                    disabled={isPending}
                    className="rounded-full border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    {translate(locale, {
                      el: "Απενεργοποίηση WhatsApp provider",
                      en: "Disable WhatsApp provider",
                    })}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-[1.2rem] bg-slate-50 px-4 py-3">
            <p className="text-sm font-medium text-slate-900">
              {translate(locale, {
                el: personalChannels.whatsApp.status === "connected"
                  ? `WhatsApp personal συνδεδεμένο: ${personalChannels.whatsApp.phoneNumber ?? "άγνωστος αριθμός"}`
                  : personalChannels.whatsApp.status === "pairing"
                    ? "Το WhatsApp περιμένει σκανάρισμα QR."
                    : personalChannels.whatsApp.status === "connecting"
                      ? "Εκκίνηση σύνδεσης WhatsApp…"
                      : personalChannels.whatsApp.status === "error"
                        ? "Η σύνδεση WhatsApp απέτυχε."
                        : "Το προσωπικό WhatsApp δεν είναι ακόμη συνδεδεμένο.",
                en: personalChannels.whatsApp.status === "connected"
                  ? `Personal WhatsApp connected: ${personalChannels.whatsApp.phoneNumber ?? "unknown number"}`
                  : personalChannels.whatsApp.status === "pairing"
                    ? "WhatsApp is waiting for a QR scan."
                    : personalChannels.whatsApp.status === "connecting"
                      ? "Starting WhatsApp connection…"
                      : personalChannels.whatsApp.status === "error"
                        ? "WhatsApp connection failed."
                        : "Personal WhatsApp is not connected yet.",
              })}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {translate(locale, {
                el: "Το channel δουλεύει με το δικό σου WhatsApp account σαν linked device και απαντά μόνο στο self-chat σου.",
                en: "This channel uses your own WhatsApp account as a linked device and only responds in your self-chat.",
              })}
            </p>
            {personalChannels.whatsApp.qrDataUrl ? (
              <div className="mt-3 rounded-[1rem] border border-dashed border-teal-200 bg-white px-4 py-4">
                <Image
                  src={personalChannels.whatsApp.qrDataUrl}
                  alt="WhatsApp personal QR"
                  width={192}
                  height={192}
                  unoptimized
                  className="mx-auto h-48 w-48 rounded-xl border border-line bg-white p-2"
                />
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {translate(locale, {
                    el: "Σκάναρε αυτό το QR από WhatsApp > Linked Devices > Link a Device.",
                    en: "Scan this QR from WhatsApp > Linked Devices > Link a Device.",
                  })}
                </p>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleConnectPersonalWhatsApp}
                disabled={isPending}
                className="rounded-full border border-line px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-50"
              >
                {translate(locale, {
                  el: personalChannels.whatsApp.status === "connected"
                    ? "Ανανέωση WhatsApp session"
                    : "Σύνδεση WhatsApp personal",
                  en: personalChannels.whatsApp.status === "connected"
                    ? "Refresh WhatsApp session"
                    : "Connect personal WhatsApp",
                })}
              </button>
              {personalChannels.whatsApp.status === "connected" ||
              personalChannels.whatsApp.status === "pairing" ? (
                <button
                  type="button"
                  onClick={handleDisconnectPersonalWhatsApp}
                  disabled={isPending}
                  className="rounded-full border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  {translate(locale, {
                    el: "Αποσύνδεση WhatsApp",
                    en: "Disconnect WhatsApp",
                  })}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleRefreshChannels}
                disabled={isPending}
                className="rounded-full border border-line px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-50"
              >
                {translate(locale, {
                  el: "Ανανέωση channels",
                  en: "Refresh channels",
                })}
              </button>
            </div>
            {personalChannels.whatsApp.lastError ? (
              <p className="mt-3 text-sm text-rose-600">
                {personalChannels.whatsApp.lastError}
              </p>
            ) : null}
          </div>

          <div className="rounded-[1.2rem] bg-slate-50 px-4 py-3">
            <p className="text-sm font-medium text-slate-900">
              {translate(locale, {
                el: !personalChannels.iMessage.available
                  ? "Το iMessage δεν είναι διαθέσιμο σε αυτό το Mac."
                  : personalChannels.iMessage.status === "error"
                    ? "Το iMessage μπλοκάρεται από το macOS."
                    : personalChannels.iMessage.handle
                      ? `iMessage ενεργό στο Mac για ${personalChannels.iMessage.handle}`
                      : "Το iMessage είναι διαθέσιμο σε αυτό το Mac.",
                en: !personalChannels.iMessage.available
                  ? "iMessage is not available on this Mac."
                  : personalChannels.iMessage.status === "error"
                    ? "iMessage is blocked by macOS permissions."
                    : personalChannels.iMessage.handle
                      ? `iMessage is active on this Mac for ${personalChannels.iMessage.handle}`
                      : "iMessage is available on this Mac.",
              })}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {translate(locale, {
                el: "Το iMessage είναι host-level channel. Χρησιμοποιεί το Messages.app του παρόντος Mac και είναι πρακτικά διαθέσιμο μόνο για τα handles που είναι signed-in εδώ.",
                en: "iMessage is a host-level channel. It uses Messages.app on this Mac and is only practical for the handles signed in here.",
              })}
            </p>
            {personalChannels.iMessage.available ? (
              <div className="mt-3 flex flex-col gap-2">
                <input
                  type="text"
                  value={iMessageHandle}
                  onChange={(event) => {
                    setIMessageHandle(event.target.value);
                  }}
                  placeholder={translate(locale, {
                    el: "π.χ. +3069... ή your@icloud.com",
                    en: "for example +3069... or your@icloud.com",
                  })}
                  className="rounded-[1rem] border border-line bg-white px-4 py-3 text-sm text-slate-900 outline-none"
                  disabled={isPending}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleConnectIMessage}
                    disabled={isPending || iMessageHandle.trim().length < 3}
                    className="rounded-full border border-line px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-50"
                  >
                    {translate(locale, {
                      el: personalChannels.iMessage.handle
                        ? "Αλλαγή iMessage handle"
                        : "Σύνδεση iMessage",
                      en: personalChannels.iMessage.handle
                        ? "Change iMessage handle"
                        : "Connect iMessage",
                    })}
                  </button>
                  {personalChannels.iMessage.handle ? (
                    <button
                      type="button"
                      onClick={handleDisconnectIMessage}
                      disabled={isPending}
                      className="rounded-full border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      {translate(locale, {
                        el: "Αποσύνδεση iMessage",
                        en: "Disconnect iMessage",
                      })}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {personalChannels.iMessage.lastError ? (
              <p className="mt-3 text-sm text-rose-600">
                {personalChannels.iMessage.lastError}
              </p>
            ) : null}
          </div>

          {channelError ? (
            <div className="rounded-[1.2rem] bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {channelError}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      {!isOpen ? (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
          }}
          className="fixed bottom-20 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_20px_44px_rgba(15,23,42,0.22)] transition hover:bg-slate-800 lg:bottom-6 lg:right-6"
        >
          {translate(locale, {
            el: "Assistant",
            en: "Assistant",
          })}
          {codexAuthenticated ? (
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          ) : null}
          {pendingRequests.length > 0 ? (
            <span className="rounded-full bg-teal-400 px-2 py-0.5 text-[11px] font-semibold text-slate-950">
              {pendingRequests.length}
            </span>
          ) : null}
        </button>
      ) : null}

      {isOpen ? (
        <div className="fixed inset-0 z-40 bg-[rgba(2,6,23,0.42)] backdrop-blur-[2px]">
          <div className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-line bg-background shadow-[0_30px_80px_rgba(2,6,23,0.28)]">
            <div className="border-b border-line px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs uppercase tracking-[0.24em] text-teal-700">
                      {translate(locale, {
                        el: "assistant προγράμματος",
                        en: "app assistant",
                      })}
                    </p>
                    {codexAuthenticated ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {translate(locale, {
                          el: "Συνδεδεμένο",
                          en: "Connected",
                        })}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-2 max-w-[16ch] text-2xl font-semibold leading-tight tracking-[-0.04em] text-slate-950">
                    {translate(locale, {
                      el: "Συνομιλία και actions",
                      en: "Conversation and actions",
                    })}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                  }}
                  className="shrink-0 rounded-full border border-line px-3 py-2 text-sm text-slate-600 transition hover:bg-white/70"
                >
                  {translate(locale, {
                    el: "Κλείσιμο",
                    en: "Close",
                  })}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {codexAuthenticated === true ? (
                  <button
                    type="button"
                    onClick={handleClearChat}
                    disabled={isPending || (!hasMessages && !hasComposerContent)}
                    className="flex min-h-11 w-full items-center justify-center rounded-[1rem] border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/70 disabled:opacity-50"
                  >
                    {translate(locale, {
                      el: "Καθαρισμός chat",
                      en: "Clear chat",
                    })}
                  </button>
                ) : null}
                {codexAuthenticated === true && detail ? (
                  <button
                    type="button"
                    onClick={() => {
                      reloadConversation(detail.conversation.id);
                    }}
                    disabled={isPending}
                    className="flex min-h-11 w-full items-center justify-center rounded-[1rem] border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/70 disabled:opacity-50"
                  >
                    {translate(locale, {
                      el: "Ανανέωση συνομιλίας",
                      en: "Refresh conversation",
                    })}
                  </button>
                ) : null}
                {codexAuthenticated !== false ? (
                  <button
                    type="button"
                    onClick={handleCodexLogout}
                    disabled={isPending}
                    className="flex min-h-11 w-full items-center justify-center rounded-[1rem] border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                  >
                    {translate(locale, {
                      el: "Αποσύνδεση OpenAI",
                      en: "Disconnect OpenAI",
                    })}
                  </button>
                ) : null}
              </div>
            </div>

            {codexAuthenticated === null ? (
              <div className="flex flex-1 items-center justify-center px-8">
                <div className="text-center">
                  <h4 className="text-lg font-semibold text-slate-900">
                    {translate(locale, {
                      el: "Έλεγχος σύνδεσης OpenAI",
                      en: "Checking OpenAI connection",
                    })}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {translate(locale, {
                      el: "Επιβεβαιώνουμε αν ο assistant είναι ήδη συνδεδεμένος.",
                      en: "Verifying whether the assistant is already connected.",
                    })}
                  </p>
                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={handleCodexLogout}
                      disabled={isPending}
                      className="rounded-full border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                    >
                      {translate(locale, {
                        el: "Αποσύνδεση OpenAI",
                        en: "Disconnect OpenAI",
                      })}
                    </button>
                  </div>
                </div>
              </div>
            ) : codexAuthenticated === false ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-teal-50 to-emerald-50">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="h-10 w-10 text-teal-600"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                    />
                  </svg>
                </div>
                <div className="text-center">
                  <h4 className="text-lg font-semibold text-slate-900">
                    {translate(locale, {
                      el: "Σύνδεση με OpenAI",
                      en: "Connect to OpenAI",
                    })}
                  </h4>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {translate(locale, {
                      el: "Συνδέσου με τον λογαριασμό ChatGPT σου για να ενεργοποιήσεις τον AI assistant.",
                      en: "Sign in with your ChatGPT account to activate the AI assistant.",
                    })}
                  </p>
                </div>
                {error ? (
                  <div className="w-full rounded-[1.4rem] bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={handleCodexLogin}
                  className="inline-flex items-center gap-3 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800 hover:shadow-xl"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4091-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0974-2.3616l2.603-1.5018 2.6032 1.5018v3.0036l-2.6032 1.5018-2.603-1.5018z" />
                  </svg>
                  {translate(locale, {
                    el: "Login with OpenAI",
                    en: "Login with OpenAI",
                  })}
                </button>
                <div className="w-full">{renderChannelsCard()}</div>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                  {error ? (
                    <div className="mb-4 rounded-[1.4rem] bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}

                  <div className="mb-5">{renderChannelsCard()}</div>

                  {pendingRequests.length > 0 ? (
                    <div className="mb-5 space-y-3">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                        {translate(locale, {
                          el: "εκκρεμείς εγκρίσεις",
                          en: "pending approvals",
                        })}
                      </p>
                      {pendingRequests.map((request) => (
                        <div key={request.id} className="panel rounded-[1.6rem] p-4">
                          <h4 className="text-base font-semibold text-slate-950">{request.title}</h4>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{request.summary}</p>
                          <p className="mt-3 text-sm text-slate-500">
                            {translate(locale, {
                              el: `Αιτών: ${request.requesterName}`,
                              en: `Requested by: ${request.requesterName}`,
                            })}
                          </p>
                          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                            {request.id}
                          </p>
                          {canExecuteActions ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  handleDecision(request.id, "approve");
                                }}
                                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
                              >
                                {translate(locale, {
                                  el: "Έγκριση",
                                  en: "Approve",
                                })}
                              </button>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  handleDecision(request.id, "reject");
                                }}
                                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/70 disabled:opacity-60"
                              >
                                {translate(locale, {
                                  el: "Απόρριψη",
                                  en: "Reject",
                                })}
                              </button>
                            </div>
                          ) : (
                            <p className="mt-4 text-sm text-slate-500">
                              {translate(locale, {
                                el: "Δεν έχεις δικαίωμα execution. Ζήτησε από admin ή operator να εγκρίνει την ενέργεια.",
                                en: "You do not have execution permission. Ask an admin or operator to approve this action.",
                              })}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {detail?.messages.map((item) => (
                      <div key={item.id}>
                        <div className={getMessageBubbleClass(item.senderType)}>{item.body}</div>
                        <p className="mt-1 px-1 text-xs text-slate-400">
                          {formatMessageTime(item.createdAt, locale)}
                        </p>
                      </div>
                    ))}

                    {detail && detail.messages.length === 0 ? (
                      <div className="rounded-[1.6rem] border border-dashed border-line bg-white/70 px-5 py-6 text-sm leading-6 text-slate-500">
                        {translate(locale, {
                          el: "Ξεκίνα φυσικά, π.χ. «κλείσε ραντεβού για τον πελάτη Παπαδόπουλος αύριο στις 10 με τον Νίκο», «βρες τα σημερινά work orders μου», «γράψε 45 λεπτά στο κλιματιστικό της Alpha» ή «έλεγξε για κρίσιμα γεγονότα». Πάτησε Enter για αποστολή και Shift+Enter για νέα γραμμή.",
                          en: "Start naturally, for example: “schedule an appointment for customer Alpha tomorrow at 10 with Nikos”, “show my work orders for today”, “log 45 minutes on Alpha's AC job”, or “review critical events”. Press Enter to send and Shift+Enter for a new line.",
                        })}
                      </div>
                    ) : null}

                    {!detail && !error ? (
                      <div className="text-sm text-slate-500">
                        {translate(locale, {
                          el: "Φόρτωση assistant…",
                          en: "Loading assistant…",
                        })}
                      </div>
                    ) : null}

                    <div ref={messagesEndRef} />
                  </div>
                </div>

                <div className="border-t border-line bg-background/95 px-5 py-4 backdrop-blur">
                  <form
                    className="rounded-[1.7rem] border border-line bg-white/80 p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSendMessage();
                    }}
                  >
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(event) => {
                        setMessage(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      rows={3}
                      placeholder={translate(locale, {
                        el: "Γράψε π.χ. «κλείσε ραντεβού για την Alpha αύριο στις 10», «άνοιξε νέο work order για διαρροή στο Κέντρο», «γράψε 30 λεπτά και 1 φίλτρο στο σημερινό έργο μου», «έλεγξε κρίσιμα γεγονότα»",
                        en: "Write for example “schedule Alpha tomorrow at 10”, “open a work order for the leak at Downtown”, “log 30 minutes and 1 filter on my current job”, or “review critical events”",
                      })}
                      className="w-full resize-none bg-transparent text-sm leading-6 text-slate-900 outline-none disabled:opacity-60"
                      disabled={isPending || isSendingMessage}
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-400">
                        {translate(locale, {
                          el: "Enter για αποστολή, Shift+Enter για νέα γραμμή.",
                          en: "Press Enter to send, Shift+Enter for a new line.",
                        })}
                      </p>
                      <div className="flex items-center gap-3">
                        <p className="text-xs text-slate-400">
                          {translate(locale, {
                            el: "Powered by OpenAI Codex",
                            en: "Powered by OpenAI Codex",
                          })}
                        </p>
                        <button
                          type="submit"
                          disabled={isPending || isSendingMessage || message.trim().length < 2}
                          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                        >
                          {translate(locale, {
                            el: isSendingMessage || isPending ? "Αποστολή…" : "Αποστολή",
                            en: isSendingMessage || isPending ? "Sending…" : "Send",
                          })}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
