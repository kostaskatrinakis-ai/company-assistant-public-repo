export const appRoles = ["admin", "owner", "operator", "technician"] as const;

export type AppRole = (typeof appRoles)[number];

export type AppPermission =
  | "users.manage"
  | "roles.manage"
  | "customers.read_all"
  | "customers.write"
  | "customers.delete"
  | "locations.delete"
  | "requests.write"
  | "requests.delete"
  | "appointments.write"
  | "appointments.delete"
  | "work_orders.write"
  | "work_orders.delete"
  | "work_orders.assign"
  | "time_entries.write_own"
  | "materials.write_own"
  | "reminders.manage"
  | "reminders.delete"
  | "reports.read_all"
  | "assistant.use"
  | "assistant.request_actions"
  | "assistant.execute_actions"
  | "whatsapp.send"
  | "audit.read";

export type AuthSource = "auth0" | "local";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  permissions: AppPermission[];
  authSource: AuthSource;
  isActive: boolean;
  phoneNumber?: string;
};
