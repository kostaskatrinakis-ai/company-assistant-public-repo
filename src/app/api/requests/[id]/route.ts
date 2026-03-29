import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { deleteRequest, getRequestById, updateRequest } from "@/modules/requests/service";
import { updateRequestSchema } from "@/modules/requests/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("requests.write");
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const requestRecord = await getRequestById(id);
  if (!requestRecord) {
    return errorResponse("NOT_FOUND", "Το αίτημα δεν βρέθηκε.", 404);
  }

  return okResponse(requestRecord);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("requests.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = updateRequestSchema.parse(await request.json());
    const updated = await updateRequest(id, body, auth.user);

    if (!updated) {
      return errorResponse("NOT_FOUND", "Το αίτημα δεν βρέθηκε.", 404);
    }

    return okResponse(updated);
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία ενημέρωσης αιτήματος.", 500);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("requests.delete");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteRequest(id, auth.user);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Το αίτημα δεν βρέθηκε.", 404);
    }

    return okResponse(deleted);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής αιτήματος.", 500);
  }
}
