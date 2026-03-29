import { OperationsOverview } from "@/components/operations-overview";
import { RecordsGovernancePanel } from "@/components/records-governance-panel";
import { listAppointments } from "@/modules/appointments/service";
import { listCustomers } from "@/modules/customers/service";
import { listInvoiceReminders } from "@/modules/reminders/service";
import { listRequests } from "@/modules/requests/service";
import { listWorkOrders } from "@/modules/work-orders/service";
import { requireAnyRole } from "@/shared/auth/session";
import { getUiPreferences } from "@/shared/ui/server";
import { translate } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  const preferences = await getUiPreferences();
  const user = await requireAnyRole(["owner"]);
  const [customers, requests, appointments, workOrders, reminders] = await Promise.all([
    listCustomers(),
    listRequests(),
    listAppointments(user),
    listWorkOrders(user),
    listInvoiceReminders(),
  ]);

  return (
    <div className="space-y-8">
      <OperationsOverview
        title={translate(preferences.locale, {
          el: "Πίνακας ιδιοκτήτη",
          en: "Owner dashboard",
        })}
        subtitle={translate(preferences.locale, {
          el: "Εδώ δίνεται η ζωντανή εικόνα της ημέρας: συνεργείο, work orders, ώρες, υλικά και reminders προς τιμολόγηση.",
          en: "This view shows the live picture of the day: crew activity, work orders, hours, materials, and invoice reminders.",
        })}
        user={user}
      />
      <RecordsGovernancePanel
        customers={customers}
        requests={requests}
        appointments={appointments}
        workOrders={workOrders}
        reminders={reminders}
      />
    </div>
  );
}
