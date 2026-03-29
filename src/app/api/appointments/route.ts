import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { createAppointmentSchema } from "@/modules/appointments/schemas";
import { createAppointment, listAppointments } from "@/modules/appointments/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("appointments.write");
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await listAppointments(auth.user));
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("appointments.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createAppointmentSchema.parse(await request.json());
    return okResponse(await createAppointment(body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας ραντεβού.", 500);
  }
}
