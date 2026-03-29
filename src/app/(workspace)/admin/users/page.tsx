import { AdminUserManagement } from "@/components/admin-user-management";
import { listUsers } from "@/modules/users/service";
import { requireAnyRole } from "@/shared/auth/session";
import { getUiPreferences } from "@/shared/ui/server";
import { translate } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const preferences = await getUiPreferences();
  await requireAnyRole(["admin"]);
  const users = await listUsers();

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-700">
          {translate(preferences.locale, {
            el: "διαχείριση χρηστών",
            en: "user management",
          })}
        </p>
        <h2 className="text-4xl font-semibold tracking-[-0.05em] text-slate-950">
          {translate(preferences.locale, {
            el: "Χρήστες και πρόσβαση",
            en: "Users and access",
          })}
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-600">
          {translate(preferences.locale, {
            el: "Ο admin μπορεί να στήσει τα 5 accounts της ομάδας απευθείας πάνω στη βάση με προσωπικά credentials και καθαρό ownership ανά ρόλο.",
            en: "The admin can create the team's 5 accounts directly in the database with personal credentials and clear role ownership.",
          })}
        </p>
      </div>

      <AdminUserManagement users={users} />
    </div>
  );
}
