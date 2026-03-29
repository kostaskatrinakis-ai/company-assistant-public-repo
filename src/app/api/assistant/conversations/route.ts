import { z } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  createAssistantConversation,
  listAssistantConversations,
} from "@/modules/assistant/service";

export const dynamic = "force-dynamic";

const createConversationSchema = z.object({
  channel: z.enum(["APP", "WHATSAPP", "IMESSAGE"]).optional(),
  contextType: z.enum(["GLOBAL", "REQUEST", "WORK_ORDER", "DASHBOARD"]).optional(),
  contextEntityId: z.string().trim().optional().nullable(),
});

export async function GET() {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await listAssistantConversations(auth.user));
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createConversationSchema.parse(await request.json().catch(() => ({})));
    return okResponse(await createAssistantConversation(body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας conversation.", 500);
  }
}
