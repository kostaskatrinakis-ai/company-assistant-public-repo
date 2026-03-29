import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPermissionsForRole, isAppRole } from "@/shared/auth/roles";
import type { AppPermission, AppRole, SessionUser } from "@/shared/auth/types";
import { auth0, isAuth0Configured } from "@/shared/auth/auth0";
import { env } from "@/shared/config/env";
import {
  localSessionCookieName,
  verifyLocalSessionToken,
} from "@/shared/auth/local-auth";
import { getSessionUserByAuthIdentity, getSessionUserById } from "@/modules/users/service";

function resolveRoleFromClaims(payload: Record<string, unknown>): AppRole | null {
  const directClaim = payload[env.auth0RoleClaim];

  if (typeof directClaim === "string" && isAppRole(directClaim)) {
    return directClaim;
  }

  const appMetadata = payload.app_metadata;

  if (
    typeof appMetadata === "object" &&
    appMetadata !== null &&
    typeof (appMetadata as { role?: unknown }).role === "string" &&
    isAppRole((appMetadata as { role: string }).role)
  ) {
    return (appMetadata as { role: AppRole }).role;
  }

  return null;
}

function getOptionalStringClaim(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  if (isAuth0Configured && auth0) {
    const session = await auth0.getSession();

    if (session?.user) {
      const payload = session.user as unknown as Record<string, unknown>;
      const role = resolveRoleFromClaims(payload);
      const databaseUser = await getSessionUserByAuthIdentity({
        auth0UserId: typeof session.user.sub === "string" ? session.user.sub : null,
        email: typeof session.user.email === "string" ? session.user.email : null,
      });

      if (databaseUser) {
        return databaseUser;
      }

      return {
        id: String(session.user.sub ?? session.user.email ?? "auth0-user"),
        email: String(session.user.email ?? "unknown@auth0.local"),
        fullName: String(session.user.name ?? session.user.nickname ?? "User"),
        role: role ?? "technician",
        permissions: getPermissionsForRole(role ?? "technician"),
        authSource: "auth0",
        isActive: true,
        phoneNumber: getOptionalStringClaim(payload, "phone_number"),
      };
    }
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(localSessionCookieName)?.value;

  if (!token) {
    return null;
  }

  const localSession = verifyLocalSessionToken(token);
  if (!localSession) {
    return null;
  }

  return getSessionUserById(localSession.userId);
}

export async function requireSessionUser() {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }

  if (!user.isActive) {
    redirect("/unauthorized");
  }

  return user;
}

export async function requirePermission(permission: AppPermission) {
  const user = await requireSessionUser();

  if (!user.permissions.includes(permission)) {
    redirect("/unauthorized");
  }

  return user;
}

export async function requireAnyRole(roles: AppRole[]) {
  const user = await requireSessionUser();

  if (!roles.includes(user.role) && user.role !== "admin") {
    redirect("/unauthorized");
  }

  return user;
}
