import { ZodError } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { createLocalUserSchema } from "@/modules/users/schemas";
import { createLocalUser, listUsers } from "@/modules/users/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiPermission("users.manage");
  if (!auth.ok) {
    return auth.response;
  }
  const users = await listUsers();

  return okResponse({
    count: users.length,
    items: users,
  });
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("users.manage");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createLocalUserSchema.parse(await request.json());
    const user = await createLocalUser(body);

    return okResponse(user, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }

    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας χρήστη.", 500);
  }
}
