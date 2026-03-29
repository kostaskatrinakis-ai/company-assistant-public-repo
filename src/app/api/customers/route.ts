import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { errorResponse, okResponse, zodErrorResponse } from "@/shared/http/response";
import { createCustomerSchema } from "@/modules/customers/schemas";
import { createCustomer, listCustomers } from "@/modules/customers/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("customers.read_all");
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await listCustomers());
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("customers.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createCustomerSchema.parse(await request.json());
    return okResponse(await createCustomer(body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας πελάτη.", 500);
  }
}
