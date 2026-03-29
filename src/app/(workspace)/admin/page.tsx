import { AdminHeartbeatSettings } from "@/components/admin-heartbeat-settings";
import { OperationsOverview } from "@/components/operations-overview";
import { RecordsGovernancePanel } from "@/components/records-governance-panel";
import { listAppointments } from "@/modules/appointments/service";
import { listCustomers } from "@/modules/customers/service";
import { getHeartbeatSettings } from "@/modules/heartbeat/service";
import { listInvoiceReminders } from "@/modules/reminders/service";
import { listRequests } from "@/modules/requests/service";
import { listWorkOrders } from "@/modules/work-orders/service";
import { requireAnyRole } from "@/shared/auth/session";
import { getUiPreferences } from "@/shared/ui/server";
import { translate } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const preferences = await getUiPreferences();
  const user = await requireAnyRole(["admin"]);
  const [heartbeatSettings, customers, requests, appointments, workOrders, reminders] =
    await Promise.all([
      getHeartbeatSettings(),
      listCustomers(),
      listRequests(),
      listAppointments(user),
      listWorkOrders(user),
      listInvoiceReminders(),
    ]);

  return (
    <div className="space-y-8">
      <AdminHeartbeatSettings initialSettings={heartbeatSettings} />
      <OperationsOverview
        title={translate(preferences.locale, {
          el: "Πίνακας διαχείρισης",
          en: "Administration dashboard",
        })}
        subtitle={translate(preferences.locale, {
          el: "Ο admin βλέπει όλη την επιχειρησιακή εικόνα, χρήστες, δικαιώματα, integrations και assistant actions.",
          en: "The admin sees the full operations picture, users, permissions, integrations, and assistant actions.",
        })}
        emphasizeUsers
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
