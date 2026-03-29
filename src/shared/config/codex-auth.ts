import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "@/shared/config/env";

/* ── OpenAI Codex OAuth constants ────────────────────────────── */

const CODEX_CLIENT_ID =
  process.env.CODEX_OAUTH_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_ISSUER = "https://auth.openai.com";
const CODEX_AUTHORIZE_URL = `${CODEX_ISSUER}/oauth/authorize`;
const CODEX_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`;
const CODEX_SCOPE = "openid profile email offline_access";
const CODEX_BASE_URL =
  process.env.CODEX_BASE_URL?.trim() ??
  "https://chatgpt.com/backend-api/codex";
const CODEX_ORIGINATOR = process.env.CODEX_OAUTH_ORIGINATOR?.trim() ?? "codex_cli";

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 min before expiry

export const CODEX_SESSION_COOKIE = "codex-session";
const CODEX_PKCE_COOKIE = "codex-pkce";

/* ── Types ───────────────────────────────────────────────────── */

export type CodexTokens = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  account_id?: string;
  expires_at?: string;
};

type PkceState = {
  code_verifier: string;
  state: string;
  returnTo: string;
};

type CodexSessionCookie = {
  session_id: string;
};

type CodexSessionRecord = {
  tokens: CodexTokens;
  created_at: string;
  updated_at: string;
};

type CodexAuthStore = Record<string, CodexSessionRecord>;

/* ── Helpers ─────────────────────────────────────────────────── */

function getSigningSecret(): string {
  const secret = env.auth0Secret ?? env.localAuthSecret;
  if (!secret) {
    throw new Error(
      "No signing secret configured. Set AUTH0_SECRET or LOCAL_AUTH_SECRET.",
    );
  }
  return secret;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");
}

function toBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

function getCodexAuthStorePath() {
  if (env.codexAuthFile) {
    return env.codexAuthFile;
  }

  return join(process.cwd(), env.databaseDir, "codex-auth-store.json");
}

/* ── Cookie encrypt / decrypt (HMAC-signed) ──────────────────── */

export function encodeSignedCookie<T>(data: T): string {
  const payload = toBase64Url(JSON.stringify(data));
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

export function decodeSignedCookie<T>(cookie: string): T | null {
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expectedSig = signPayload(payload);
  if (signature !== expectedSig) {
    return null;
  }

  try {
    return JSON.parse(fromBase64Url(payload)) as T;
  } catch {
    return null;
  }
}

export function getCodexSessionIdFromCookie(cookieValue: string | undefined) {
  if (!cookieValue) {
    return null;
  }

  const session = decodeSignedCookie<CodexSessionCookie>(cookieValue);
  return session?.session_id ?? null;
}

export function createCodexCookieFromSessionId(sessionId: string) {
  return encodeSignedCookie<CodexSessionCookie>({ session_id: sessionId });
}

async function readAuthStore(): Promise<CodexAuthStore> {
  const storePath = getCodexAuthStorePath();

  try {
    const content = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as CodexAuthStore;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }
}

async function writeAuthStore(store: CodexAuthStore) {
  const storePath = getCodexAuthStorePath();
  await mkdir(dirname(storePath), { recursive: true });

  const tempPath = `${storePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), "utf-8");
  await rename(tempPath, storePath);
}

/* ── PKCE helpers ────────────────────────────────────────────── */

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Buffer.from(digest).toString("base64url");
}

/* ── Public API ──────────────────────────────────────────────── */

export function getCodexBaseUrl(): string {
  return CODEX_BASE_URL;
}

export function getCodexClientId(): string {
  return CODEX_CLIENT_ID;
}

/**
 * Build the PKCE authorization URL and the state to store in a cookie.
 */
export async function buildAuthorizationUrl(
  redirectUri: string,
  returnTo = "/",
): Promise<{ url: string; pkceCookie: string }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CODEX_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: CODEX_ORIGINATOR,
    state,
  });

  const pkceState: PkceState = { code_verifier: codeVerifier, state, returnTo };
  const pkceCookie = encodeSignedCookie(pkceState);

  return {
    url: `${CODEX_AUTHORIZE_URL}?${params.toString()}`,
    pkceCookie,
  };
}

