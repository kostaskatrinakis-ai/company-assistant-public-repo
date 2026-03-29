import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createCodexSession,
  decodeSignedCookie,
  exchangeCodeForTokens,
  getPkceCookieName,
  getCodexCookieOptions,
  CODEX_SESSION_COOKIE,
} from "@/shared/config/codex-auth";
import { env } from "@/shared/config/env";

export const dynamic = "force-dynamic";

function getRedirectUri() {
  return "http://localhost:1455/auth/callback";
}

function buildAppRedirectUrl(
  appBase: string,
  returnTo: string,
  params: Record<string, string>,
) {
  const destination = new URL(returnTo, appBase);
  for (const [key, value] of Object.entries(params)) {
    destination.searchParams.set(key, value);
  }
  return destination.toString();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const appBase = env.appBaseUrl ?? "http://localhost:3000";

  if (error) {
    const errorDesc = url.searchParams.get("error_description") ?? error;
    return NextResponse.redirect(
      `${appBase}?codex_auth=error&message=${encodeURIComponent(errorDesc)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appBase}?codex_auth=error&message=missing_code`,
    );
  }

  const cookieStore = await cookies();
  const pkceCookieValue = cookieStore.get(getPkceCookieName())?.value;

  if (!pkceCookieValue) {
    return NextResponse.redirect(
      `${appBase}?codex_auth=error&message=missing_pkce_state`,
    );
  }

  const pkceState = decodeSignedCookie<{
    code_verifier: string;
    state: string;
    returnTo: string;
  }>(pkceCookieValue);

  if (!pkceState || pkceState.state !== state) {
    return NextResponse.redirect(
      `${appBase}?codex_auth=error&message=invalid_state`,
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(
      code,
      pkceState.code_verifier,
      getRedirectUri(),
    );

    const options = getCodexCookieOptions();
    const response = NextResponse.redirect(
      buildAppRedirectUrl(appBase, pkceState.returnTo, {
        codex_auth: "success",
      }),
    );
    const sessionCookie = await createCodexSession(tokens);

    response.cookies.set(CODEX_SESSION_COOKIE, sessionCookie, options);
    response.cookies.delete(getPkceCookieName());

    return response;
  } catch (err) {
    console.error("[codex-auth-callback] Token exchange failed:", err);
    return NextResponse.redirect(
      buildAppRedirectUrl(appBase, pkceState?.returnTo ?? "/", {
        codex_auth: "error",
        message: "token_exchange_failed",
      }),
    );
  }
}
