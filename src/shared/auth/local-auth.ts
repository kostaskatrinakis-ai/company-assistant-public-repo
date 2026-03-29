import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "@/shared/config/env";

const passwordVersion = "scrypt";
export const localSessionCookieName = "company-assistant-session";
const localSessionTtlMs = 1000 * 60 * 60 * 12;

type LocalSessionPayload = {
  userId: string;
  exp: number;
};

function toBase64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function getLocalAuthSecret() {
  if (!env.localAuthSecret) {
    throw new Error("Local auth is not configured.");
  }

  return env.localAuthSecret;
}

function signValue(value: string) {
  return createHmac("sha256", getLocalAuthSecret()).update(value).digest("base64url");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");

  return `${passwordVersion}$${salt}$${derived}`;
}

export function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) {
    return false;
  }

  const [version, salt, stored] = passwordHash.split("$");
  if (version !== passwordVersion || !salt || !stored) {
    return false;
  }

  const derived = scryptSync(password, salt, 64);
  const storedBuffer = Buffer.from(stored, "hex");

  return (
    derived.length === storedBuffer.length &&
    timingSafeEqual(derived, storedBuffer)
  );
}

export function createLocalSessionToken(userId: string) {
  const payload = JSON.stringify({
    userId,
    exp: Date.now() + localSessionTtlMs,
  } satisfies LocalSessionPayload);
  const encodedPayload = toBase64Url(payload);
  const signature = signValue(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyLocalSessionToken(token: string): LocalSessionPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString("utf8")) as Partial<LocalSessionPayload>;

    if (
      typeof payload.userId !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now()
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function getLocalSessionCookieOptions() {
  const isLocalHttpApp =
    env.appBaseUrl?.startsWith("http://localhost") ||
    env.appBaseUrl?.startsWith("http://127.0.0.1");

  return {
    name: localSessionCookieName,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && !isLocalHttpApp,
    path: "/",
    maxAge: Math.floor(localSessionTtlMs / 1000),
  };
}
