import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { markInvoiceReminderReadyForAccounting } from "@/modules/reminders/service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("reminders.manage");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const reminder = await markInvoiceReminderReadyForAccounting(id, auth.user);

    if (!reminder) {
      return errorResponse("NOT_FOUND", "Το reminder δεν βρέθηκε.", 404);
    }

    return okResponse(reminder);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία handoff του reminder.", 500);
  }
}
