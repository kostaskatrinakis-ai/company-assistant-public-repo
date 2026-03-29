import { deleteLocation } from "@/modules/customers/service";
import { authorizeApiPermission } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("locations.delete");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteLocation(id, auth.user);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Η εγκατάσταση δεν βρέθηκε.", 404);
    }

    return okResponse(deleted);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής εγκατάστασης.", 500);
  }
}
