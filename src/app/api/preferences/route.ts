import { NextResponse } from "next/server";
import { z } from "zod";
import {
  localeCookieName,
  normalizeLocale,
  normalizeTheme,
  themeCookieName,
} from "@/shared/ui/types";

export const dynamic = "force-dynamic";

const preferencesSchema = z.object({
  locale: z.enum(["el", "en"]).optional(),
  theme: z.enum(["light", "dark"]).optional(),
});

export async function POST(request: Request) {
  const body = preferencesSchema.parse(await request.json());
  const response = NextResponse.json({
    ok: true,
    data: {
      locale: body.locale ? normalizeLocale(body.locale) : undefined,
      theme: body.theme ? normalizeTheme(body.theme) : undefined,
    },
  });

  if (body.locale) {
    response.cookies.set({
      name: localeCookieName,
      value: normalizeLocale(body.locale),
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  if (body.theme) {
    response.cookies.set({
      name: themeCookieName,
      value: normalizeTheme(body.theme),
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}
