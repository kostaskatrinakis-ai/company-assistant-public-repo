import { authorizeApiRoles } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { deleteLocalUser } from "@/modules/users/service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRoles(["owner"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await params;
    await deleteLocalUser(id);
    return okResponse({ success: true });
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία διαγραφής χρήστη.", 500);
  }
}
