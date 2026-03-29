import { ZodError } from "zod";
import { authorizeApiPermission, authorizeApiRoles } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { createWorkOrderSchema } from "@/modules/work-orders/schemas";
import { createWorkOrder, listWorkOrders } from "@/modules/work-orders/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiRoles(["owner", "operator", "technician"]);
  if (!auth.ok) {
    return auth.response;
  }

  const workOrders = await listWorkOrders(auth.user);
  return okResponse({
    count: workOrders.length,
    items: workOrders,
  });
}

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("work_orders.write");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = createWorkOrderSchema.parse(await request.json());
    return okResponse(await createWorkOrder(body, auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία δημιουργίας work order.", 500);
  }
}
