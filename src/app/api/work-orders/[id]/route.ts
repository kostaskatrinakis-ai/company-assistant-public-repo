import { ZodError } from "zod";
import { authorizeApiPermission, authorizeApiRoles } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import {
  deleteWorkOrder,
  getWorkOrderById,
  markWorkOrderReadyForInvoice,
  updateWorkOrder,
} from "@/modules/work-orders/service";
import { updateWorkOrderSchema } from "@/modules/work-orders/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRoles(["owner", "operator", "technician"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const workOrder = await getWorkOrderById(id, auth.user);
  if (!workOrder) {
    return errorResponse("NOT_FOUND", "Το work order δεν βρέθηκε.", 404);
  }

  return okResponse(workOrder);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("work_orders.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = updateWorkOrderSchema.parse(await request.json());
    const updated = body.markReadyForInvoice
      ? await markWorkOrderReadyForInvoice(id, auth.user)
      : await updateWorkOrder(id, body, auth.user);

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

    return errorResponse("INTERNAL_ERROR", "Αποτυχία ενημέρωσης work order.", 500);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("work_orders.delete");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteWorkOrder(id, auth.user);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Το work order δεν βρέθηκε.", 404);
    }

    return okResponse(deleted);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής work order.", 500);
  }
}
