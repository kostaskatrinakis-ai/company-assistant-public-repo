"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { translate } from "@/shared/ui/types";

type ReadyWorkOrder = {
  id: string;
  customerId: string;
  customerName: string;
  locationName: string;
  issueSummary: string;
};

type ReminderRecord = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  monthKey: string;
  state: "PENDING" | "QUEUED_FOR_MONTH" | "READY_FOR_ACCOUNTING" | "CLEARED" | "CANCELED";
  estimatedTotal: string;
  note: string | null;
  workOrders: Array<{
    id: string;
    issueSummary: string;
    state: string;
  }>;
};

type RemindersBoardProps = {
  readyWorkOrders: ReadyWorkOrder[];
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

export function RemindersBoard({ readyWorkOrders }: RemindersBoardProps) {
  const { locale } = useUiPreferences();
  const [isPending, startTransition] = useTransition();
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [amountByWorkOrder, setAmountByWorkOrder] = useState<Record<string, string>>({});
  const [noteByWorkOrder, setNoteByWorkOrder] = useState<Record<string, string>>({});

  function reload() {
    startTransition(() => {
      void (async () => {
        try {
          const nextReminders = await fetchJson<ReminderRecord[]>("/api/reminders");
          setReminders(nextReminders);
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Reminder load failed.");
        }
      })();
    });
  }

  useEffect(() => {
    reload();
  }, []);

  const remindersByCustomer = useMemo(() => {
    return new Map(reminders.map((reminder) => [reminder.customerId, reminder]));
  }, [reminders]);

  function createReminder(workOrder: ReadyWorkOrder) {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson("/api/reminders", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              customerId: workOrder.customerId,
              workOrderIds: [workOrder.id],
              estimatedTotal: Number(amountByWorkOrder[workOrder.id] ?? 0),
              note: noteByWorkOrder[workOrder.id]?.trim() || null,
            }),
          });
          reload();
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Reminder creation failed.");
        }
      })();
    });
  }

  function runReminderAction(reminderId: string, action: "queue" | "ready") {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson(
            `/api/reminders/${reminderId}/${action === "queue" ? "queue" : "ready"}`,
            {
              method: "POST",
            },
          );
          reload();
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "Reminder update failed.");
        }
      })();
    });
  }

  function sendReminderWhatsApp(reminder: ReminderRecord) {
    startTransition(() => {
      void (async () => {
        try {
          await fetchJson(`/api/reminders/${reminder.id}/notify`, {
            method: "POST",
          });
          setError(null);
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "WhatsApp send failed.");
        }
      })();
    });
  }

  return (
    <div className="space-y-6">
      <div className="panel rounded-[2rem] p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
          {translate(locale, {
            el: "παράδοση τιμολόγησης",
            en: "invoice handoff",
          })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
          {translate(locale, {
            el: "Reminders και αποστολές",
            en: "Reminders and outbound handoff",
          })}
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {translate(locale, {
            el: "Από εδώ δημιουργείς reminder από ready work order, το περνάς σε μηνιαίο queue ή accounting-ready και στέλνεις outbound WhatsApp ενημέρωση.",
            en: "From here you create reminders from ready work orders, move them to the monthly queue or accounting-ready, and send outbound WhatsApp updates.",
          })}
        </p>
      </div>

      {error ? (
        <div className="rounded-[1.4rem] bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="panel rounded-[2rem] p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
            {translate(locale, {
              el: "έτοιμα work orders",
              en: "ready work orders",
            })}
          </p>
          <div className="mt-4 space-y-4">
            {readyWorkOrders.length > 0 ? (
              readyWorkOrders.map((workOrder) => {
                const linkedReminder = remindersByCustomer.get(workOrder.customerId);

                return (
                  <div key={workOrder.id} className="rounded-[1.6rem] border border-line bg-white/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-slate-950">
                          {workOrder.customerName}
                        </h4>
                        <p className="mt-1 text-sm text-slate-500">{workOrder.locationName}</p>
                      </div>
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-800">
                        {workOrder.id}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{workOrder.issueSummary}</p>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="text-sm font-medium text-slate-700">
                        {translate(locale, {
                          el: "Εκτίμηση ποσού",
                          en: "Amount estimate",
                        })}
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={amountByWorkOrder[workOrder.id] ?? ""}
                          onChange={(event) => {
                            setAmountByWorkOrder((current) => ({
                              ...current,
                              [workOrder.id]: event.target.value,
                            }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-line bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                        />
                      </label>
                      <label className="text-sm font-medium text-slate-700">
                        {translate(locale, {
                          el: "Σημείωση",
                          en: "Note",
                        })}
                        <input
                          value={noteByWorkOrder[workOrder.id] ?? ""}
                          onChange={(event) => {
                            setNoteByWorkOrder((current) => ({
                              ...current,
                              [workOrder.id]: event.target.value,
                            }));
                          }}
                          className="mt-2 w-full rounded-2xl border border-line bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-teal-500"
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={isPending || Number(amountByWorkOrder[workOrder.id] ?? 0) < 0}
                        onClick={() => {
                          createReminder(workOrder);
                        }}
                        className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {linkedReminder
                          ? translate(locale, { el: "Προσθήκη στο reminder", en: "Add to reminder" })
                          : translate(locale, { el: "Δημιουργία reminder", en: "Create reminder" })}
                      </button>
                      {linkedReminder ? (
                        <span className="text-sm text-slate-500">
                          {translate(locale, {
                            el: `Συνδεδεμένο με reminder ${linkedReminder.id}`,
                            en: `Linked to reminder ${linkedReminder.id}`,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-sm text-slate-600">
                {translate(locale, {
                  el: "Δεν υπάρχουν work orders σε ready for invoice κατάσταση.",
                  en: "There are no work orders currently in ready-for-invoice state.",
                })}
              </div>
            )}
          </div>
        </div>

        <div className="panel rounded-[2rem] p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
            {translate(locale, {
              el: "τρέχοντα reminders",
              en: "current reminders",
            })}
          </p>
          <div className="mt-4 space-y-4">
            {reminders.length > 0 ? (
              reminders.map((reminder) => (
                <div key={reminder.id} className="rounded-[1.6rem] border border-line bg-white/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-slate-950">
                        {reminder.customerName}
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        {reminder.monthKey} • {reminder.estimatedTotal}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                      {reminder.state.toLowerCase().replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {reminder.note ||
                      translate(locale, {
                        el: "Χωρίς σημείωση.",
                        en: "No note.",
                      })}
                  </p>
                  <p className="mt-3 text-sm text-slate-500">
                    {translate(locale, {
                      el: `Work orders: ${reminder.workOrders.map((workOrder) => workOrder.id).join(", ")}`,
                      en: `Work orders: ${reminder.workOrders.map((workOrder) => workOrder.id).join(", ")}`,
                    })}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        runReminderAction(reminder.id, "queue");
                      }}
                      className="rounded-full border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/70 disabled:opacity-60"
                    >
                      {translate(locale, {
                        el: "Πέρασμα σε μηνιαία ουρά",
                        en: "Queue month",
                      })}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        runReminderAction(reminder.id, "ready");
                      }}
                      className="rounded-full border border-line px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/70 disabled:opacity-60"
                    >
                      {translate(locale, {
                        el: "Έτοιμο για λογιστήριο",
                        en: "Accounting ready",
                      })}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        sendReminderWhatsApp(reminder);
                      }}
                      className="rounded-full bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-500 disabled:opacity-60"
                    >
                      {translate(locale, {
                        el: "WhatsApp προς διοίκηση",
                        en: "WhatsApp to management",
                      })}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-600">
                {translate(locale, {
                  el: "Δεν υπάρχουν reminders στη βάση ακόμη.",
                  en: "There are no reminders in the database yet.",
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
