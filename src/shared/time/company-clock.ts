import { env } from "@/shared/config/env";

export type CompanyClockParts = {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

type ExternalTimeSourceSample = {
  url: string;
  ok: boolean;
  status?: number;
  dateHeader?: string | null;
  serverNowIso?: string;
  roundTripMs?: number;
  offsetMs?: number;
  error?: string;
};

export type ExternalClockSnapshot = {
  status: "verified" | "drift_warning" | "unavailable";
  checkedAtIso: string;
  effectiveNowIso: string;
  offsetMs: number | null;
  maxAllowedDriftMs: number;
  cacheTtlMs: number;
  successfulSourceCount: number;
  sources: ExternalTimeSourceSample[];
};

type ExternalClockState = {
  snapshot: ExternalClockSnapshot | null;
  offsetMs: number;
  expiresAt: number;
  refreshPromise: Promise<ExternalClockSnapshot> | null;
};

const weekdayMap: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const externalClockState: ExternalClockState = {
  snapshot: null,
  offsetMs: 0,
  expiresAt: 0,
  refreshPromise: null,
};

function getDateTimeFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
}

function getOffsetFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getCompanyTimeZone() {
  return env.companyTimeZone;
}

function getExternalTimeSourceList() {
  return env.externalTimeSources
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeExternalTimeCacheMs() {
  return Math.max(30_000, env.externalTimeCacheMs);
}

function normalizeExternalTimeTimeoutMs() {
  return Math.max(1_000, env.externalTimeTimeoutMs);
}

function getExternalTimeMaxDriftMs() {
  return Math.max(1_000, env.externalTimeMaxDriftMs);
}

function hasFreshExternalClock(nowMs = Date.now()) {
  return Boolean(externalClockState.snapshot) && nowMs < externalClockState.expiresAt;
}

function getMedian(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

async function fetchTimeSource(url: string): Promise<ExternalTimeSourceSample> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalizeExternalTimeTimeoutMs());

  try {
    let response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    let dateHeader = response.headers.get("date");
    if (!dateHeader) {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      dateHeader = response.headers.get("date");
    }

    const finishedAt = Date.now();
    if (!dateHeader) {
      return {
        url,
        ok: false,
        status: response.status,
        roundTripMs: finishedAt - startedAt,
        error: "Missing Date header.",
      };
    }

    const serverNow = new Date(dateHeader);
    if (!Number.isFinite(serverNow.getTime())) {
      return {
        url,
        ok: false,
        status: response.status,
        dateHeader,
        roundTripMs: finishedAt - startedAt,
        error: "Invalid Date header.",
      };
    }

    const midpoint = startedAt + Math.round((finishedAt - startedAt) / 2);
    return {
      url,
      ok: true,
      status: response.status,
      dateHeader,
      serverNowIso: serverNow.toISOString(),
      roundTripMs: finishedAt - startedAt,
      offsetMs: serverNow.getTime() - midpoint,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown external clock error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getExternalClockSnapshot() {
  return externalClockState.snapshot;
}

export function getCanonicalNow() {
  const offsetMs = hasFreshExternalClock() ? externalClockState.offsetMs : 0;
  return new Date(Date.now() + offsetMs);
}

export async function refreshExternalClockSnapshot(options?: { force?: boolean }) {
  const nowMs = Date.now();
  if (!options?.force && hasFreshExternalClock(nowMs) && externalClockState.snapshot) {
    return externalClockState.snapshot;
  }

  if (externalClockState.refreshPromise) {
    return externalClockState.refreshPromise;
  }

  externalClockState.refreshPromise = (async () => {
    const sources = getExternalTimeSourceList();
    const samples = await Promise.all(sources.map((source) => fetchTimeSource(source)));
    const successful = samples.filter(
      (sample): sample is ExternalTimeSourceSample & { offsetMs: number } =>
        sample.ok && typeof sample.offsetMs === "number",
    );
    const medianOffset = successful.length > 0 ? getMedian(successful.map((sample) => sample.offsetMs)) : null;
    const effectiveNow = new Date(nowMs + (medianOffset ?? 0));

    const snapshot: ExternalClockSnapshot = {
      status:
        medianOffset == null
          ? "unavailable"
          : Math.abs(medianOffset) > getExternalTimeMaxDriftMs()
            ? "drift_warning"
            : "verified",
      checkedAtIso: new Date(nowMs).toISOString(),
      effectiveNowIso: effectiveNow.toISOString(),
      offsetMs: medianOffset,
      maxAllowedDriftMs: getExternalTimeMaxDriftMs(),
      cacheTtlMs: normalizeExternalTimeCacheMs(),
      successfulSourceCount: successful.length,
      sources: samples,
    };

    externalClockState.snapshot = snapshot;
    externalClockState.offsetMs = medianOffset ?? 0;
    externalClockState.expiresAt = nowMs + normalizeExternalTimeCacheMs();

    return snapshot;
  })();

  try {
    return await externalClockState.refreshPromise;
  } finally {
    externalClockState.refreshPromise = null;
  }
}

export function getCompanyClockParts(
  date = getCanonicalNow(),
  timeZone = getCompanyTimeZone(),
): CompanyClockParts {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(getPart("year")),
    monthIndex: Number(getPart("month")) - 1,
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
    second: Number(getPart("second")),
    weekday: weekdayMap[getPart("weekday").toLowerCase()] ?? 0,
  };
}

export function getCompanyClockSnapshot(date = getCanonicalNow(), timeZone = getCompanyTimeZone()) {
  const parts = getCompanyClockParts(date, timeZone);
  const offsetValue = getOffsetFormatter(timeZone)
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const externalVerification = getExternalClockSnapshot();

  return {
    source:
      externalVerification?.status === "verified" || externalVerification?.status === "drift_warning"
        ? ("system+external-verification" as const)
        : ("system" as const),
    nowIso: date.toISOString(),
    timeZone,
    offset: offsetValue,
    companyDateTime: `${String(parts.year).padStart(4, "0")}-${String(parts.monthIndex + 1).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`,
    parts,
    externalVerification,
  };
}

export function zonedDateTimeToIso(input: {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  timeZone?: string;
}) {
  const timeZone = input.timeZone ?? getCompanyTimeZone();
  const desiredTimestamp = Date.UTC(
    input.year,
    input.monthIndex,
    input.day,
    input.hour,
    input.minute,
    input.second ?? 0,
    0,
  );

  let guess = new Date(desiredTimestamp);

  for (let index = 0; index < 4; index += 1) {
    const actual = getCompanyClockParts(guess, timeZone);
    const actualTimestamp = Date.UTC(
      actual.year,
      actual.monthIndex,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );

    const delta = desiredTimestamp - actualTimestamp;
    if (delta === 0) {
      break;
    }

    guess = new Date(guess.getTime() + delta);
  }

  return guess.toISOString();
}

export function shiftCompanyDateParts(parts: CompanyClockParts, days: number, timeZone = getCompanyTimeZone()) {
  const noonIso = zonedDateTimeToIso({
    year: parts.year,
    monthIndex: parts.monthIndex,
    day: parts.day,
    hour: 12,
    minute: 0,
    second: 0,
    timeZone,
  });

  return getCompanyClockParts(new Date(new Date(noonIso).getTime() + days * 24 * 60 * 60 * 1000), timeZone);
}

export function getDefaultAppointmentDurationMinutes() {
  return Math.max(15, Math.min(8 * 60, env.defaultAppointmentDurationMinutes));
}
