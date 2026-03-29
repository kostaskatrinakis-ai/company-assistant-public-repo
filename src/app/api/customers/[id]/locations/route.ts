import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { errorResponse, okResponse, zodErrorResponse } from "@/shared/http/response";
import { createLocationSchema } from "@/modules/customers/schemas";
import { createLocation, getCustomerById } from "@/modules/customers/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiPermission("customers.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const customer = await getCustomerById(id);
    if (!customer) {
      return errorResponse("NOT_FOUND", "Ο πελάτης δεν βρέθηκε.", 404);
    }

    const body = createLocationSchema.parse(await request.json());
    return okResponse(await createLocation(id, body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας τοποθεσίας.", 500);
  }
}
