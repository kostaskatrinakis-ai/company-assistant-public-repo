import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { updateInvoiceReminderSchema } from "@/modules/reminders/schemas";
import {
  deleteInvoiceReminder,
  updateInvoiceReminder,
} from "@/modules/reminders/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("reminders.manage");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = updateInvoiceReminderSchema.parse(await request.json());
    const { id } = await context.params;
    const reminder = await updateInvoiceReminder(id, body, auth.user);

    if (!reminder) {
      return errorResponse("NOT_FOUND", "Το reminder δεν βρέθηκε.", 404);
    }

    return okResponse(reminder);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία ενημέρωσης reminder.", 500);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("reminders.delete");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteInvoiceReminder(id, auth.user);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Το reminder δεν βρέθηκε.", 404);
    }

    return okResponse(deleted);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής reminder.", 500);
  }
}
