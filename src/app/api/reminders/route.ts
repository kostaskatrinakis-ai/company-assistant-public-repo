import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  createInvoiceReminderSchema,
} from "@/modules/reminders/schemas";
import {
  createInvoiceReminder,
  listInvoiceReminders,
} from "@/modules/reminders/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("reminders.manage");
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await listInvoiceReminders());
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("reminders.manage");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createInvoiceReminderSchema.parse(await request.json());
    return okResponse(await createInvoiceReminder(body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας reminder.", 500);
  }
}