export function getPkceCookieName(): string {
  return CODEX_PKCE_COOKIE;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CodexTokens> {
  const response = await fetch(CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown");
    throw new Error(
      `Codex token exchange failed (${response.status}): ${errorBody}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("Codex token exchange returned no access_token.");
  }

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : undefined;

  const accountId = extractAccountId(payload.id_token);

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? "",
    id_token: payload.id_token,
    account_id: accountId,
    expires_at: expiresAt,
  };
}

/**
 * Refresh an expired access token.
 */
export async function refreshCodexTokens(
  refreshToken: string,
): Promise<CodexTokens> {
  const response = await fetch(CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
      scope: CODEX_SCOPE,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown");
    throw new Error(
      `Codex token refresh failed (${response.status}): ${errorBody}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error("Codex token refresh returned no access_token.");
  }

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : undefined;

  const accountId = extractAccountId(payload.id_token);

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? refreshToken,
    id_token: payload.id_token,
    account_id: accountId,
    expires_at: expiresAt,
  };
}

/**
 * Given a token cookie value, return a fresh access token (refreshing if needed).
 */
export async function getCodexAccessTokenFromCookie(
  cookieValue: string,
): Promise<{ tokens: CodexTokens; refreshed: boolean }> {
  const session = decodeSignedCookie<CodexSessionCookie>(cookieValue);
  if (!session?.session_id) {
    throw new Error("Invalid or missing Codex session cookie.");
  }

  const store = await readAuthStore();
  const sessionRecord = store[session.session_id];

  if (!sessionRecord?.tokens?.access_token) {
    throw new Error("Codex session not found.");
  }

  const tokens = sessionRecord.tokens;

  // Check if token is expired
  if (tokens.expires_at) {
    const expiresAtMs = new Date(tokens.expires_at).getTime();
    if (Date.now() < expiresAtMs - REFRESH_MARGIN_MS) {
      return { tokens, refreshed: false };
    }
  }

  // Need to refresh
  if (!tokens.refresh_token) {
    throw new Error("Codex access token expired and no refresh token available.");
  }

  console.log("[codex-auth] Access token expired, refreshing…");
  const refreshed = await refreshCodexTokens(tokens.refresh_token);
  store[session.session_id] = {
    tokens: refreshed,
    created_at: sessionRecord.created_at,
    updated_at: new Date().toISOString(),
  };
  await writeAuthStore(store);
  return { tokens: refreshed, refreshed: true };
}

/**
 * Check if a cookie value contains valid Codex tokens.
 */
export async function isCodexAuthenticated(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) {
    return false;
  }

  const session = decodeSignedCookie<CodexSessionCookie>(cookieValue);
  if (!session?.session_id) {
    return false;
  }

  const store = await readAuthStore();
  return Boolean(store[session.session_id]?.tokens?.access_token);
}

export async function createCodexSession(tokens: CodexTokens): Promise<string> {
  const sessionId = randomBytes(24).toString("hex");
  const store = await readAuthStore();
  const now = new Date().toISOString();

  store[sessionId] = {
    tokens,
    created_at: now,
    updated_at: now,
  };

  await writeAuthStore(store);
  return encodeSignedCookie<CodexSessionCookie>({ session_id: sessionId });
}

export async function deleteCodexSession(cookieValue: string | undefined) {
  if (!cookieValue) {
    return;
  }

  const session = decodeSignedCookie<CodexSessionCookie>(cookieValue);
  if (!session?.session_id) {
    return;
  }

  const store = await readAuthStore();
  if (!store[session.session_id]) {
    return;
  }

  delete store[session.session_id];
  await writeAuthStore(store);
}

/**
 * Cookie options for Codex cookies.
 */
export function getCodexCookieOptions() {
  const isLocalHttpApp =
    env.appBaseUrl?.startsWith("http://localhost") ||
    env.appBaseUrl?.startsWith("http://127.0.0.1");

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && !isLocalHttpApp,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  };
}

/* ── Internal helpers ────────────────────────────────────────── */

function extractAccountId(idToken: string | undefined): string | undefined {
  if (!idToken) {
    return undefined;
  }
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3 || !parts[1]) {
      return undefined;
    }
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as Record<string, unknown>;

    const authClaim = payload["https://api.openai.com/auth"];
    if (
      typeof authClaim === "object" &&
      authClaim !== null &&
      "chatgpt_account_id" in authClaim
    ) {
      const accountId = (authClaim as Record<string, unknown>)
        .chatgpt_account_id;
      return typeof accountId === "string" ? accountId : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
