import { z } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { connectIMessageChannel } from "@/modules/personal-channels/service";

export const dynamic = "force-dynamic";

const connectSchema = z.object({
  handle: z.string().trim().min(3).max(160),
});

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = connectSchema.parse(await request.json());
    return okResponse(await connectIMessageChannel(auth.user, body.handle));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to connect iMessage on this Mac.",
      500,
    );
  }
}
