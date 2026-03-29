"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import type { CustomerRecord, RequestRecord, AppointmentRecord, WorkOrderRecord } from "@/modules/operations/types";
import type { ReminderRecord } from "@/modules/reminders/service";
import { translate } from "@/shared/ui/types";

type RecordsGovernancePanelProps = {
  customers: CustomerRecord[];
  requests: RequestRecord[];
  appointments: AppointmentRecord[];
  workOrders: WorkOrderRecord[];
  reminders: ReminderRecord[];
};

type FeedbackState = {
  tone: "success" | "error";
  text: string;
};

type ErrorResponseBody = {
  error?: {
    message?: string;
  };
};

const sectionTitleClassName =
  "text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400";
const pillClassName =
  "rounded-full border border-line bg-white/70 dark:bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-700 dark:text-slate-300";

function toErrorMessage(body: unknown, fallback: string) {
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

  return fallback;
}

export function RecordsGovernancePanel({
  customers,
  requests,
  appointments,
  workOrders,
  reminders,
}: RecordsGovernancePanelProps) {
  const router = useRouter();
  const { locale } = useUiPreferences();
  const [feedback, setFeedback] = useState<FeedbackState | undefined>();
  const [isPending, startTransition] = useTransition();
  const t = (values: { el: string; en: string }) => translate(locale, values);

  function formatDateTime(value: string) {
    return new Intl.DateTimeFormat(locale === "el" ? "el-GR" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function runDelete(params: {
    url: string;
    confirmMessage: string;
    successMessage: string;
    errorMessage: string;
  }) {
    if (!window.confirm(params.confirmMessage)) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(params.url, {
          method: "DELETE",
        });
        const body = (await response.json()) as ErrorResponseBody;

        if (!response.ok) {
          throw new Error(toErrorMessage(body, params.errorMessage));
        }

        setFeedback({
          tone: "success",
          text: params.successMessage,
        });
        router.refresh();
      } catch (error) {
        setFeedback({
          tone: "error",
          text: error instanceof Error ? error.message : params.errorMessage,
        });
      }
    });
  }

  return (
    <section className="space-y-6">
      <div className="panel rounded-[2rem] p-5">
        <p className={sectionTitleClassName}>
          {t({ el: "διακυβέρνηση δεδομένων", en: "data governance" })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
          {t({
            el: "Διαγραφή εγγραφών και ορατότητα δημιουργού",
            en: "Record deletion and creator visibility",
          })}
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {t({
            el: "Ο owner και ο admin βλέπουν ποιος δημιούργησε κάθε εγγραφή με ονοματεπώνυμο και μπορούν να διαγράψουν business records από όλο το πρόγραμμα.",
            en: "Owner and admin can see who created each record by full name and can delete business records across the app.",
          })}
        </p>
        {feedback ? (
          <p
            className={`mt-4 rounded-2xl px-3 py-2 text-sm ${
              feedback.tone === "success"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
            }`}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="panel overflow-hidden rounded-[2rem]">
          <div className="border-b border-line px-5 py-4">
            <p className={sectionTitleClassName}>
              {t({ el: "πελάτες και εγκαταστάσεις", en: "customers and locations" })}
            </p>
          </div>
          {customers.length > 0 ? (
            customers.map((customer) => (
              <div key={customer.id} className="border-b border-line px-5 py-5 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                      {customer.businessName}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {t({ el: "Δημιουργός", en: "Creator" })}:{" "}
                      {customer.createdByUserName ??
                        t({ el: "Άγνωστος χρήστης", en: "Unknown user" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      runDelete({
                        url: `/api/customers/${customer.id}`,
                        confirmMessage: t({
                          el: "Να διαγραφεί ο πελάτης; Αν υπάρχουν συνδεδεμένες εγκαταστάσεις, αιτήματα, work orders ή reminders, η διαγραφή θα μπλοκαριστεί.",
                          en: "Delete this customer? If linked locations, requests, work orders, or reminders still exist, deletion will be blocked.",
                        }),
                        successMessage: t({
                          el: "Ο πελάτης διαγράφηκε.",
                          en: "Customer deleted.",
                        }),
                        errorMessage: t({
                          el: "Αποτυχία διαγραφής πελάτη.",
                          en: "Customer deletion failed.",
                        }),
                      })
                    }
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                  >
                    {t({ el: "Διαγραφή πελάτη", en: "Delete customer" })}
                  </button>
                </div>

                {customer.locations.length > 0 ? (
                  <div className="mt-4 space-y-2 rounded-[1.25rem] border border-line/80 bg-white/45 px-3 py-3 dark:bg-white/5">
                    {customer.locations.map((location) => (
                      <div
                        key={location.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line/70 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {location.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {location.address} •{" "}
                            {t({ el: "Δημιουργός", en: "Creator" })}:{" "}
                            {location.createdByUserName ??
                              t({ el: "Άγνωστος χρήστης", en: "Unknown user" })}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() =>
                            runDelete({
                              url: `/api/locations/${location.id}`,
                              confirmMessage: t({
                                el: "Να διαγραφεί η εγκατάσταση; Αν υπάρχουν συνδεδεμένα αιτήματα, work orders ή εξοπλισμός, η διαγραφή θα μπλοκαριστεί.",
                                en: "Delete this location? If linked requests, work orders, or equipment still exist, deletion will be blocked.",
                              }),
                              successMessage: t({
                                el: "Η εγκατάσταση διαγράφηκε.",
                                en: "Location deleted.",
                              }),
                              errorMessage: t({
                                el: "Αποτυχία διαγραφής εγκατάστασης.",
                                en: "Location deletion failed.",
                              }),
                            })
                          }
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                        >
                          {t({ el: "Διαγραφή", en: "Delete" })}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
              {t({ el: "Δεν υπάρχουν πελάτες στη βάση.", en: "There are no customers in the database." })}
            </div>
          )}
        </div>

        <div className="panel overflow-hidden rounded-[2rem]">
          <div className="border-b border-line px-5 py-4">
            <p className={sectionTitleClassName}>
              {t({ el: "αιτήματα", en: "requests" })}
            </p>
          </div>
          {requests.length > 0 ? (
            requests.map((request) => (
              <div key={request.id} className="border-b border-line px-5 py-5 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                      {request.customerName ??
                        t({ el: "Χωρίς πελάτη", en: "No customer" })}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {request.locationName ??
                        t({ el: "Χωρίς εγκατάσταση", en: "No location" })}{" "}
                      • {request.sourceChannel}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={pillClassName}>{request.state.toLowerCase()}</span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        runDelete({
                          url: `/api/requests/${request.id}`,
                          confirmMessage: t({
                            el: "Να διαγραφεί το αίτημα; Αν υπάρχουν συνδεδεμένα ραντεβού ή work orders, η διαγραφή θα μπλοκαριστεί.",
                            en: "Delete this request? If linked appointments or work orders still exist, deletion will be blocked.",
                          }),
                          successMessage: t({
                            el: "Το αίτημα διαγράφηκε.",
                            en: "Request deleted.",
                          }),
                          errorMessage: t({
                            el: "Αποτυχία διαγραφής αιτήματος.",
                            en: "Request deletion failed.",
                          }),
                        })
                      }
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                    >
                      {t({ el: "Διαγραφή", en: "Delete" })}
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                  {request.description}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t({ el: "Δημιουργός", en: "Creator" })}:{" "}
                  {request.createdByUserName ??
                    t({ el: "Άγνωστος χρήστης", en: "Unknown user" })}
                </p>
              </div>
            ))
          ) : (
            <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
              {t({ el: "Δεν υπάρχουν αιτήματα.", en: "There are no requests." })}
            </div>
          )}
        </div>

        <div className="panel overflow-hidden rounded-[2rem]">
          <div className="border-b border-line px-5 py-4">
            <p className={sectionTitleClassName}>
              {t({ el: "ραντεβού", en: "appointments" })}
            </p>
          </div>
          {appointments.length > 0 ? (
            appointments.map((appointment) => (
              <div key={appointment.id} className="border-b border-line px-5 py-5 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                      {appointment.assignedUserName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {formatDateTime(appointment.startAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      runDelete({
                        url: `/api/appointments/${appointment.id}`,
                        confirmMessage: t({
                          el: "Να διαγραφεί το ραντεβού;",
                          en: "Delete this appointment?",
                        }),
                        successMessage: t({
                          el: "Το ραντεβού διαγράφηκε.",
                          en: "Appointment deleted.",
                        }),
                        errorMessage: t({
                          el: "Αποτυχία διαγραφής ραντεβού.",
                          en: "Appointment deletion failed.",
                        }),
                      })
                    }
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                  >
                    {t({ el: "Διαγραφή", en: "Delete" })}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t({ el: "Δημιουργός", en: "Creator" })}:{" "}
                  {appointment.createdByUserName ??
                    t({ el: "Άγνωστος χρήστης", en: "Unknown user" })}
                  {appointment.updatedByUserName
                    ? ` • ${t({ el: "Τελευταία ενημέρωση από", en: "Last updated by" })}: ${appointment.updatedByUserName}`
                    : ""}
                </p>
              </div>
            ))
          ) : (
            <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
              {t({ el: "Δεν υπάρχουν ραντεβού.", en: "There are no appointments." })}
            </div>
          )}
        </div>

        <div className="panel overflow-hidden rounded-[2rem]">
          <div className="border-b border-line px-5 py-4">
            <p className={sectionTitleClassName}>
              {t({ el: "work orders", en: "work orders" })}
            </p>
          </div>
          {workOrders.length > 0 ? (
            workOrders.map((workOrder) => (
              <div key={workOrder.id} className="border-b border-line px-5 py-5 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                      {workOrder.customerName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {workOrder.locationName} • {workOrder.issueSummary}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={pillClassName}>{workOrder.state.toLowerCase()}</span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        runDelete({
                          url: `/api/work-orders/${workOrder.id}`,
                          confirmMessage: t({
                            el: "Να διαγραφεί το work order; Αν υπάρχουν συνδεδεμένα ραντεβού, η διαγραφή θα μπλοκαριστεί.",
                            en: "Delete this work order? If linked appointments still exist, deletion will be blocked.",
                          }),
                          successMessage: t({
                            el: "Το work order διαγράφηκε.",
                            en: "Work order deleted.",
                          }),
                          errorMessage: t({
                            el: "Αποτυχία διαγραφής work order.",
                            en: "Work order deletion failed.",
                          }),
                        })
                      }
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                    >
                      {t({ el: "Διαγραφή", en: "Delete" })}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t({ el: "Δημιουργός", en: "Creator" })}:{" "}
                  {workOrder.createdByUserName ??
                    t({ el: "Άγνωστος χρήστης", en: "Unknown user" })}
                  {workOrder.closedByUserName
                    ? ` • ${t({ el: "Έκλεισε από", en: "Closed by" })}: ${workOrder.closedByUserName}`
                    : ""}
                </p>
              </div>
            ))
          ) : (
            <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
              {t({ el: "Δεν υπάρχουν work orders.", en: "There are no work orders." })}
            </div>
          )}
        </div>
      </div>

      <div className="panel overflow-hidden rounded-[2rem]">
        <div className="border-b border-line px-5 py-4">
          <p className={sectionTitleClassName}>
            {t({ el: "reminders τιμολόγησης", en: "invoice reminders" })}
          </p>
        </div>
        {reminders.length > 0 ? (
          reminders.map((reminder) => (
            <div key={reminder.id} className="border-b border-line px-5 py-5 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                    {reminder.customerName}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {reminder.monthKey} • {reminder.estimatedTotal}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={pillClassName}>{reminder.state.toLowerCase()}</span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      runDelete({
                        url: `/api/reminders/${reminder.id}`,
                        confirmMessage: t({
                          el: "Να διαγραφεί το reminder;",
                          en: "Delete this reminder?",
                        }),
                        successMessage: t({
                          el: "Το reminder διαγράφηκε.",
                          en: "Reminder deleted.",
                        }),
                        errorMessage: t({
                          el: "Αποτυχία διαγραφής reminder.",
                          en: "Reminder deletion failed.",
                        }),
                      })
                    }
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30 disabled:opacity-50"
                  >
                    {t({ el: "Διαγραφή", en: "Delete" })}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t({ el: "Δημιουργός", en: "Creator" })}:{" "}
                {reminder.createdByUserName ??
                  t({ el: "Άγνωστος χρήστης", en: "Unknown user" })}
                {reminder.updatedByUserName
                  ? ` • ${t({ el: "Τελευταία ενημέρωση από", en: "Last updated by" })}: ${reminder.updatedByUserName}`
                  : ""}
              </p>
            </div>
          ))
        ) : (
          <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
            {t({ el: "Δεν υπάρχουν reminders.", en: "There are no reminders." })}
          </div>
        )}
      </div>
    </section>
  );
}
