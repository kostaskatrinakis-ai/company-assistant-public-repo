import { OperatorManualActions } from "@/components/operator-manual-actions";
import { RemindersBoard } from "@/components/reminders-board";
import { getOperationsDashboardSnapshot } from "@/modules/operations/dashboard";
import { listCustomers } from "@/modules/customers/service";
import { listRequests } from "@/modules/requests/service";
import { listUsers } from "@/modules/users/service";
import { listWorkOrders } from "@/modules/work-orders/service";
import { requireAnyRole } from "@/shared/auth/session";
import { getUiPreferences } from "@/shared/ui/server";
import { translate } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

function formatStateLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

export default async function OperatorPage() {
  const preferences = await getUiPreferences();
  const user = await requireAnyRole(["operator"]);
  const [snapshot, customers, requests, users, workOrders] = await Promise.all([
    getOperationsDashboardSnapshot(user, preferences.locale),
    listCustomers(),
    listRequests(),
    listUsers(),
    listWorkOrders(user),
  ]);
  const technicians = users
    .filter((candidate) => candidate.role === "technician" && candidate.isActive)
    .map((technician) => ({
      id: technician.id,
      fullName: technician.fullName,
    }));
  const requestOptions = requests
    .filter((request) => request.state !== "CANCELED" && request.state !== "CONVERTED")
    .map((request) => ({
      id: request.id,
      label: `${request.id} • ${
        request.customerName ??
        translate(preferences.locale, { el: "Χωρίς πελάτη", en: "No customer" })
      } • ${
        request.locationName ??
        translate(preferences.locale, { el: "Χωρίς εγκατάσταση", en: "No location" })
      }`,
    }));
  const workOrderOptions = workOrders
    .filter((workOrder) => workOrder.state !== "CANCELED")
    .map((workOrder) => ({
      id: workOrder.id,
      label: `${workOrder.id} • ${workOrder.customerName} • ${workOrder.locationName}`,
    }));
  const t = (values: { el: string; en: string }) => translate(preferences.locale, values);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-400">
          {t({ el: "κέντρο operator", en: "operator desk" })}
        </p>
        <h2 className="text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
          {t({ el: "Αιτήματα, ραντεβού και χειροκίνητες ενέργειες", en: "Requests, appointments, and manual actions" })}
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-400">
          {t({
            el: "Το operator view είναι το κέντρο καταχώρισης, ανάθεσης και ελέγχου για ραντεβού, follow-up και εισόδους από WhatsApp ή χειροκίνητη καταχώριση.",
            en: "The operator view is the center for intake, assignment, follow-up, and review of WhatsApp or manual entries.",
          })}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        <div className="panel rounded-[2rem] px-5 py-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t({ el: "Αιτήματα για χειρισμό", en: "Requests needing action" })}
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
            {snapshot.requestsNeedingAction.length}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t({
              el: "Εγγραφές που θέλουν συμπλήρωση στοιχείων, scheduling ή operator review.",
              en: "Cases that need more details, scheduling, or operator review.",
            })}
          </p>
        </div>
        <div className="panel rounded-[2rem] px-5 py-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t({ el: "Ραντεβού σήμερα", en: "Appointments today" })}
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
            {snapshot.appointmentsToday.length}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t({
              el: "Προγραμματισμός πεδίου που διαχειρίζεται ο operator μέσα από app και WhatsApp.",
              en: "Field scheduling handled by the operator through the app and WhatsApp.",
            })}
          </p>
        </div>
        <div className="panel rounded-[2rem] px-5 py-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t({ el: "Ουρά follow-up", en: "Follow-up queue" })}
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
            {snapshot.followUpQueue.length}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t({
              el: "Εργασίες που χρειάζονται δεύτερη επίσκεψη ή επιβεβαίωση από operator.",
              en: "Jobs that need a second visit or operator confirmation.",
            })}
          </p>
        </div>
        <div className="panel rounded-[2rem] px-5 py-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t({ el: "Έτοιμα για τιμολόγηση", en: "Ready for invoice" })}
          </p>
          <p className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
            {snapshot.readyForInvoiceQueue.length}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t({
              el: "Work orders που έχουν κλείσει λειτουργικά και περιμένουν μηνιαία υπενθύμιση τιμολόγησης.",
              en: "Work orders that are operationally closed and waiting for monthly invoicing reminders.",
            })}
          </p>
        </div>
      </div>

      <OperatorManualActions
        customers={customers.map((customer) => ({
          id: customer.id,
          businessName: customer.businessName,
          locations: customer.locations.map((location) => ({
            id: location.id,
            name: location.name,
            address: location.address,
          })),
        }))}
        technicians={technicians}
        requestOptions={requestOptions}
        workOrderOptions={workOrderOptions}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <div className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
              {t({ el: "ουρά operator", en: "operator queue" })}
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-slate-50">
              {t({ el: "Αιτήματα που θέλουν χειρισμό", en: "Requests that need handling" })}
            </h3>
          </div>

          <div className="panel overflow-hidden rounded-[2rem]">
            {snapshot.requestsNeedingAction.length > 0 ? (
              snapshot.requestsNeedingAction.map((request) => (
                <div
                  key={request.id}
                  className="grid gap-4 border-b border-line px-5 py-5 last:border-b-0 lg:grid-cols-[140px_minmax(0,1fr)_190px]"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {request.updatedAtLabel}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                      {request.id}
                    </p>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cyan-100 dark:bg-cyan-900/30 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] text-cyan-800 dark:text-cyan-400">
                        {request.priority.toLowerCase()}
                      </span>
                      <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">
                        {formatStateLabel(request.state)}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-medium text-slate-950 dark:text-slate-50">
                      {request.customerName ?? t({ el: "Άγνωστος πελάτης", en: "Unknown customer" })}
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {request.locationName ?? t({ el: "Χωρίς εγκατάσταση", en: "No location" })} • {request.sourceChannel}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                      {request.description}
                    </p>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    <p>
                      {t({ el: "Αναφέρθηκε από", en: "Reported by" })}:{" "}
                      {request.reportedByName ?? t({ el: "Χωρίς όνομα", en: "No name" })}
                    </p>
                    <p>
                      {t({ el: "Καταχωρίστηκε από", en: "Created by" })}: {request.createdByUserName}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
                {t({
                  el: "Δεν υπάρχουν ανοιχτά αιτήματα που να απαιτούν operator action.",
                  en: "There are no open requests requiring operator action.",
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel rounded-[2rem]">
            <div className="border-b border-line px-5 py-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                {t({ el: "σημερινά ραντεβού", en: "today's appointments" })}
              </p>
            </div>
            {snapshot.appointmentsToday.length > 0 ? (
              snapshot.appointmentsToday.map((appointment) => (
                <div
                  key={appointment.id}
                  className="border-b border-line px-5 py-5 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                        {appointment.customerName ?? t({ el: "Χωρίς πελάτη", en: "No customer" })}
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {appointment.locationName ?? t({ el: "Χωρίς εγκατάσταση", en: "No location" })}
                      </p>
                    </div>
                    <div className="text-right text-sm text-slate-600 dark:text-slate-400">
                      <p>{appointment.slotLabel}</p>
                      <p>{formatStateLabel(appointment.state)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {appointment.issueSummary ?? t({ el: "Χωρίς σύνοψη προβλήματος", en: "No linked issue summary" })}
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {t({ el: "Τεχνικός", en: "Technician" })}: {appointment.assignedUserName}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
                {t({ el: "Δεν υπάρχουν ραντεβού για σήμερα.", en: "There are no appointments for today." })}
              </div>
            )}
          </div>

          <div className="panel rounded-[2rem]">
            <div className="border-b border-line px-5 py-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
                {t({ el: "follow-up και τιμολόγηση", en: "follow-up and invoicing" })}
              </p>
            </div>
            {[...snapshot.followUpQueue, ...snapshot.readyForInvoiceQueue].length > 0 ? (
              [...snapshot.followUpQueue, ...snapshot.readyForInvoiceQueue].map(
                (workOrder) => (
                  <div
                    key={workOrder.id}
                    className="border-b border-line px-5 py-5 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-medium text-slate-950 dark:text-slate-50">
                          {workOrder.customerName}
                        </p>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          {workOrder.locationName}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">
                        {formatStateLabel(workOrder.state)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
                      {workOrder.followUpReason ?? workOrder.issueSummary}
                    </p>
                  </div>
                ),
              )
            ) : (
              <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-400">
                {t({
                  el: "Δεν υπάρχουν follow-up ή ready-for-invoice εγγραφές στην ουρά.",
                  en: "There are no follow-up or ready-for-invoice records in the queue.",
                })}
              </div>
            )}
          </div>
        </div>
      </div>

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
