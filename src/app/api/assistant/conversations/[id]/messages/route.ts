import { authorizeApiPermission } from "@/shared/auth/api";
import { errorResponse, okResponse } from "@/shared/http/response";
import { getAssistantConversationDetail } from "@/modules/assistant/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const detail = await getAssistantConversationDetail(id, auth.user);

  if (!detail) {
    return errorResponse("NOT_FOUND", "Η assistant conversation δεν βρέθηκε.", 404);
  }

  return okResponse(detail);
}
