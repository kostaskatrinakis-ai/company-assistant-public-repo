import { ZodError } from "zod";
import { followUpWorkOrderSchema } from "@/modules/work-orders/schemas";
import { markWorkOrderFollowUpRequired } from "@/modules/work-orders/service";
import { authorizeApiRoles } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRoles(["owner", "operator", "technician"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = followUpWorkOrderSchema.parse(await request.json());
    const updated = await markWorkOrderFollowUpRequired(id, body, auth.user);

    if (!updated) {
      return errorResponse("NOT_FOUND", "Το work order δεν βρέθηκε.", 404);
    }

    return okResponse(updated);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία μετάβασης work order σε follow-up.", 500);
  }
}
