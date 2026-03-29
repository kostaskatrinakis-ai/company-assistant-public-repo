import { cookies } from "next/headers";
import {
  isCodexAuthenticated,
  CODEX_SESSION_COOKIE,
} from "@/shared/config/codex-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const tokenCookie = cookieStore.get(CODEX_SESSION_COOKIE)?.value;

  return Response.json({
    ok: true,
    data: {
      authenticated: await isCodexAuthenticated(tokenCookie),
    },
  });
}
