import { authorizeApiPermission } from "@/shared/auth/api";
import { errorResponse, okResponse } from "@/shared/http/response";
import { getApiPayload } from "@/lib/reporting";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("reports.read_all");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return okResponse(await getApiPayload());
  } catch (error) {
    return errorResponse(
      "INTERNAL_ERROR",
      error instanceof Error
        ? error.message
        : "Αποτυχία δημιουργίας daily report.",
      500,
    );
  }
}
