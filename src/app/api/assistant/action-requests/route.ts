import { authorizeApiPermission } from "@/shared/auth/api";
import { okResponse } from "@/shared/http/response";
import { listPendingAssistantActionRequests } from "@/modules/assistant/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await listPendingAssistantActionRequests(auth.user));
}
