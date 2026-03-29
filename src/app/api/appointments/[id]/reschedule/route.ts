import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { rescheduleAppointmentSchema } from "@/modules/appointments/schemas";
import { updateAppointment } from "@/modules/appointments/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("appointments.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = rescheduleAppointmentSchema.parse(await request.json());
    const updated = await updateAppointment(
      id,
      {
        startAt: body.startAt,
        endAt: body.endAt,
        state: "RESCHEDULED",
        reasonNote: body.reasonNote,
      },
      auth.user,
    );

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

    return errorResponse("INTERNAL_ERROR", "Αποτυχία μεταφοράς ραντεβού.", 500);
  }
}
