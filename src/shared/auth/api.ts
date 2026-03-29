import type { AppPermission, AppRole, SessionUser } from "@/shared/auth/types";
import { getCurrentSessionUser } from "@/shared/auth/session";
import { errorResponse } from "@/shared/http/response";

type ApiAuthResult =
  | {
      ok: true;
      user: SessionUser;
    }
  | {
      ok: false;
      response: ReturnType<typeof errorResponse>;
    };

export async function authorizeApiPermission(
  permission: AppPermission,
): Promise<ApiAuthResult> {
  const user = await getCurrentSessionUser();
  if (!user) {
    return {
      ok: false,
      response: errorResponse("UNAUTHENTICATED", "Απαιτείται σύνδεση.", 401),
    };
  }

  if (!user.isActive) {
    return {
      ok: false,
      response: errorResponse("INACTIVE_USER", "Ο χρήστης είναι ανενεργός.", 403),
    };
  }

  if (!user.permissions.includes(permission)) {
    return {
      ok: false,
      response: errorResponse("FORBIDDEN", "Δεν έχεις δικαίωμα για αυτή την ενέργεια.", 403),
    };
  }

  return { ok: true, user };
}

export async function authorizeApiRoles(
  roles: AppRole[],
): Promise<ApiAuthResult> {
  const user = await getCurrentSessionUser();
  if (!user) {
    return {
      ok: false,
      response: errorResponse("UNAUTHENTICATED", "Απαιτείται σύνδεση.", 401),
    };
  }

  if (!user.isActive) {
    return {
      ok: false,
      response: errorResponse("INACTIVE_USER", "Ο χρήστης είναι ανενεργός.", 403),
    };
  }

  if (user.role !== "admin" && !roles.includes(user.role)) {
    return {
      ok: false,
      response: errorResponse("FORBIDDEN", "Δεν έχεις δικαίωμα για αυτή την ενέργεια.", 403),
    };
  }

  return { ok: true, user };
}
