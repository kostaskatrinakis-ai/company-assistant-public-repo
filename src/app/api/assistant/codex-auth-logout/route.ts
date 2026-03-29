import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CODEX_SESSION_COOKIE,
  deleteCodexSession,
  getPkceCookieName,
} from "@/shared/config/codex-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(CODEX_SESSION_COOKIE)?.value;
  await deleteCodexSession(sessionCookie);

  const response = NextResponse.json({
    ok: true,
    data: { authenticated: false },
  });

  response.cookies.delete(CODEX_SESSION_COOKIE);
  response.cookies.delete(getPkceCookieName());

  return response;
}
