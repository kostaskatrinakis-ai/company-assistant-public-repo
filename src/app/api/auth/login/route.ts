import { NextResponse } from "next/server";
import { getRoleHomePath } from "@/shared/auth/roles";
import {
  createLocalSessionToken,
  getLocalSessionCookieOptions,
} from "@/shared/auth/local-auth";
import { authenticateLocalUser } from "@/modules/users/service";
import { isLocalAuthConfigured } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalAuthConfigured) {
    return NextResponse.redirect(
      new URL("/login?error=local_auth_disabled", request.url),
      { status: 303 },
    );
  }

  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const user = await authenticateLocalUser(email, password);
  if (!user) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_credentials", request.url),
      { status: 303 },
    );
  }

  if (!user.isActive) {
    return NextResponse.redirect(
      new URL("/login?error=inactive_user", request.url),
      { status: 303 },
    );
  }

  const response = NextResponse.redirect(
    new URL(getRoleHomePath(user.role), request.url),
    { status: 303 },
  );
  response.cookies.set({
    ...getLocalSessionCookieOptions(),
    value: createLocalSessionToken(user.id),
  });

  return response;
}
