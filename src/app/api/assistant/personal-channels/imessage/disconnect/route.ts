import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { disconnectIMessageChannel } from "@/modules/personal-channels/service";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return okResponse(await disconnectIMessageChannel(auth.user));
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to disconnect iMessage on this Mac.",
      500,
    );
  }
}
