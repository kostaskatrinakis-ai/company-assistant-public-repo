import { NextResponse } from "next/server";
import { ensureDatabaseReady } from "@/shared/db/readiness";
import { env } from "@/shared/config/env";
import {
  getCompanyClockSnapshot,
  refreshExternalClockSnapshot,
} from "@/shared/time/company-clock";

export const dynamic = "force-dynamic";

export async function GET() {
  const externalClock = await refreshExternalClockSnapshot();
  const clock = getCompanyClockSnapshot();

  try {
    await ensureDatabaseReady();

    return NextResponse.json({
      ok: true,
      service: "company-assistant",
      timestamp: clock.nowIso,
      clock,
      externalClock,
      database: {
        provider: env.databaseProvider,
        configured: true,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "company-assistant",
        timestamp: clock.nowIso,
        clock,
        externalClock,
        database: {
          provider: env.databaseProvider,
          configured: false,
          error: error instanceof Error ? error.message : "Unknown database error.",
        },
      },
      { status: 503 },
    );
  }
}
