import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { createWhatsAppPairing } from "@/modules/whatsapp/linking";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await authorizeApiPermission("assistant.use");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return okResponse(await createWhatsAppPairing(auth.user), { status: 201 });
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Αποτυχία δημιουργίας WhatsApp pairing code.",
      500,
    );
  }
}
