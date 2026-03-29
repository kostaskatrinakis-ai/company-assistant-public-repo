import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { persistWhatsAppWebhookPayload } from "@/modules/whatsapp/service";
import { env } from "@/shared/config/env";

export const dynamic = "force-dynamic";

function hasValidWhatsAppSignature(rawBody: string, signatureHeader: string) {
  const expected = `sha256=${createHmac("sha256", env.whatsappAppSecret ?? "").update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token");
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (
    mode === "subscribe" &&
    challenge &&
    expectedToken &&
    verifyToken === expectedToken
  ) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    message:
      "Webhook endpoint is reachable. Set WHATSAPP_VERIFY_TOKEN to enable Meta verification.",
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: unknown = null;
  const isLocalHost =
    request.nextUrl.hostname === "localhost" ||
    request.nextUrl.hostname === "127.0.0.1";

  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "WHATSAPP_PAYLOAD_INVALID",
      },
      { status: 400 },
    );
  }
  const signatureHeader = request.headers.get("x-hub-signature-256");

  if (env.whatsappAppSecret) {
    if (!signatureHeader || !hasValidWhatsAppSignature(rawBody, signatureHeader)) {
      return NextResponse.json(
        {
          ok: false,
          error: "WHATSAPP_SIGNATURE_INVALID",
        },
        { status: 401 },
      );
    }
  } else if (process.env.NODE_ENV === "production" && !isLocalHost) {
    return NextResponse.json(
      {
        ok: false,
        error: "WHATSAPP_APP_SECRET_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(await persistWhatsAppWebhookPayload(payload));
}
