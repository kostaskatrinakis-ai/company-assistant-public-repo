import { z } from "zod";
import { cookies } from "next/headers";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { sendAssistantMessage } from "@/modules/assistant/service";
import { normalizeLocale } from "@/shared/ui/types";
import { CODEX_SESSION_COOKIE } from "@/shared/config/codex-auth";

export const dynamic = "force-dynamic";

const createMessageSchema = z.object({
  conversationId: z.string().trim().optional(),
  body: z.string().trim().min(2).max(2000),
  locale: z.enum(["el", "en"]).optional(),
  channel: z.enum(["APP", "WHATSAPP", "IMESSAGE"]).optional(),
  contextType: z.enum(["GLOBAL", "REQUEST", "WORK_ORDER", "DASHBOARD"]).optional(),
  contextEntityId: z.string().trim().optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createMessageSchema.parse(await request.json());

    // Read Codex OAuth tokens from cookie
    const cookieStore = await cookies();
    const codexTokenCookie = cookieStore.get(CODEX_SESSION_COOKIE)?.value;

    return okResponse(
      await sendAssistantMessage({
        conversationId: body.conversationId,
        body: body.body,
        locale: normalizeLocale(body.locale),
        channel: body.channel,
        contextType: body.contextType,
        contextEntityId: body.contextEntityId,
        user: auth.user,
        codexTokenCookie,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία αποστολής assistant message.", 500);
  }
}
