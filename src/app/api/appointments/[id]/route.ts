import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { updateAppointmentSchema } from "@/modules/appointments/schemas";
import { deleteAppointment, updateAppointment } from "@/modules/appointments/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("appointments.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = updateAppointmentSchema.parse(await request.json());
    const updated = await updateAppointment(id, body, auth.user);

    if (!updated) {
      return errorResponse("NOT_FOUND", "Το ραντεβού δεν βρέθηκε.", 404);
    }

    return okResponse(updated);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία ενημέρωσης ραντεβού.", 500);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("appointments.delete");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteAppointment(id, auth.user);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Το ραντεβού δεν βρέθηκε.", 404);
    }

    return okResponse(deleted);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής ραντεβού.", 500);
  }
}
