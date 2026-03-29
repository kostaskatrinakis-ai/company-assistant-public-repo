import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { sendInvoiceReminderHandoff } from "@/modules/reminders/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await authorizeApiPermission("reminders.manage");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    return okResponse(await sendInvoiceReminderHandoff(id, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Αποτυχία αποστολής WhatsApp handoff.",
      500,
    );
  }
}
