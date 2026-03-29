import { NextResponse } from "next/server";
import { auth0, isAuth0Configured } from "@/shared/auth/auth0";
import { env } from "@/shared/config/env";
import { syncUserFromSession } from "@/modules/users/service";

export const dynamic = "force-dynamic";

function resolveRoleFromClaims(payload: Record<string, unknown>) {
  const directClaim = payload[env.auth0RoleClaim];

  if (typeof directClaim === "string") {
    return directClaim;
  }

  const appMetadata = payload.app_metadata;

  if (
    typeof appMetadata === "object" &&
    appMetadata !== null &&
    typeof (appMetadata as { role?: unknown }).role === "string"
  ) {
    return (appMetadata as { role: string }).role;
  }

  return null;
}

function getOptionalStringClaim(
  payload: Record<string, unknown>,
  key: string,
) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

export async function POST() {
  if (!isAuth0Configured || !auth0) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH0_NOT_CONFIGURED",
          message: "Το Auth0 δεν έχει ρυθμιστεί ακόμη.",
        },
      },
      { status: 503 },
    );
  }

  const session = await auth0.getSession();

  if (!session?.user) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHENTICATED",
          message: "Απαιτείται ενεργή session.",
        },
      },
      { status: 401 },
    );
  }

  const payload = session.user as unknown as Record<string, unknown>;
  const result = await syncUserFromSession({
    auth0UserId: String(session.user.sub ?? ""),
    email: String(session.user.email ?? ""),
    fullName: String(session.user.name ?? session.user.nickname ?? "User"),
    roleFromClaims: resolveRoleFromClaims(payload),
    phoneNumber: getOptionalStringClaim(payload, "phone_number"),
  });

  if (!result.ok) {
    const status =
      result.code === "ROLE_ASSIGNMENT_REQUIRED"
        ? 409
        : result.code === "DATABASE_NOT_CONFIGURED"
          ? 503
          : 400;

    return NextResponse.json(
      {
        error: {
          code: result.code,
          message:
            result.code === "ROLE_ASSIGNMENT_REQUIRED"
              ? "Ο χρήστης δεν έχει role assignment ακόμη."
              : "Η βάση δεδομένων δεν έχει ρυθμιστεί ακόμη.",
        },
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    data: result,
  });
}
