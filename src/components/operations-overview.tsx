import { getOperationsDashboardSnapshot } from "@/modules/operations/dashboard";
import { RemindersBoard } from "@/components/reminders-board";
import type { SessionUser } from "@/shared/auth/types";
import { getUiPreferences } from "@/shared/ui/server";
import { getIntlLocale, translate } from "@/shared/ui/types";

const stateStyles = {
  AWAITING_DETAILS: "border border-amber-200/70 bg-amber-100/65 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
  NEW: "border border-cyan-200/70 bg-cyan-100/65 text-cyan-800 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-200",
  READY_TO_SCHEDULE: "border border-teal-200/70 bg-teal-100/65 text-teal-800 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-200",
  SCHEDULED: "border border-slate-200/80 bg-slate-100/75 text-slate-800 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-200",
  CANCELED: "border border-slate-200/80 bg-slate-100/70 text-slate-600 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300",
  DRAFT: "border border-slate-200/80 bg-slate-100/70 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-200",
  IN_PROGRESS: "border border-emerald-200/80 bg-emerald-100/65 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
  COMPLETED: "border border-emerald-200/80 bg-emerald-50/75 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
  FOLLOW_UP_REQUIRED: "border border-rose-200/80 bg-rose-100/65 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200",
  READY_FOR_INVOICE: "border border-indigo-200/80 bg-indigo-100/65 text-indigo-800 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200",
} as const;

type OperationsOverviewProps = {
  title: string;
  subtitle: string;
  user: SessionUser;
  emphasizeUsers?: boolean;
};

function formatStateLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

function getStateStyle(value: string) {
  return stateStyles[value as keyof typeof stateStyles] ?? "border border-slate-200/80 bg-slate-100/70 text-slate-700 dark:border-slate-500/20 dark:bg-slate-500/10 dark:text-slate-200";
}

