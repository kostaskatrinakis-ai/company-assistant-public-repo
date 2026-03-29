import { NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  getPkceCookieName,
  getCodexCookieOptions,
} from "@/shared/config/codex-auth";
import { ensureCodexCallbackServerRunning } from "@/shared/config/codex-callback-server";

export const dynamic = "force-dynamic";

function getRedirectUri() {
  return "http://localhost:1455/auth/callback";
}

function normalizeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/")) {
    return "/";
  }

  return value;
}

export async function GET(request: Request) {
  // Start the proxy server that listens on 127.0.0.1:1455 and forwards back to port 3000
  ensureCodexCallbackServerRunning();

  const requestUrl = new URL(request.url);
  const returnTo = normalizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const redirectUri = getRedirectUri();
  const { url, pkceCookie } = await buildAuthorizationUrl(redirectUri, returnTo);
  const options = getCodexCookieOptions();
  const response = NextResponse.redirect(url);

  response.cookies.set(getPkceCookieName(), pkceCookie, {
    ...options,
    maxAge: 60 * 10, // 10 min ephemeral
  });

  return response;
}
