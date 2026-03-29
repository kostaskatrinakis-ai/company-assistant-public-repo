import { z } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { approveAssistantActionRequest } from "@/modules/assistant/service";
import { normalizeLocale } from "@/shared/ui/types";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  decisionNote: z.string().trim().optional().nullable(),
  locale: z.enum(["el", "en"]).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("assistant.execute_actions");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = decisionSchema.parse(await request.json().catch(() => ({})));
    const { id } = await context.params;
    return okResponse(
      await approveAssistantActionRequest({
        actionRequestId: id,
        user: auth.user,
        locale: normalizeLocale(body.locale),
        decisionNote: body.decisionNote,
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία approve του assistant action.", 500);
  }
}