export async function OperationsOverview({
  title,
  subtitle,
  user,
  emphasizeUsers = false,
}: OperationsOverviewProps) {
  const preferences = await getUiPreferences();
  const locale = preferences.locale;
  const snapshot = await getOperationsDashboardSnapshot(user, locale);
  const intlLocale = getIntlLocale(locale);

  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_360px]">
        <div className="panel rounded-[2.35rem] px-6 py-7 md:px-8 md:py-8">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-600 dark:text-slate-400">
            {translate(locale, {
              el: "κεντρική λειτουργία",
              en: "operations overview",
            })}
          </p>
          <div className="mt-4 space-y-4">
            <h2 className="max-w-4xl text-4xl font-semibold tracking-[-0.06em] text-slate-950 dark:text-slate-50 md:text-5xl">
              {title}
            </h2>
            <p className="max-w-3xl text-base leading-7 text-slate-700 dark:text-slate-300/80 md:text-lg">
              {subtitle}
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full border border-white/40 bg-white/55 px-3 py-1.5 text-xs font-medium text-slate-800 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
              {translate(locale, {
                el: `${snapshot.metrics.length} βασικά metrics`,
                en: `${snapshot.metrics.length} core metrics`,
              })}
            </span>
            <span className="rounded-full border border-white/30 bg-white/22 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-white/10 dark:bg-white/6 dark:text-slate-300">
              {translate(locale, {
                el: "Ζωντανή βάση δεδομένων",
                en: "Live database context",
              })}
            </span>
          </div>
        </div>

        <div className="panel animate-sheen rounded-[2.35rem] p-6">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-600 dark:text-slate-400">
            {translate(locale, {
              el: "σύνοψη ημέρας",
              en: "daily summary",
            })}
          </p>
          <p className="mt-4 text-lg font-medium leading-8 text-slate-900 dark:text-slate-100">
            {snapshot.bossDigest.summary}
          </p>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-300/80">
            {snapshot.bossDigest.highlights.map((line) => (
              <div
                key={line}
                className="border-t border-white/20 pt-3 first:border-t-0 first:pt-0 dark:border-white/8"
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {snapshot.metrics.map((metric) => (
          <div
            key={metric.label}
            className="panel rounded-[1.85rem] px-5 py-5 transition duration-300 hover:-translate-y-0.5"
          >
            <p className="text-sm text-slate-600 dark:text-slate-400">{metric.label}</p>
            <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
              {metric.value}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300/75">{metric.hint}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-600 dark:text-slate-400">
                {translate(locale, {
                  el: "ενεργές εργασίες",
                  en: "active work orders",
                })}
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
                {translate(locale, {
                  el: "Ημερήσια λειτουργία",
                  en: "Daily operations",
                })}
              </h3>
            </div>
            {emphasizeUsers ? (
              <div className="rounded-full border border-white/35 bg-white/55 px-3 py-1 text-xs font-medium text-slate-800 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
                {translate(locale, {
                  el: "πλήρης ορατότητα admin",
                  en: "full admin visibility",
                })}
              </div>
            ) : null}
          </div>

          <div className="panel overflow-hidden rounded-[2.2rem]">
            {snapshot.activeWorkOrders.length > 0 ? (
              snapshot.activeWorkOrders.map((workOrder) => (
                <div
                  key={workOrder.id}
                  className="grid gap-4 border-b border-white/18 px-5 py-5 last:border-b-0 dark:border-white/8 lg:grid-cols-[120px_minmax(0,1fr)_180px]"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {workOrder.slotLabel ??
                        translate(locale, {
                          el: "Χωρίς slot",
                          en: "No slot",
                        })}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                      {workOrder.id}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {workOrder.requestPriority ? (
                        <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] text-cyan-800">
                          {workOrder.requestPriority.toLowerCase()}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getStateStyle(workOrder.state)}`}
                      >
                        {formatStateLabel(workOrder.state)}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-lg font-medium text-slate-950 dark:text-slate-50">
                        {workOrder.customerName}
                      </h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {workOrder.locationName} • {workOrder.issueSummary}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300/75">
                    <p>
                      {translate(locale, { el: "Τεχνικός", en: "Technician" })}:{" "}
                      {workOrder.primaryAssigneeName ??
                        translate(locale, {
                          el: "Σε εκκρεμότητα",
                          en: "Pending",
                        })}
                    </p>
                    <p>
                      {translate(locale, { el: "Κανάλι", en: "Channel" })}:{" "}
                      {workOrder.requestSourceChannel ?? "MANUAL"}
                    </p>
                    <p>
                      {translate(locale, {
                        el: "Τελευταία ενημέρωση",
                        en: "Last update",
                      })}
                      : {new Date(workOrder.updatedAt).toLocaleString(intlLocale)}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-700 dark:text-slate-300/75">
                {translate(locale, {
                  el: "Δεν υπάρχουν ανοιχτά work orders στο τρέχον δικαίωμα πρόσβασης του χρήστη.",
                  en: "There are no open work orders in the current user scope.",
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-600 dark:text-slate-400">
              {translate(locale, {
                el: "ομάδα και τιμολόγηση",
                en: "team and invoicing",
              })}
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
              {translate(locale, {
                el: "Τεχνικοί, αιτήματα και τιμολόγηση",
                en: "Technicians, requests, and invoicing",
              })}
            </h3>
          </div>

          <div className="panel rounded-[2.2rem]">
            {snapshot.technicianLoad.length > 0 ? (
              snapshot.technicianLoad.map((technician) => (
                <div
                  key={technician.id}
                  className="border-b border-white/18 px-5 py-5 last:border-b-0 dark:border-white/8"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                        {technician.name}
                      </p>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300/75">
                        {translate(locale, {
                          el: `${technician.todaysAppointments} ραντεβού σήμερα`,
                          en: `${technician.todaysAppointments} appointments today`,
                        })}
                      </p>
                    </div>
                    <div className="text-right text-sm text-slate-700 dark:text-slate-300/75">
                      <p>{technician.scheduledHoursLabel}</p>
                      <p>
                        {translate(locale, {
                          el: `${technician.openWorkOrders} ανοιχτές εργασίες`,
                          en: `${technician.openWorkOrders} open work orders`,
                        })}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {translate(locale, {
                      el: "Επόμενο slot",
                      en: "Next slot",
                    })}
                    :{" "}
                    {technician.nextSlotLabel ??
                      translate(locale, {
                        el: "Χωρίς επόμενο slot",
                        en: "No next slot",
                      })}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-700 dark:text-slate-300/75">
                {translate(locale, {
                  el: "Δεν υπάρχουν ενεργοί τεχνικοί στη βάση.",
                  en: "There are no active technicians in the database.",
                })}
              </div>
            )}
          </div>

          <div className="panel rounded-[2.2rem]">
            {snapshot.requestsNeedingAction.length > 0 ? (
              snapshot.requestsNeedingAction.slice(0, 4).map((request) => (
                <div
                  key={request.id}
                  className="border-b border-white/18 px-5 py-5 last:border-b-0 dark:border-white/8"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                        {request.customerName ??
                          translate(locale, {
                            el: "Άγνωστος πελάτης",
                            en: "Unknown customer",
                          })}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {request.locationName ??
                          translate(locale, {
                            el: "Χωρίς εγκατάσταση",
                            en: "No location",
                          })}{" "}
                        • {request.sourceChannel}
                      </p>
                    </div>
                    <p
                      className={`rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getStateStyle(request.state)}`}
                    >
                      {formatStateLabel(request.state)}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300/75">
                    {request.description}
                  </p>
                </div>
              ))
            ) : snapshot.readyForInvoiceQueue.length > 0 ? (
              snapshot.readyForInvoiceQueue.map((workOrder) => (
                <div
                  key={workOrder.id}
                  className="border-b border-white/18 px-5 py-5 last:border-b-0 dark:border-white/8"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                        {workOrder.customerName}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {workOrder.locationName}
                      </p>
                    </div>
                    <p
                      className={`rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] ${stateStyles.READY_FOR_INVOICE}`}
                    >
                      {translate(locale, {
                        el: "έτοιμο για τιμολόγηση",
                        en: "ready for invoice",
                      })}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300/75">
                    {workOrder.issueSummary}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-700 dark:text-slate-300/75">
                {translate(locale, {
                  el: "Δεν υπάρχουν εκκρεμή αιτήματα ή reminders τιμολόγησης αυτή τη στιγμή.",
                  en: "There are no pending requests or invoice reminders right now.",
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <RemindersBoard
        readyWorkOrders={snapshot.readyForInvoiceQueue.map((workOrder) => ({
          id: workOrder.id,
          customerId: workOrder.customerId,
          customerName: workOrder.customerName,
          locationName: workOrder.locationName,
          issueSummary: workOrder.issueSummary,
        }))}
      />
    </div>
  );
}
