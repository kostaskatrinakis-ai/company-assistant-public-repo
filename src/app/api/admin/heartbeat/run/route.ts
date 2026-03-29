import { authorizeApiRoles } from "@/shared/auth/api";
import { errorResponse, okResponse } from "@/shared/http/response";
import { runHeartbeatNow } from "@/modules/heartbeat/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await authorizeApiRoles(["admin"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return okResponse(await runHeartbeatNow(auth.user.id));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Heartbeat run failed.", 500);
  }
}
