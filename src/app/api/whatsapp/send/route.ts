import { DomainEntityType } from "@prisma/client";
import { z } from "zod";
import { authorizeApiPermission } from "@/shared/auth/api";
import {
  businessRuleErrorResponse,
  errorResponse,
  okResponse,
  zodErrorResponse,
} from "@/shared/http/response";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { sendWhatsAppTextMessage } from "@/modules/whatsapp/outbound";

export const dynamic = "force-dynamic";

const sendWhatsAppSchema = z.object({
  to: z.string().trim().min(4),
  body: z.string().trim().min(2).max(1000),
  linkedEntityType: z.nativeEnum(DomainEntityType).optional(),
  linkedEntityId: z.string().trim().optional().nullable(),
});

export async function POST(request: Request) {
  const auth = await authorizeApiPermission("whatsapp.send");
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = sendWhatsAppSchema.parse(await request.json());
    return okResponse(
      await sendWhatsAppTextMessage({
        to: body.to,
        body: body.body,
        actor: auth.user,
        linkedEntityType: body.linkedEntityType,
        linkedEntityId: body.linkedEntityId,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodErrorResponse(error);
    }
    if (error instanceof BusinessRuleError) {
      return businessRuleErrorResponse(error);
    }

    return errorResponse("INTERNAL_ERROR", "Αποτυχία αποστολής WhatsApp.", 500);
  }
}
