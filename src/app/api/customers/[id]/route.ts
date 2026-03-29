import { authorizeApiPermission } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { deleteCustomer, getCustomerById } from "@/modules/customers/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("customers.read_all");
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const customer = await getCustomerById(id);

  if (!customer) {
    return errorResponse("NOT_FOUND", "Ο πελάτης δεν βρέθηκε.", 404);
  }

  return okResponse(customer);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("customers.delete");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteCustomer(id, auth.user);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Ο πελάτης δεν βρέθηκε.", 404);
    }

    return okResponse(deleted);
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής πελάτη.", 500);
  }
}
