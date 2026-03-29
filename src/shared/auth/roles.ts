import type { AppPermission, AppRole } from "@/shared/auth/types";

export const rolePermissions: Record<AppRole, AppPermission[]> = {
  admin: [
    "users.manage",
    "roles.manage",
    "customers.read_all",
    "customers.write",
    "customers.delete",
    "locations.delete",
    "requests.write",
    "requests.delete",
    "appointments.write",
    "appointments.delete",
    "work_orders.write",
    "work_orders.delete",
    "work_orders.assign",
    "time_entries.write_own",
    "materials.write_own",
    "reminders.manage",
    "reminders.delete",
    "reports.read_all",
    "assistant.use",
    "assistant.request_actions",
    "assistant.execute_actions",
    "whatsapp.send",
    "audit.read",
  ],
  owner: [
    "customers.read_all",
    "customers.write",
    "customers.delete",
    "locations.delete",
    "requests.write",
    "requests.delete",
    "appointments.write",
    "appointments.delete",
    "work_orders.write",
    "work_orders.delete",
    "work_orders.assign",
    "reminders.manage",
    "reminders.delete",
    "reports.read_all",
    "assistant.use",
    "assistant.request_actions",
    "audit.read",
  ],
  operator: [
    "customers.read_all",
    "customers.write",
    "requests.write",
    "appointments.write",
    "work_orders.write",
    "work_orders.assign",
    "reminders.manage",
    "assistant.use",
    "assistant.request_actions",
    "assistant.execute_actions",
    "whatsapp.send",
  ],
  technician: [
    "time_entries.write_own",
    "materials.write_own",
    "assistant.use",
    "assistant.request_actions",
  ],
};

export function isAppRole(value: string): value is AppRole {
  return ["admin", "owner", "operator", "technician"].includes(value);
}

export function getPermissionsForRole(role: AppRole) {
  return rolePermissions[role];
}

export function hasPermission(role: AppRole, permission: AppPermission) {
  return rolePermissions[role].includes(permission);
}

export function getRoleHomePath(role: AppRole) {
  switch (role) {
    case "admin":
      return "/admin";
    case "owner":
      return "/owner";
    case "operator":
      return "/operator";
    case "technician":
      return "/technician";
    default:
      return "/";
  }
}

export function canAccessDashboard(
  sessionRole: AppRole,
  targetRole: AppRole,
) {
  if (sessionRole === "admin") {
    return true;
  }

  return sessionRole === targetRole;
}
