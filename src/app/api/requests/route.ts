import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import { errorResponse, okResponse, zodErrorResponse } from "@/shared/http/response";
import { createRequestSchema } from "@/modules/requests/schemas";
import { createRequest, listRequests } from "@/modules/requests/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("requests.write");
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await listRequests());
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("requests.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createRequestSchema.parse(await request.json());
    return okResponse(await createRequest(body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας αιτήματος.", 500);
  }
}
