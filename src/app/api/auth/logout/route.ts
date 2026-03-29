import { NextResponse } from "next/server";
import {
  getLocalSessionCookieOptions,
  localSessionCookieName,
} from "@/shared/auth/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });

  response.cookies.set({
    ...getLocalSessionCookieOptions(),
    name: localSessionCookieName,
    value: "",
    maxAge: 0,
  });

  return response;
}
