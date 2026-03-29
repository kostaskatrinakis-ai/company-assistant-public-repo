import { ZodError } from "zod";
import { createMaterialUsageSchema } from "@/modules/materials/schemas";
import { createMaterialUsage } from "@/modules/materials/service";
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
  const auth = await authorizeApiRoles(["operator", "technician"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { id } = await context.params;
    const body = createMaterialUsageSchema.parse(await request.json());
    return okResponse(await createMaterialUsage(id, body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας υλικού.", 500);
  }
}
