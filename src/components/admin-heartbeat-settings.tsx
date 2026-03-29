"use client";

import { useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { translate } from "@/shared/ui/types";

type HeartbeatNotificationRecord = {
  id: string;
  recipientUserName: string;
  channel: "WHATSAPP" | "IMESSAGE" | null;
  delivered: boolean;
  payload: string;
  reason: string | null;
  attemptCount: number;
  createdAt: string;
  deliveredAt: string | null;
};

type HeartbeatSettingsRecord = {
  enabled: boolean;
  cadenceValue: number;
  cadenceUnit: "MINUTES" | "HOURS" | "DAYS";
  cadenceMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastCursorAt: string | null;
  lastDeliveryAt: string | null;
  lastRunStatus: "IDLE" | "SUCCESS" | "FAILED";
  lastRunSummary: string | null;
  lastError: string | null;
  clock: {
    timeZone: string;
    companyDateTime: string;
    externalVerification?: {
      status: "verified" | "drift_warning" | "unavailable";
      offsetMs: number | null;
    } | null;
  };
  recentNotifications: HeartbeatNotificationRecord[];
};

type HeartbeatApiResponse =
  | {
      ok: true;
      data: HeartbeatSettingsRecord;
    }
  | {
      error?: {
        message?: string;
      };
    };

type HeartbeatRunApiResponse =
  | {
      ok: true;
      data: {
        run: {
          ok: boolean;
          summary: string;
          deliveredCount: number;
        };
        settings: HeartbeatSettingsRecord;
      };
    }
  | {
      error?: {
        message?: string;
      };
    };

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

const inputClassName =
  "mt-2 w-full rounded-[1.35rem] border border-white/30 bg-white/52 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[var(--accent)] dark:border-white/10 dark:bg-white/8 dark:text-slate-100";

function getApiErrorMessage(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return null;
}

export function AdminHeartbeatSettings({
  initialSettings,
}: {
  initialSettings: HeartbeatSettingsRecord;
}) {
  const { locale } = useUiPreferences();
  const [settings, setSettings] = useState(initialSettings);
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [cadenceValue, setCadenceValue] = useState(String(initialSettings.cadenceValue));
  const [cadenceUnit, setCadenceUnit] = useState<HeartbeatSettingsRecord["cadenceUnit"]>(
    initialSettings.cadenceUnit,
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = (values: { el: string; en: string }) => translate(locale, values);
  const formatDate = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(locale === "el" ? "el-GR" : "en-US")
      : t({ el: "Δεν υπάρχει ακόμα", en: "Not available yet" });

  async function saveSettings() {
    const response = await fetch("/api/admin/heartbeat", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled,
        cadenceValue: Number(cadenceValue),
        cadenceUnit,
      }),
    });
    const body = (await response.json()) as HeartbeatApiResponse;

    if (!response.ok || !("ok" in body && body.ok)) {
      throw new Error(
        getApiErrorMessage(body) ??
          t({
            el: "Αποτυχία ενημέρωσης heartbeat.",
            en: "Heartbeat update failed.",
          }),
      );
    }

    setSettings(body.data);
    setEnabled(body.data.enabled);
    setCadenceValue(String(body.data.cadenceValue));
    setCadenceUnit(body.data.cadenceUnit);
    setFeedback({
      tone: "success",
      text: body.data.enabled
        ? t({
            el: "Το heartbeat αποθηκεύτηκε και παραμένει ενεργό.",
            en: "Heartbeat settings were saved and remain active.",
          })
        : t({
            el: "Το heartbeat απενεργοποιήθηκε.",
            en: "Heartbeat was disabled.",
          }),
    });
  }

  async function runHeartbeatNow() {
    const response = await fetch("/api/admin/heartbeat/run", {
      method: "POST",
    });
    const body = (await response.json()) as HeartbeatRunApiResponse;

    if (!response.ok || !("ok" in body && body.ok)) {
      throw new Error(
        getApiErrorMessage(body) ??
          t({
            el: "Η χειροκίνητη εκτέλεση heartbeat απέτυχε.",
            en: "Manual heartbeat run failed.",
          }),
      );
    }

    setSettings(body.data.settings);
    setEnabled(body.data.settings.enabled);
    setCadenceValue(String(body.data.settings.cadenceValue));
    setCadenceUnit(body.data.settings.cadenceUnit);
    setFeedback({
      tone: body.data.run.ok ? "success" : "error",
      text:
        body.data.run.summary ||
        t({
          el: "Η εκτέλεση heartbeat ολοκληρώθηκε.",
          en: "Heartbeat run completed.",
        }),
    });
  }

  return (
    <section className="panel rounded-[2.25rem] p-5 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
            {t({ el: "admin heartbeat", en: "admin heartbeat" })}
          </p>
          <h3 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
            {t({
              el: "Αυτόματος έλεγχος αλλαγών και ειδοποιήσεων",
              en: "Automatic change and notification checks",
            })}
          </h3>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t({
              el: "Ο admin ρυθμίζει αν ο agent θα κάνει περιοδικούς κύκλους ελέγχου στη βάση για ραντεβού, work orders, follow-up και τιμολόγηση και θα ειδοποιεί τον κατάλληλο τεχνικό, owner ή admin σε WhatsApp ή iMessage.",
              en: "The admin controls whether the agent runs periodic database checks for appointments, work orders, follow-up, and invoicing, then notifies the appropriate technician, owner, or admin on WhatsApp or iMessage.",
            })}
          </p>
        </div>

        <div className="rounded-[1.7rem] border border-dashed border-white/28 bg-white/16 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
          <p>
            {t({ el: "Time zone", en: "Time zone" })}:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {settings.clock.timeZone}
            </span>
          </p>
          <p className="mt-1">
            {t({ el: "Επιβεβαιωμένη ώρα", en: "Verified time" })}:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {settings.clock.companyDateTime}
            </span>
          </p>
          <p className="mt-1">
            {t({ el: "Clock status", en: "Clock status" })}:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {settings.clock.externalVerification?.status ?? "system"}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-5 rounded-[1.95rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-white/30 text-[var(--accent)] focus:ring-[var(--accent)]"
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                {t({ el: "Ενεργό heartbeat", en: "Heartbeat enabled" })}
              </span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">
                {t({
                  el: "Όταν είναι ενεργό, ο scheduler κάνει background ελέγχους και στέλνει ειδοποιήσεις στους linked χρήστες.",
                  en: "When enabled, the scheduler performs background checks and sends notifications to linked users.",
                })}
              </span>
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-[minmax(0,120px)_minmax(0,180px)]">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t({ el: "Κάθε", en: "Every" })}
              <input
                type="number"
                min={1}
                max={365}
                value={cadenceValue}
                onChange={(event) => setCadenceValue(event.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t({ el: "Μονάδα", en: "Unit" })}
              <select
                value={cadenceUnit}
                onChange={(event) =>
                  setCadenceUnit(event.target.value as HeartbeatSettingsRecord["cadenceUnit"])
                }
                className={inputClassName}
              >
                <option value="MINUTES">{t({ el: "Λεπτά", en: "Minutes" })}</option>
                <option value="HOURS">{t({ el: "Ώρες", en: "Hours" })}</option>
                <option value="DAYS">{t({ el: "Ημέρες", en: "Days" })}</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(() => {
                  void saveSettings().catch((error: unknown) => {
                    setFeedback({
                      tone: "error",
                      text:
                        error instanceof Error
                          ? error.message
                          : t({
                              el: "Αποτυχία αποθήκευσης heartbeat.",
                              en: "Heartbeat save failed.",
                            }),
                    });
                  });
                })
              }
              className="glass-button rounded-full px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-60 dark:text-slate-50"
            >
              {t({ el: "Αποθήκευση heartbeat", en: "Save heartbeat" })}
            </button>

            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(() => {
                  void runHeartbeatNow().catch((error: unknown) => {
                    setFeedback({
                      tone: "error",
                      text:
                        error instanceof Error
                          ? error.message
                          : t({
                              el: "Η εκτέλεση heartbeat απέτυχε.",
                              en: "Heartbeat run failed.",
                            }),
                    });
                  });
                })
              }
              className="rounded-full border border-white/28 bg-white/16 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/30 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t({ el: "Εκτέλεση τώρα", en: "Run now" })}
            </button>
          </div>

          {feedback ? (
            <p
              className={`rounded-2xl px-3 py-2 text-sm ${
                feedback.tone === "success"
                  ? "bg-emerald-50/90 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300"
                  : "bg-rose-50/90 text-rose-700 dark:bg-rose-500/12 dark:text-rose-300"
              }`}
            >
              {feedback.text}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[1.9rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t({ el: "Επόμενος κύκλος", en: "Next cycle" })}
            </p>
            <p className="mt-3 text-lg font-medium text-slate-950 dark:text-slate-50">
              {formatDate(settings.nextRunAt)}
            </p>
          </div>
          <div className="rounded-[1.9rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t({ el: "Τελευταίο run", en: "Last run" })}
            </p>
            <p className="mt-3 text-lg font-medium text-slate-950 dark:text-slate-50">
              {formatDate(settings.lastRunAt)}
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {settings.lastRunStatus.toLowerCase()}
            </p>
          </div>
          <div className="rounded-[1.9rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t({ el: "Τελευταία παράδοση", en: "Last delivery" })}
            </p>
            <p className="mt-3 text-lg font-medium text-slate-950 dark:text-slate-50">
              {formatDate(settings.lastDeliveryAt)}
            </p>
          </div>
          <div className="rounded-[1.9rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t({ el: "Cadence", en: "Cadence" })}
            </p>
            <p className="mt-3 text-lg font-medium text-slate-950 dark:text-slate-50">
              {settings.cadenceValue} {cadenceUnit.toLowerCase()}
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {settings.cadenceMinutes} {t({ el: "λεπτά συνολικά", en: "minutes total" })}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[1.95rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t({ el: "Περίληψη heartbeat", en: "Heartbeat summary" })}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {settings.lastRunSummary ??
              t({
                el: "Δεν υπάρχει ακόμη καταγεγραμμένο αποτέλεσμα heartbeat.",
                en: "There is no recorded heartbeat result yet.",
              })}
          </p>
          {settings.lastError ? (
            <p className="mt-3 rounded-[1.35rem] bg-rose-50/90 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/12 dark:text-rose-300">
              {settings.lastError}
            </p>
          ) : null}
        </div>

        <div className="rounded-[1.95rem] border border-white/28 bg-white/20 px-4 py-4 shadow-[0_18px_42px_rgba(75,96,184,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {t({ el: "Παραλήπτες και deliveries", en: "Recipients and deliveries" })}
          </p>
          <div className="mt-3 space-y-3">
            {settings.recentNotifications.length > 0 ? (
              settings.recentNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="rounded-[1.45rem] border border-white/24 bg-white/18 px-3 py-3 text-sm dark:border-white/8 dark:bg-white/4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {notification.recipientUserName}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        {notification.channel ?? "NONE"} •{" "}
                        {notification.delivered
                          ? t({ el: "παραδόθηκε", en: "delivered" })
                          : t({ el: "εκκρεμεί / απέτυχε", en: "pending / failed" })}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(notification.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {notification.payload}
                  </p>
                  {notification.reason ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                      {notification.reason}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t({
                  el: "Δεν υπάρχουν ακόμα deliveries από heartbeat.",
                  en: "There are no heartbeat deliveries yet.",
                })}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
