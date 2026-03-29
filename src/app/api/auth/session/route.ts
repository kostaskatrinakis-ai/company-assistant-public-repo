import { NextResponse } from "next/server";
import { getCurrentSessionUser } from "@/shared/auth/session";
import { isAuth0Configured } from "@/shared/auth/auth0";
import { authMode, isLocalAuthConfigured } from "@/shared/config/env";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentSessionUser();

    return NextResponse.json({
      authConfigured: isAuth0Configured,
      localAuthConfigured: isLocalAuthConfigured,
      authMode,
      user,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_SESSION_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Αποτυχία ανάγνωσης session.",
        },
      },
      { status: 503 },
    );
  }
}
