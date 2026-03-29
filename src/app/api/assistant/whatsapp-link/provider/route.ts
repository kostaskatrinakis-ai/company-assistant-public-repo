import { cookies } from "next/headers";
import { authorizeApiRoles } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { CODEX_SESSION_COOKIE } from "@/shared/config/codex-auth";
import {
  configureWhatsAppProvider,
  disconnectWhatsAppProvider,
  getWhatsAppLinkStatus,
} from "@/modules/whatsapp/linking";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await authorizeApiRoles(["admin"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const cookieStore = await cookies();
    const codexSessionCookie = cookieStore.get(CODEX_SESSION_COOKIE)?.value;

    return okResponse(
      await configureWhatsAppProvider(auth.user, codexSessionCookie),
    );
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Αποτυχία ρύθμισης WhatsApp assistant provider.",
      500,
    );
  }
}

export async function DELETE() {
  const auth = await authorizeApiRoles(["admin"]);
  if (!auth.ok) {
    return auth.response;
  }

  try {
    await disconnectWhatsAppProvider();
    return okResponse(await getWhatsAppLinkStatus(auth.user));
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "Αποτυχία αποσύνδεσης WhatsApp assistant provider.",
      500,
    );
  }
}
