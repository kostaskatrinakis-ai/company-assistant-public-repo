import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";

export function okResponse<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    {
      ok: true,
      data,
    },
    init,
  );
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? {},
      },
    },
    { status },
  );
}

export function zodErrorResponse(error: ZodError) {
  return errorResponse("VALIDATION_ERROR", "Μη έγκυρα δεδομένα εισόδου.", 422, {
    issues: error.flatten(),
  });
}

export function businessRuleErrorResponse(error: BusinessRuleError) {
  return errorResponse(error.code, error.message, error.status, error.details);
}
