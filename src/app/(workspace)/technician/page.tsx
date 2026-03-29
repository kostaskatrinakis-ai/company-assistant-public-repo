import { TechnicianWorkbench } from "@/components/technician-workbench";
import { getTechnicianDashboardSnapshot } from "@/modules/operations/dashboard";
import { requireAnyRole } from "@/shared/auth/session";
import { getUiPreferences } from "@/shared/ui/server";
import { translate } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

function formatStateLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

export default async function TechnicianPage() {
  const preferences = await getUiPreferences();
  const user = await requireAnyRole(["technician"]);
  const snapshot = await getTechnicianDashboardSnapshot(user, preferences.locale);
  const t = (values: { el: string; en: string }) => translate(preferences.locale, values);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-700 dark:text-cyan-400">
          {t({ el: "κινητό τεχνικού", en: "technician mobile" })}
        </p>
        <h2 className="text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
          {t({ el: "Οι δικές μου εργασίες", en: "My assignments" })}
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-700 dark:text-slate-400">
          {t({
            el: "Mobile-first επιφάνεια για τον τεχνικό, βασισμένη μόνο στις δικές του αναθέσεις, τα σημερινά ραντεβού και τα work orders που του έχουν περαστεί στο πρόγραμμα.",
            en: "Mobile-first surface for the technician, limited to their own assignments, today's appointments, and work orders.",
          })}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {snapshot.metrics.map((metric) => (
          <div key={metric.label} className="panel rounded-[2rem] px-5 py-5">
            <p className="text-sm text-slate-600 dark:text-slate-400">{metric.label}</p>
            <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
              {metric.value}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-400">{metric.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-600 dark:text-slate-400">
              {t({ el: "σημερινό πρόγραμμα", en: "today's schedule" })}
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
              {t({ el: "Ραντεβού και ενεργές αναθέσεις", en: "Appointments and active assignments" })}
            </h3>
          </div>

          <div className="panel rounded-[2rem]">
            {snapshot.todaysAppointments.length > 0 ? (
              snapshot.todaysAppointments.map((appointment) => (
                <div
                  key={appointment.id}
                  className="border-b border-line px-5 py-5 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                        {appointment.customerName ?? t({ el: "Χωρίς πελάτη", en: "No customer" })}
                      </p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {appointment.locationName ?? t({ el: "Χωρίς εγκατάσταση", en: "No location" })}
                      </p>
                    </div>
                    <div className="text-right text-sm text-slate-700 dark:text-slate-400">
                      <p>{appointment.slotLabel}</p>
                      <p>{formatStateLabel(appointment.state)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-400">
                    {appointment.issueSummary ?? t({ el: "Χωρίς περιγραφή προβλήματος", en: "No issue summary" })}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-700 dark:text-slate-400">
                {t({
                  el: "Δεν υπάρχει ραντεβού στο σημερινό σου πρόγραμμα.",
                  en: "There is no appointment in your schedule today.",
                })}
              </div>
            )}
          </div>

          <TechnicianWorkbench workOrders={snapshot.openWorkOrders} />
        </div>

        <div className="space-y-6">
          <div className="panel rounded-[2rem]">
            <div className="border-b border-line px-5 py-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-600 dark:text-slate-400">
                {t({ el: "ολοκληρωμένες εργασίες", en: "completed work" })}
              </p>
            </div>
            {snapshot.completedWorkOrders.length > 0 ? (
              snapshot.completedWorkOrders.map((workOrder) => (
                <div
                  key={workOrder.id}
                  className="border-b border-line px-5 py-5 last:border-b-0"
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
                    <p className="text-sm text-slate-700 dark:text-slate-400">
                      {workOrder.slotLabel ?? t({ el: "Χωρίς slot", en: "No slot" })}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-400">
                    {workOrder.resolutionSummary ?? workOrder.issueSummary}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-700 dark:text-slate-400">
                {t({
                  el: "Δεν υπάρχουν ολοκληρωμένες δικές σου εργασίες στη βάση ακόμη.",
                  en: "There are no completed jobs assigned to you yet.",
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
