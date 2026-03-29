import { ZodError } from "zod";
import { authorizeApiRoles } from "@/shared/auth/api";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import {
  getHeartbeatSettings,
  parseHeartbeatSettingsInput,
  updateHeartbeatSettings,
} from "@/modules/heartbeat/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeApiRoles(["admin"]);
  if (!auth.ok) {
    return auth.response;
  }

  return okResponse(await getHeartbeatSettings());
}

export async function PUT(request: Request) {
  const auth = await authorizeApiRoles(["admin"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = parseHeartbeatSettingsInput(await request.json());
    return okResponse(await updateHeartbeatSettings(body, auth.user.id));
  } catch (error) {
    if (error instanceof ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Heartbeat settings update failed.", 500);
  }
}
