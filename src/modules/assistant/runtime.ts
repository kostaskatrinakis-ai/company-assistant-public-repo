import {
  AssistantChannel,
  DomainEntityType,
  MessagingChannel,
  RequestPriority,
  RequestSourceChannel,
  RequestState,
  WorkOrderAssignmentState,
  WorkOrderState,
} from "@prisma/client";
import { z } from "zod";
import { createAppointment } from "@/modules/appointments/service";
import { createCustomer, createLocation } from "@/modules/customers/service";
import { createMaterialUsage } from "@/modules/materials/service";
import { createRequest } from "@/modules/requests/service";
import { createInvoiceReminder, queueInvoiceReminder } from "@/modules/reminders/service";
import { createTimeEntry } from "@/modules/time-entries/service";
import { listUsers } from "@/modules/users/service";
import {
  completeWorkOrder,
  createWorkOrder,
  listWorkOrders,
  markWorkOrderFollowUpRequired,
  markWorkOrderReadyForInvoice,
  startWorkOrder,
  updateWorkOrder,
} from "@/modules/work-orders/service";
import type { SessionUser } from "@/shared/auth/types";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";
import {
  getCanonicalNow,
  getCompanyClockParts,
  getCompanyClockSnapshot,
  getCompanyTimeZone,
  refreshExternalClockSnapshot,
  shiftCompanyDateParts,
  type CompanyClockParts,
  zonedDateTimeToIso,
} from "@/shared/time/company-clock";
import type { UiLocale } from "@/shared/ui/types";
import { translate } from "@/shared/ui/types";

type AssistantContextSnapshot = {
  currentUser: {
    id: string;
    role: SessionUser["role"];
    permissions: SessionUser["permissions"];
    phoneNumber: string | null;
  };
  customers: Array<{
    id: string;
    businessName: string;
    mainPhone: string | null;
  }>;
  requests: Array<{
    id: string;
    description: string;
    state: string;
    priority: string;
    customerName: string | null;
    locationName: string | null;
  }>;
  workOrders: Array<{
    id: string;
    state: string;
    issueSummary: string;
    customerId: string;
    customerName: string;
    locationName: string;
    primaryAssigneeId: string | null;
    primaryAssigneeName: string | null;
  }>;
  reminders: Array<{
    id: string;
    monthKey: string;
    state: string;
    customerId: string;
    customerName: string;
  }>;
  technicians: Array<{
    id: string;
    fullName: string;
    phoneNumber: string | null;
  }>;
};

type AssistantToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type AssistantToolResult = {
  ok: boolean;
  action?: string;
  message: string;
  entityType?: DomainEntityType;
  entityId?: string | null;
  data?: Record<string, unknown>;
  notifications?: Array<{
    userId: string;
    userName: string;
    channel: MessagingChannel | "NONE";
    delivered: boolean;
    reason?: string;
  }>;
};

type ResolvedRequestRecord = {
  id: string;
  customerId: string | null;
  locationId: string | null;
  description: string;
  priority: RequestPriority;
  state: RequestState;
  customerName: string | null;
  locationName: string | null;
};

function normalizeResolvedRequest(input: {
  id: string;
  customerId?: string | null;
  locationId?: string | null;
  description: string;
  priority: RequestPriority;
  state: RequestState;
  customerName?: string | null;
  locationName?: string | null;
}): ResolvedRequestRecord {
  return {
    id: input.id,
    customerId: input.customerId ?? null,
    locationId: input.locationId ?? null,
    description: input.description,
    priority: input.priority,
    state: input.state,
    customerName: input.customerName ?? null,
    locationName: input.locationName ?? null,
  };
}

const searchCompanyDataArgsSchema = z.object({
  query: z.string().trim().optional().nullable(),
  scopes: z
    .array(
      z.enum([
        "customers",
        "locations",
        "requests",
        "appointments",
        "work_orders",
        "reminders",
        "technicians",
        "critical_events",
      ]),
    )
    .optional()
    .nullable(),
  limit: z.coerce.number().int().min(1).max(12).optional().nullable(),
});

const ensureCustomerProfileArgsSchema = z.object({
  customerName: z.string().trim().min(2),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  vatNumber: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  locationNotes: z.string().trim().optional().nullable(),
});

const captureServiceRequestArgsSchema = z.object({
  customerName: z.string().trim().optional().nullable(),
  customerPhone: z.string().trim().optional().nullable(),
  customerEmail: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  locationAddress: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  description: z.string().trim().min(4),
  priority: z.nativeEnum(RequestPriority).optional().nullable(),
  reportedByName: z.string().trim().optional().nullable(),
  sourceChannel: z.nativeEnum(RequestSourceChannel).optional().nullable(),
});

const scheduleServiceAppointmentArgsSchema = z.object({
  customerName: z.string().trim().optional().nullable(),
  customerPhone: z.string().trim().optional().nullable(),
  customerEmail: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  locationAddress: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  requestId: z.string().trim().optional().nullable(),
  requestDescription: z.string().trim().optional().nullable(),
  workOrderId: z.string().trim().optional().nullable(),
  workOrderSummary: z.string().trim().optional().nullable(),
  issueSummary: z.string().trim().optional().nullable(),
  technicianName: z.string().trim().optional().nullable(),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().optional().nullable(),
  reasonNote: z.string().trim().optional().nullable(),
  priority: z.nativeEnum(RequestPriority).optional().nullable(),
  reportedByName: z.string().trim().optional().nullable(),
});

const openWorkOrderArgsSchema = z.object({
  customerName: z.string().trim().optional().nullable(),
  customerPhone: z.string().trim().optional().nullable(),
  customerEmail: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  locationAddress: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  requestId: z.string().trim().optional().nullable(),
  requestDescription: z.string().trim().optional().nullable(),
  issueSummary: z.string().trim().min(4),
  technicianName: z.string().trim().optional().nullable(),
});

const updateWorkOrderArgsSchema = z.object({
  workOrderId: z.string().trim().optional().nullable(),
  workOrderSummary: z.string().trim().optional().nullable(),
  customerName: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  technicianName: z.string().trim().optional().nullable(),
  action: z.enum(["start", "complete", "follow_up", "ready_for_invoice", "reassign"]),
  resolutionSummary: z.string().trim().optional().nullable(),
  followUpReason: z.string().trim().optional().nullable(),
});

const logWorkTimeArgsSchema = z.object({
  workOrderId: z.string().trim().optional().nullable(),
  workOrderSummary: z.string().trim().optional().nullable(),
  customerName: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  minutesWorked: z.coerce.number().int().min(1).max(24 * 60),
  minutesTravel: z.coerce.number().int().min(0).max(24 * 60).optional().nullable(),
  note: z.string().trim().optional().nullable(),
});

const logMaterialUsageArgsSchema = z.object({
  workOrderId: z.string().trim().optional().nullable(),
  workOrderSummary: z.string().trim().optional().nullable(),
  customerName: z.string().trim().optional().nullable(),
  locationName: z.string().trim().optional().nullable(),
  description: z.string().trim().min(2),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  estimatedCost: z.coerce.number().nonnegative().optional().nullable(),
});

const manageInvoiceReminderArgsSchema = z.object({
  customerName: z.string().trim().optional().nullable(),
  customerPhone: z.string().trim().optional().nullable(),
  workOrderIds: z.array(z.string().trim().min(2)).optional().nullable(),
  workOrderSummaries: z.array(z.string().trim().min(2)).optional().nullable(),
  estimatedTotal: z.coerce.number().nonnegative(),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  note: z.string().trim().optional().nullable(),
  queueNow: z.boolean().optional().nullable(),
});

const reviewCriticalEventsArgsSchema = z.object({
  targetUserName: z.string().trim().optional().nullable(),
});

const notifyStaffMemberArgsSchema = z.object({
  userName: z.string().trim().min(2),
  body: z.string().trim().min(2).max(1000),
  channelPreference: z.enum(["AUTO", "WHATSAPP", "IMESSAGE"]).optional().nullable(),
});

type AssistantRuntimeInput = {
  user: SessionUser;
  locale: UiLocale;
  channel: AssistantChannel;
  context: AssistantContextSnapshot;
  conversationTranscript: string;
  allowMutations: boolean;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

const greekWeekdayMap: Record<string, number> = {
  δευτερα: 1,
  τριτη: 2,
  τεταρτη: 3,
  πεμπτη: 4,
  παρασκευη: 5,
  σαββατο: 6,
  κυριακη: 0,
};

const englishWeekdayMap: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const monthMap: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
  ιανουαριος: 0,
  ιανουαριου: 0,
  φεβρουαριος: 1,
  φεβρουαριου: 1,
  μαρτιος: 2,
  μαρτιου: 2,
  απριλιος: 3,
  απριλιου: 3,
  μαιος: 4,
  μαιου: 4,
  ιουνιος: 5,
  ιουνιου: 5,
  ιουλιος: 6,
  ιουλιου: 6,
  αυγουστος: 7,
  αυγουστου: 7,
  σεπτεμβριος: 8,
  σεπτεμβριου: 8,
  οκτωβριος: 9,
  οκτωβριου: 9,
  νοεμβριος: 10,
  νοεμβριου: 10,
  δεκεμβριος: 11,
  δεκεμβριου: 11,
};

function isValidDate(date: Date) {
  return Number.isFinite(date.getTime());
}

function compareDateParts(
  left: { year: number; monthIndex: number; day: number },
  right: { year: number; monthIndex: number; day: number },
) {
  const leftKey = left.year * 10_000 + (left.monthIndex + 1) * 100 + left.day;
  const rightKey = right.year * 10_000 + (right.monthIndex + 1) * 100 + right.day;
  return leftKey - rightKey;
}

function resolveUpcomingWeekday(baseDate: CompanyClockParts, targetDay: number, forceNextWeek: boolean) {
  const delta = (targetDay - baseDate.weekday + 7) % 7;
  const nextDelta = delta === 0 || forceNextWeek ? delta + 7 : delta;
  return shiftCompanyDateParts(baseDate, nextDelta);
}

function tryParseNumericDate(value: string, referenceDate: CompanyClockParts) {
  const isoMatch = value.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const [, yearRaw, monthRaw, dayRaw] = isoMatch;
    return {
      year: Number(yearRaw),
      monthIndex: Number(monthRaw) - 1,
      day: Number(dayRaw),
    };
  }

  const localMatch = value.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (!localMatch) {
    return null;
  }

  const [, dayRaw, monthRaw, yearRaw] = localMatch;
  let year = yearRaw ? Number(yearRaw) : referenceDate.year;
  if (yearRaw && year < 100) {
    year += 2000;
  }

  const monthIndex = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  const candidate = { year, monthIndex, day };

  if (!yearRaw) {
    if (compareDateParts(candidate, referenceDate) < 0) {
      year += 1;
    }
  }

  return {
    year,
    monthIndex,
    day,
  };
}

function tryParseMonthNameDate(value: string, referenceDate: CompanyClockParts) {
  const dayFirstMatch = value.match(
    /\b(\d{1,2})\s+([a-z\u0370-\u03ff]+)(?:\s+(\d{4}))?\b/i,
  );
  if (dayFirstMatch) {
    const [, dayRaw, monthRaw, yearRaw] = dayFirstMatch;
    const monthIndex = monthMap[normalizeText(monthRaw)];
    if (monthIndex !== undefined) {
      let year = yearRaw ? Number(yearRaw) : referenceDate.year;
      const day = Number(dayRaw);
      const candidate = { year, monthIndex, day };
      if (!yearRaw) {
        if (compareDateParts(candidate, referenceDate) < 0) {
          year += 1;
        }
      }

      return {
        year,
        monthIndex,
        day,
      };
    }
  }

  const monthFirstMatch = value.match(
    /\b([a-z\u0370-\u03ff]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i,
  );
  if (!monthFirstMatch) {
    return null;
  }

  const [, monthRaw, dayRaw, yearRaw] = monthFirstMatch;
  const monthIndex = monthMap[normalizeText(monthRaw)];
  if (monthIndex === undefined) {
    return null;
  }

  let year = yearRaw ? Number(yearRaw) : referenceDate.year;
  const day = Number(dayRaw);
  const candidate = { year, monthIndex, day };
  if (!yearRaw) {
    if (compareDateParts(candidate, referenceDate) < 0) {
      year += 1;
    }
  }

  return {
    year,
    monthIndex,
    day,
  };
}

function extractDateParts(value: string, referenceDate: CompanyClockParts) {
  const normalized = normalizeText(value);

  if (normalized.includes("day after tomorrow") || normalized.includes("μεθαυριο")) {
    const target = shiftCompanyDateParts(referenceDate, 2);
    return {
      year: target.year,
      monthIndex: target.monthIndex,
      day: target.day,
    };
  }

  if (normalized.includes("tomorrow") || normalized.includes("αυριο")) {
    const target = shiftCompanyDateParts(referenceDate, 1);
    return {
      year: target.year,
      monthIndex: target.monthIndex,
      day: target.day,
    };
  }

  if (normalized.includes("today") || normalized.includes("σημερα")) {
    return {
      year: referenceDate.year,
      monthIndex: referenceDate.monthIndex,
      day: referenceDate.day,
    };
  }

  const numeric = tryParseNumericDate(normalized, referenceDate);
  if (numeric) {
    return numeric;
  }

  const monthName = tryParseMonthNameDate(normalized, referenceDate);
  if (monthName) {
    return monthName;
  }

  const greekWeekdayEntry = Object.entries(greekWeekdayMap).find(([name]) =>
    normalized.includes(name),
  );
  if (greekWeekdayEntry) {
    const target = resolveUpcomingWeekday(
      referenceDate,
      greekWeekdayEntry[1],
      normalized.includes("επομεν") || normalized.includes("την αλλη εβδομαδα"),
    );
    return {
      year: target.year,
      monthIndex: target.monthIndex,
      day: target.day,
    };
  }

  const englishWeekdayEntry = Object.entries(englishWeekdayMap).find(([name]) =>
    normalized.includes(name),
  );
  if (englishWeekdayEntry) {
    const target = resolveUpcomingWeekday(
      referenceDate,
      englishWeekdayEntry[1],
      normalized.includes("next "),
    );
    return {
      year: target.year,
      monthIndex: target.monthIndex,
      day: target.day,
    };
  }

  return null;
}

function extractTimeParts(value: string) {
  const normalized = normalizeText(value);
  const timeMatch =
    normalized.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm|πμ|μμ)?\b/) ??
    normalized.match(/\b(\d{1,2})\s*(am|pm|πμ|μμ)\b/);

  let hour: number | null = null;
  let minute = 0;
  let meridiem: string | null = null;

  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    meridiem = timeMatch[3] ?? null;
  } else {
    const shortHourMatch =
      normalized.match(/(?:στις|στη|για τις|για τη|κατα τις|κατα τη|at|around)\s*(\d{1,2})(?!\d)/) ??
      normalized.match(/^(\d{1,2})$/);
    if (shortHourMatch) {
      hour = Number(shortHourMatch[1]);
    }
  }

  const hasMorning =
    normalized.includes("πρωι") || normalized.includes("morning");
  const hasAfternoon =
    normalized.includes("απογευμα") || normalized.includes("afternoon");
  const hasEvening =
    normalized.includes("βραδυ") || normalized.includes("evening");
  const hasNoon =
    normalized.includes("μεσημερ") || normalized.includes("noon");
  const hasNight = normalized.includes("night");

  if (hour === null) {
    if (hasMorning) {
      return { hour: 9, minute: 0 };
    }
    if (hasNoon) {
      return { hour: 12, minute: 0 };
    }
    if (hasAfternoon) {
      return { hour: 15, minute: 0 };
    }
    if (hasEvening || hasNight) {
      return { hour: 18, minute: 0 };
    }
    return null;
  }

  if (hour > 23 || minute > 59) {
    return null;
  }

  const isPm =
    meridiem === "pm" ||
    meridiem === "μμ" ||
    hasAfternoon ||
    hasEvening ||
    hasNight;
  const isAm = meridiem === "am" || meridiem === "πμ" || hasMorning;

  if (isPm && hour < 12) {
    hour += 12;
  } else if (isAm && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
}

function looksLikeIsoDateTime(value: string) {
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

function looksLikeDateTimeWithoutTimezone(value: string) {
  return /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(value.trim());
}

function parseNaturalDateTime(input: {
  value: string;
  locale: UiLocale;
  referenceDate?: Date;
  baseDate?: Date | null;
  label: "start" | "end";
}) {
  const raw = compactText(input.value);
  if (!raw) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: input.label === "start" ? "Λείπει η ώρα έναρξης." : "Λείπει η ώρα λήξης.",
        en: input.label === "start" ? "The start time is missing." : "The end time is missing.",
      }),
    );
  }

  if (looksLikeIsoDateTime(raw) && /(Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    if (isValidDate(parsed)) {
      return parsed.toISOString();
    }
  }

  if (looksLikeDateTimeWithoutTimezone(raw)) {
    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw] =
      raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/) ?? [];
    if (yearRaw && monthRaw && dayRaw && hourRaw && minuteRaw) {
      return zonedDateTimeToIso({
        year: Number(yearRaw),
        monthIndex: Number(monthRaw) - 1,
        day: Number(dayRaw),
        hour: Number(hourRaw),
        minute: Number(minuteRaw),
        second: 0,
        timeZone: getCompanyTimeZone(),
      });
    }
  }

  const referenceDate = getCompanyClockParts(input.referenceDate ?? getCanonicalNow());
  const dateParts =
    extractDateParts(raw, referenceDate) ??
    (input.baseDate
      ? (() => {
          const baseParts = getCompanyClockParts(input.baseDate);
          return {
            year: baseParts.year,
            monthIndex: baseParts.monthIndex,
            day: baseParts.day,
          };
        })()
      : null);
  const timeParts = extractTimeParts(raw);

  if (!dateParts) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el:
          input.label === "start"
            ? "Χρειάζομαι ημερομηνία για το ραντεβού, π.χ. «αύριο» ή «29/03». "
            : "Χρειάζομαι ημερομηνία για τη λήξη, ή μπορείς να δώσεις μόνο ώρα αν είναι την ίδια μέρα.",
        en:
          input.label === "start"
            ? "I need a date for the appointment, for example “tomorrow” or “29/03”."
            : "I need a date for the end time, or you can give only a time if it is on the same day.",
      }),
    );
  }

  if (!timeParts) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el:
          input.label === "start"
            ? "Χρειάζομαι και ώρα για το ραντεβού, π.χ. «αύριο στις 10:00»."
            : "Χρειάζομαι και ώρα λήξης, π.χ. «11:30».",
        en:
          input.label === "start"
            ? "I also need a time for the appointment, for example “tomorrow at 10:00”."
            : "I also need an end time, for example “11:30”.",
      }),
    );
  }

  const resolved = new Date(
    zonedDateTimeToIso({
      year: dateParts.year,
      monthIndex: dateParts.monthIndex,
      day: dateParts.day,
      hour: timeParts.hour,
      minute: timeParts.minute,
      second: 0,
      timeZone: getCompanyTimeZone(),
    }),
  );

  if (!isValidDate(resolved)) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: "Δεν μπόρεσα να καταλάβω έγκυρη ημερομηνία και ώρα.",
        en: "I could not understand a valid date and time.",
      }),
    );
  }

  return resolved.toISOString();
}

function normalizePhone(value: string | null | undefined) {
  const compact = value?.replace(/[^\d+]/g, "").trim();
  return compact && compact.length > 0 ? compact : null;
}

function matchesQuery(fields: Array<string | null | undefined>, query: string) {
  const queryNorm = normalizeText(query);
  if (!queryNorm) {
    return false;
  }

  return fields.some((field) => normalizeText(field).includes(queryNorm));
}

function exactMatchesQuery(fields: Array<string | null | undefined>, query: string) {
  const queryNorm = normalizeText(query);
  if (!queryNorm) {
    return false;
  }

  return fields.some((field) => normalizeText(field) === queryNorm);
}

function formatMatchList(values: string[]) {
  return values.slice(0, 4).join(", ");
}

function buildAssistantToolError(message: string) {
  return new BusinessRuleError("ASSISTANT_TOOL_ERROR", message, 422);
}

function ensurePermission(user: SessionUser, permission: SessionUser["permissions"][number], locale: UiLocale) {
  if (!user.permissions.includes(permission)) {
    throw new BusinessRuleError(
      "ASSISTANT_PERMISSION_DENIED",
      translate(locale, {
        el: "Δεν έχεις δικαίωμα για αυτή την ενέργεια.",
        en: "You do not have permission for this action.",
      }),
      403,
    );
  }
}

async function resolveTechnician(input: {
  technicianName?: string | null;
  user: SessionUser;
  locale: UiLocale;
}) {
  if (!compactText(input.technicianName) && input.user.role === "technician") {
    return input.user;
  }

  const technicians = (await listUsers()).filter(
    (candidate) => candidate.role === "technician" && candidate.isActive,
  );

  if (!compactText(input.technicianName)) {
    if (technicians.length === 1) {
      return technicians[0];
    }

    throw buildAssistantToolError(
      translate(input.locale, {
        el: "Χρειάζομαι ποιον τεχνικό να χρησιμοποιήσω.",
        en: "I need to know which technician to use.",
      }),
    );
  }

  const query = input.technicianName ?? "";
  const exact = technicians.filter((candidate) =>
    exactMatchesQuery([candidate.fullName, candidate.phoneNumber, candidate.email], query),
  );
  const matches = exact.length
    ? exact
    : technicians.filter((candidate) =>
        matchesQuery([candidate.fullName, candidate.phoneNumber, candidate.email], query),
      );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: `Βρήκα πολλούς τεχνικούς: ${formatMatchList(matches.map((item) => item.fullName))}.`,
        en: `I found multiple technicians: ${formatMatchList(matches.map((item) => item.fullName))}.`,
      }),
    );
  }

  throw buildAssistantToolError(
    translate(input.locale, {
      el: "Δεν βρήκα αυτόν τον τεχνικό.",
      en: "I could not find that technician.",
    }),
  );
}

async function resolveCustomer(input: {
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  allowCreate: boolean;
  notes?: string | null;
  vatNumber?: string | null;
  user: SessionUser;
  locale: UiLocale;
}) {
  const db = await getDatabaseClient();
  const customerName = compactText(input.customerName);
  const phone = normalizePhone(input.customerPhone);
  const email = compactText(input.customerEmail)?.toLowerCase() ?? null;

  if (!customerName && !phone && !email) {
    return null;
  }

  const customers = await db.customer.findMany({
    include: {
      locations: {
        orderBy: { name: "asc" },
      },
    },
    orderBy: { businessName: "asc" },
  });

  const exact = customers.filter((candidate) =>
    exactMatchesQuery(
      [candidate.businessName, candidate.mainPhone, candidate.mainEmail],
      customerName ?? phone ?? email ?? "",
    ),
  );
  const matches = exact.length
    ? exact
    : customers.filter((candidate) =>
        [customerName, phone, email]
          .filter((value): value is string => Boolean(value))
          .some((query) =>
            matchesQuery([candidate.businessName, candidate.mainPhone, candidate.mainEmail], query),
          ),
      );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: `Βρήκα πολλούς πελάτες: ${formatMatchList(matches.map((item) => item.businessName))}.`,
        en: `I found multiple customers: ${formatMatchList(matches.map((item) => item.businessName))}.`,
      }),
    );
  }

  if (!input.allowCreate || !customerName) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: "Δεν βρήκα πελάτη με αυτά τα στοιχεία.",
        en: "I could not find a customer with those details.",
      }),
    );
  }

  ensurePermission(input.user, "customers.write", input.locale);
  return createCustomer(
    {
      businessName: customerName,
      mainPhone: phone,
      mainEmail: email,
      notes: compactText(input.notes),
      vatNumber: compactText(input.vatNumber),
    },
    input.user,
  );
}

async function resolveLocationForCustomer(input: {
  customer:
    | {
        id: string;
        businessName?: string;
        locations?: Array<{
          id: string;
          customerId: string;
          name: string;
          address: string;
          city?: string | null;
          notes?: string | null;
        }>;
      }
    | null;
  locationName?: string | null;
  locationAddress?: string | null;
  city?: string | null;
  locationNotes?: string | null;
  allowCreate: boolean;
  user: SessionUser;
  locale: UiLocale;
}) {
  if (!input.customer) {
    return null;
  }

  const db = await getDatabaseClient();
  const customerLocations =
    input.customer.locations ??
    (await db.location.findMany({
      where: { customerId: input.customer.id },
      orderBy: { name: "asc" },
    }));

  const locationName = compactText(input.locationName);
  const locationAddress = compactText(input.locationAddress);
  const city = compactText(input.city);

  if (!locationName && !locationAddress) {
    if (customerLocations.length === 1) {
      return customerLocations[0];
    }

    if (customerLocations.length === 0) {
      return null;
    }

    throw buildAssistantToolError(
      translate(input.locale, {
        el: "Ο πελάτης έχει πολλές τοποθεσίες. Χρειάζομαι όνομα ή διεύθυνση τοποθεσίας.",
        en: "This customer has multiple locations. I need the location name or address.",
      }),
    );
  }

  const exact = customerLocations.filter((location) =>
    [locationName, locationAddress]
      .filter((value): value is string => Boolean(value))
      .some((query) => exactMatchesQuery([location.name, location.address, location.city], query)),
  );
  const matches = exact.length
    ? exact
    : customerLocations.filter((location) =>
        [locationName, locationAddress, city]
          .filter((value): value is string => Boolean(value))
          .some((query) => matchesQuery([location.name, location.address, location.city], query)),
      );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: `Βρήκα πολλές τοποθεσίες: ${formatMatchList(matches.map((item) => item.name))}.`,
        en: `I found multiple locations: ${formatMatchList(matches.map((item) => item.name))}.`,
      }),
    );
  }

  if (!input.allowCreate || !locationAddress) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: "Δεν βρήκα την τοποθεσία. Για νέα τοποθεσία χρειάζομαι τουλάχιστον διεύθυνση.",
        en: "I could not find the location. To create a new location I need at least the address.",
      }),
    );
  }

  ensurePermission(input.user, "customers.write", input.locale);
  return createLocation(
    input.customer.id,
    {
      name: locationName ?? input.customer.businessName ?? "Main site",
      address: locationAddress,
      city,
      notes: compactText(input.locationNotes),
    },
    input.user,
  );
}

async function resolveRequest(input: {
  requestId?: string | null;
  requestDescription?: string | null;
  customerId?: string | null;
  locationId?: string | null;
  locale: UiLocale;
}): Promise<ResolvedRequestRecord | null> {
  const db = await getDatabaseClient();
  const requestId = compactText(input.requestId);
  if (requestId) {
    const direct = await db.request.findUnique({
      where: { id: requestId },
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
      },
    });

    if (!direct) {
      throw buildAssistantToolError(
        translate(input.locale, {
          el: "Δεν βρήκα αυτό το request.",
          en: "I could not find that request.",
        }),
      );
    }

    return normalizeResolvedRequest({
      id: direct.id,
      customerId: direct.customerId,
      locationId: direct.locationId,
      description: direct.description,
      priority: direct.priority,
      state: direct.state,
      customerName: direct.customer?.businessName ?? null,
      locationName: direct.location?.name ?? null,
    });
  }

  const description = compactText(input.requestDescription);
  const requests = await db.request.findMany({
    where: {
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.locationId ? { locationId: input.locationId } : {}),
      state: {
        not: RequestState.CANCELED,
      },
    },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  if (!description) {
    if (requests.length === 1) {
      const request = requests[0];
      return normalizeResolvedRequest({
        id: request.id,
        customerId: request.customerId,
        locationId: request.locationId,
        description: request.description,
        priority: request.priority,
        state: request.state,
        customerName: request.customer?.businessName ?? null,
        locationName: request.location?.name ?? null,
      });
    }
    return null;
  }

  const exact = requests.filter((request) =>
    exactMatchesQuery([request.description], description),
  );
  const matches = exact.length
    ? exact
    : requests.filter((request) =>
        matchesQuery(
          [request.description, request.customer?.businessName, request.location?.name],
          description,
        ),
      );

  if (matches.length === 1) {
    const match = matches[0];
    return normalizeResolvedRequest({
      id: match.id,
      customerId: match.customerId,
      locationId: match.locationId,
      description: match.description,
      priority: match.priority,
      state: match.state,
      customerName: match.customer?.businessName ?? null,
      locationName: match.location?.name ?? null,
    });
  }

  if (matches.length > 1) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: `Βρήκα πολλά requests: ${formatMatchList(matches.map((item) => item.description))}.`,
        en: `I found multiple requests: ${formatMatchList(matches.map((item) => item.description))}.`,
      }),
    );
  }

  return null;
}

async function resolveAccessibleWorkOrder(input: {
  user: SessionUser;
  workOrderId?: string | null;
  workOrderSummary?: string | null;
  customerName?: string | null;
  locationName?: string | null;
  technicianName?: string | null;
  locale: UiLocale;
}) {
  const workOrderId = compactText(input.workOrderId);
  const workOrders = await listWorkOrders(input.user);

  if (workOrderId) {
    const direct = workOrders.find((item) => item.id === workOrderId);
    if (!direct) {
      throw buildAssistantToolError(
        translate(input.locale, {
          el: "Δεν βρήκα προσβάσιμο work order με αυτό το ID.",
          en: "I could not find an accessible work order with that ID.",
        }),
      );
    }
    return direct;
  }

  const technician = compactText(input.technicianName);
  const summary = compactText(input.workOrderSummary);
  const customerName = compactText(input.customerName);
  const locationName = compactText(input.locationName);

  let matches = workOrders.filter((workOrder) =>
    [summary, customerName, locationName, technician]
      .filter((value): value is string => Boolean(value))
      .every((query) =>
        matchesQuery(
          [
            workOrder.issueSummary,
            workOrder.customerName,
            workOrder.locationName,
            workOrder.primaryAssigneeName,
          ],
          query,
        ),
      ),
  );

  if (!summary && !customerName && !locationName && !technician) {
    const active = workOrders.filter((item) =>
      ["SCHEDULED", "IN_PROGRESS", "FOLLOW_UP_REQUIRED", "COMPLETED"].includes(item.state),
    );
    if (input.user.role === "technician" && active.length === 1) {
      return active[0];
    }
    matches = active;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw buildAssistantToolError(
      translate(input.locale, {
        el: `Βρήκα πολλά work orders: ${formatMatchList(matches.map((item) => item.issueSummary))}.`,
        en: `I found multiple work orders: ${formatMatchList(matches.map((item) => item.issueSummary))}.`,
      }),
    );
  }

  throw buildAssistantToolError(
    translate(input.locale, {
      el: "Δεν βρήκα σχετικό work order.",
      en: "I could not find a matching work order.",
    }),
  );
}

async function detectCriticalEvents(input: {
  user: SessionUser;
  locale: UiLocale;
  targetUserName?: string | null;
}) {
  const db = await getDatabaseClient();
  let targetUserId: string | null = null;
  let targetUserName: string | null = null;

  if (compactText(input.targetUserName)) {
    const users = await listUsers();
    const candidates = users.filter((candidate) =>
      matchesQuery([candidate.fullName, candidate.email, candidate.phoneNumber], input.targetUserName ?? ""),
    );

    if (candidates.length === 1) {
      targetUserId = candidates[0].id;
      targetUserName = candidates[0].fullName;
    } else if (candidates.length > 1) {
      throw buildAssistantToolError(
        translate(input.locale, {
          el: `Βρήκα πολλούς χρήστες: ${formatMatchList(candidates.map((item) => item.fullName))}.`,
          en: `I found multiple users: ${formatMatchList(candidates.map((item) => item.fullName))}.`,
        }),
      );
    } else {
      throw buildAssistantToolError(
        translate(input.locale, {
          el: "Δεν βρήκα αυτόν τον χρήστη.",
          en: "I could not find that user.",
        }),
      );
    }
  }

  const assigneeFilter =
    input.user.role === "technician"
      ? input.user.id
      : targetUserId;
  const now = new Date();
  const staleDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [overdueAppointments, followUps, staleCompleted, awaitingDetails] = await Promise.all([
    db.appointment.findMany({
      where: {
        startAt: { lt: now },
        state: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] },
        ...(assigneeFilter ? { assignedUserId: assigneeFilter } : {}),
      },
      include: {
        assignedUser: { select: { fullName: true } },
        request: {
          select: {
            customer: { select: { businessName: true } },
            location: { select: { name: true } },
          },
        },
        workOrder: {
          select: {
            customer: { select: { businessName: true } },
            location: { select: { name: true } },
          },
        },
      },
      orderBy: { startAt: "asc" },
      take: 8,
    }),
    db.workOrder.findMany({
      where: {
        state: WorkOrderState.FOLLOW_UP_REQUIRED,
        ...(assigneeFilter
          ? {
              assignments: {
                some: {
                  userId: assigneeFilter,
                  state: WorkOrderAssignmentState.ACTIVE,
                },
              },
            }
          : {}),
      },
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
        assignments: {
          where: { state: WorkOrderAssignmentState.ACTIVE },
          include: { user: { select: { fullName: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    db.workOrder.findMany({
      where: {
        state: WorkOrderState.COMPLETED,
        updatedAt: { lt: staleDate },
        invoiceReadyAt: null,
        ...(assigneeFilter
          ? {
              assignments: {
                some: {
                  userId: assigneeFilter,
                  state: WorkOrderAssignmentState.ACTIVE,
                },
              },
            }
          : {}),
      },
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: 8,
    }),
    db.request.findMany({
      where: {
        state: RequestState.AWAITING_DETAILS,
      },
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: 8,
    }),
  ]);

  return {
    targetUserName,
    overdueAppointments: overdueAppointments.map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      assignedUserName: appointment.assignedUser.fullName,
      customerName:
        appointment.request?.customer?.businessName ??
        appointment.workOrder?.customer?.businessName ??
        null,
      locationName:
        appointment.request?.location?.name ??
        appointment.workOrder?.location?.name ??
        null,
    })),
    followUps: followUps.map((workOrder) => ({
      id: workOrder.id,
      issueSummary: workOrder.issueSummary,
      customerName: workOrder.customer.businessName,
      locationName: workOrder.location.name,
      primaryAssigneeName:
        workOrder.assignments.find((assignment) => assignment.isPrimary)?.user.fullName ??
        workOrder.assignments[0]?.user.fullName ??
        null,
      followUpReason: workOrder.followUpReason,
    })),
    staleCompleted: staleCompleted.map((workOrder) => ({
      id: workOrder.id,
      issueSummary: workOrder.issueSummary,
      customerName: workOrder.customer.businessName,
      locationName: workOrder.location.name,
      updatedAt: workOrder.updatedAt.toISOString(),
    })),
    awaitingDetails: awaitingDetails.map((request) => ({
      id: request.id,
      description: request.description,
      customerName: request.customer?.businessName ?? null,
      locationName: request.location?.name ?? null,
      updatedAt: request.updatedAt.toISOString(),
    })),
  };
}

async function sendUserNotification(input: {
  userId: string;
  body: string;
  channelPreference?: "AUTO" | "WHATSAPP" | "IMESSAGE" | null;
}) {
  const { sendLinkedUserNotification } = await import("@/modules/personal-channels/service");
  return sendLinkedUserNotification({
    userId: input.userId,
    body: input.body,
    channelPreference: input.channelPreference ?? "AUTO",
  });
}

async function notifyAssignedTechnician(input: {
  assignedUserId: string | null | undefined;
  actor: SessionUser;
  body: string;
}) {
  if (!input.assignedUserId || input.assignedUserId === input.actor.id) {
    return [];
  }

  const db = await getDatabaseClient();
  const user = await db.user.findUnique({
    where: { id: input.assignedUserId },
    select: { id: true, fullName: true, isActive: true },
  });

  if (!user?.isActive) {
    return [];
  }

  const notification = await sendUserNotification({
    userId: user.id,
    body: input.body,
    channelPreference: "AUTO",
  });

  return [
    {
      userId: user.id,
      userName: user.fullName,
      channel: notification.channel,
      delivered: notification.delivered,
      reason: notification.reason ?? undefined,
    },
  ] satisfies AssistantToolResult["notifications"];
}

async function notifyOwnersAndAdmins(body: string) {
  const db = await getDatabaseClient();
  const recipients = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ["ADMIN", "OWNER"] },
    },
    select: {
      id: true,
      fullName: true,
    },
  });

  const results: NonNullable<AssistantToolResult["notifications"]> = [];
  for (const recipient of recipients) {
    const notification = await sendUserNotification({
      userId: recipient.id,
      body,
      channelPreference: "AUTO",
    });
    results.push({
      userId: recipient.id,
      userName: recipient.fullName,
      channel: notification.channel,
      delivered: notification.delivered,
      reason: notification.reason ?? undefined,
    });
  }

  return results;
}

async function searchCompanyData(input: {
  query?: string | null;
  scopes?: string[] | null;
  limit?: number | null;
  user: SessionUser;
}) {
  const db = await getDatabaseClient();
  const query = compactText(input.query);
  const scopes = new Set(input.scopes?.length ? input.scopes : [
    "customers",
    "requests",
    "appointments",
    "work_orders",
    "reminders",
    "technicians",
    "critical_events",
  ]);
  const limit = Math.max(1, Math.min(12, input.limit ?? 6));

  const [customers, locations, requests, appointments, workOrders, reminders, technicians] =
    await Promise.all([
      scopes.has("customers")
        ? db.customer.findMany({
            include: {
              locations: {
                orderBy: { name: "asc" },
                take: 3,
              },
            },
            orderBy: { businessName: "asc" },
            take: 100,
          })
        : [],
      scopes.has("locations")
        ? db.location.findMany({
            include: {
              customer: { select: { businessName: true } },
            },
            orderBy: { name: "asc" },
            take: 100,
          })
        : [],
      scopes.has("requests")
        ? db.request.findMany({
            include: {
              customer: { select: { businessName: true } },
              location: { select: { name: true } },
            },
            orderBy: { updatedAt: "desc" },
            take: 100,
          })
        : [],
      scopes.has("appointments")
        ? db.appointment.findMany({
            where: input.user.role === "technician" ? { assignedUserId: input.user.id } : undefined,
            include: {
              assignedUser: { select: { fullName: true } },
              request: {
                select: {
                  customer: { select: { businessName: true } },
                  location: { select: { name: true } },
                },
              },
              workOrder: {
                select: {
                  customer: { select: { businessName: true } },
                  location: { select: { name: true } },
                },
              },
            },
            orderBy: { startAt: "asc" },
            take: 100,
          })
        : [],
      scopes.has("work_orders")
        ? listWorkOrders(input.user)
        : [],
      scopes.has("reminders")
        ? db.invoiceReminder.findMany({
            include: {
              customer: { select: { businessName: true } },
            },
            orderBy: { updatedAt: "desc" },
            take: 100,
          })
        : [],
      scopes.has("technicians")
        ? (await listUsers()).filter((candidate) => candidate.role === "technician" && candidate.isActive)
        : [],
    ]);

  const filter = <T,>(items: T[], matcher: (item: T) => boolean) =>
    (query ? items.filter(matcher) : items).slice(0, limit);

  const criticalEvents = scopes.has("critical_events")
    ? await detectCriticalEvents({ user: input.user, locale: "en" })
    : null;

  return {
    customers: filter(customers, (customer) =>
      matchesQuery(
        [
          customer.businessName,
          customer.mainPhone,
          customer.mainEmail,
          ...customer.locations.flatMap((location) => [location.name, location.address, location.city]),
        ],
        query ?? "",
      ),
    ).map((customer) => ({
      id: customer.id,
      businessName: customer.businessName,
      mainPhone: customer.mainPhone,
      mainEmail: customer.mainEmail,
      locations: customer.locations.map((location) => ({
        id: location.id,
        name: location.name,
        address: location.address,
        city: location.city,
      })),
    })),
    locations: filter(locations, (location) =>
      matchesQuery(
        [location.name, location.address, location.city, location.customer.businessName],
        query ?? "",
      ),
    ).map((location) => ({
      id: location.id,
      name: location.name,
      address: location.address,
      city: location.city,
      customerName: location.customer.businessName,
    })),
    requests: filter(requests, (request) =>
      matchesQuery(
        [request.description, request.customer?.businessName, request.location?.name, request.reportedByName],
        query ?? "",
      ),
    ).map((request) => ({
      id: request.id,
      description: request.description,
      state: request.state,
      priority: request.priority,
      customerName: request.customer?.businessName ?? null,
      locationName: request.location?.name ?? null,
      updatedAt: request.updatedAt.toISOString(),
    })),
    appointments: filter(appointments, (appointment) =>
      matchesQuery(
        [
          appointment.assignedUser.fullName,
          appointment.request?.customer?.businessName,
          appointment.request?.location?.name,
          appointment.workOrder?.customer?.businessName,
          appointment.workOrder?.location?.name,
          appointment.reasonNote,
        ],
        query ?? "",
      ),
    ).map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt?.toISOString() ?? null,
      state: appointment.state,
      assignedUserName: appointment.assignedUser.fullName,
      customerName:
        appointment.request?.customer?.businessName ??
        appointment.workOrder?.customer?.businessName ??
        null,
      locationName:
        appointment.request?.location?.name ??
        appointment.workOrder?.location?.name ??
        null,
      reasonNote: appointment.reasonNote,
    })),
    workOrders: filter(workOrders, (workOrder) =>
      matchesQuery(
        [
          workOrder.issueSummary,
          workOrder.customerName,
          workOrder.locationName,
          workOrder.primaryAssigneeName,
        ],
        query ?? "",
      ),
    ).map((workOrder) => ({
      id: workOrder.id,
      issueSummary: workOrder.issueSummary,
      state: workOrder.state,
      customerName: workOrder.customerName,
      locationName: workOrder.locationName,
      primaryAssigneeName: workOrder.primaryAssigneeName,
      updatedAt: workOrder.updatedAt,
    })),
    reminders: filter(reminders, (reminder) =>
      matchesQuery([reminder.customer.businessName, reminder.note, reminder.monthKey], query ?? ""),
    ).map((reminder) => ({
      id: reminder.id,
      customerName: reminder.customer.businessName,
      monthKey: reminder.monthKey,
      state: reminder.state,
      estimatedTotal: reminder.estimatedTotal.toString(),
      note: reminder.note,
    })),
    technicians: filter(technicians, (technician) =>
      matchesQuery([technician.fullName, technician.email, technician.phoneNumber], query ?? ""),
    ).map((technician) => ({
      id: technician.id,
      fullName: technician.fullName,
      phoneNumber: technician.phoneNumber ?? null,
      email: technician.email,
    })),
    criticalEvents,
  };
}

async function executeToolInternal(input: {
  name: string;
  args: Record<string, unknown>;
  user: SessionUser;
  locale: UiLocale;
  channel: AssistantChannel;
}) {
  switch (input.name) {
    case "search_company_data": {
      const parsed = searchCompanyDataArgsSchema.parse(input.args);
      const data = await searchCompanyData({
        query: parsed.query,
        scopes: parsed.scopes,
        limit: parsed.limit,
        user: input.user,
      });

      return {
        ok: true,
        action: "searched_company_data",
        message: translate(input.locale, {
          el: "Ανάκτησα live δεδομένα από τη βάση.",
          en: "I fetched live data from the database.",
        }),
        data,
      } satisfies AssistantToolResult;
    }

    case "ensure_customer_profile": {
      const parsed = ensureCustomerProfileArgsSchema.parse(input.args);
      ensurePermission(input.user, "customers.write", input.locale);

      const customer = await resolveCustomer({
        customerName: parsed.customerName,
        customerPhone: parsed.phone,
        customerEmail: parsed.email,
        allowCreate: true,
        notes: parsed.notes,
        vatNumber: parsed.vatNumber,
        user: input.user,
        locale: input.locale,
      });

      const location = await resolveLocationForCustomer({
        customer,
        locationName: parsed.locationName,
        locationAddress: parsed.address,
        city: parsed.city,
        locationNotes: parsed.locationNotes,
        allowCreate: true,
        user: input.user,
        locale: input.locale,
      });

      return {
        ok: true,
        action: "ensured_customer_profile",
        message: translate(input.locale, {
          el: `Ο πελάτης ${customer?.businessName ?? parsed.customerName} είναι έτοιμος.`,
          en: `The customer ${customer?.businessName ?? parsed.customerName} is ready.`,
        }),
        entityType: DomainEntityType.CUSTOMER,
        entityId: customer?.id ?? null,
        data: {
          customer,
          location,
        },
      } satisfies AssistantToolResult;
    }

    case "capture_service_request": {
      const parsed = captureServiceRequestArgsSchema.parse(input.args);
      ensurePermission(input.user, "requests.write", input.locale);

      const canCreateCustomer = input.user.permissions.includes("customers.write");
      const customer = await resolveCustomer({
        customerName: parsed.customerName,
        customerPhone: parsed.customerPhone,
        customerEmail: parsed.customerEmail,
        allowCreate: canCreateCustomer,
        user: input.user,
        locale: input.locale,
      });

      const location = await resolveLocationForCustomer({
        customer,
        locationName: parsed.locationName,
        locationAddress: parsed.locationAddress,
        city: parsed.city,
        allowCreate: canCreateCustomer,
        user: input.user,
        locale: input.locale,
      });

      const request = normalizeResolvedRequest(
        await createRequest(
          {
            customerId: customer?.id ?? null,
            locationId: location?.id ?? null,
            sourceChannel:
              parsed.sourceChannel ??
              (input.channel === AssistantChannel.WHATSAPP
                ? RequestSourceChannel.WHATSAPP
                : RequestSourceChannel.APP),
            description: parsed.description,
            priority: parsed.priority ?? RequestPriority.TODAY,
            reportedByName: compactText(parsed.reportedByName) ?? input.user.fullName,
          },
          input.user,
        ),
      );

      return {
        ok: true,
        action: "captured_service_request",
        message: translate(input.locale, {
          el: `Καταχώρησα νέο request για ${request.customerName ?? "άγνωστο πελάτη"}.`,
          en: `I created a new request for ${request.customerName ?? "an unidentified customer"}.`,
        }),
        entityType: DomainEntityType.REQUEST,
        entityId: request.id,
        data: {
          request,
          customer,
          location,
        },
      } satisfies AssistantToolResult;
    }

    case "schedule_service_appointment": {
      const parsed = scheduleServiceAppointmentArgsSchema.parse(input.args);
      ensurePermission(input.user, "appointments.write", input.locale);
      await refreshExternalClockSnapshot();
      const normalizedStartAt = parseNaturalDateTime({
        value: parsed.startAt,
        locale: input.locale,
        label: "start",
      });
      const normalizedEndAt = compactText(parsed.endAt)
        ? parseNaturalDateTime({
            value: parsed.endAt ?? "",
            locale: input.locale,
            baseDate: new Date(normalizedStartAt),
            label: "end",
          })
        : null;

      if (
        normalizedEndAt &&
        new Date(normalizedEndAt).getTime() <= new Date(normalizedStartAt).getTime()
      ) {
        throw buildAssistantToolError(
          translate(input.locale, {
            el: "Η ώρα λήξης πρέπει να είναι μετά την ώρα έναρξης.",
            en: "The end time must be after the start time.",
          }),
        );
      }

      const technician = await resolveTechnician({
        technicianName: parsed.technicianName,
        user: input.user,
        locale: input.locale,
      });

      const canCreateCustomer = input.user.permissions.includes("customers.write");
      const customer = await resolveCustomer({
        customerName: parsed.customerName,
        customerPhone: parsed.customerPhone,
        customerEmail: parsed.customerEmail,
        allowCreate: canCreateCustomer,
        user: input.user,
        locale: input.locale,
      });

      const location = await resolveLocationForCustomer({
        customer,
        locationName: parsed.locationName,
        locationAddress: parsed.locationAddress,
        city: parsed.city,
        allowCreate: canCreateCustomer,
        user: input.user,
        locale: input.locale,
      });

      const workOrder =
        compactText(parsed.workOrderId) || compactText(parsed.workOrderSummary)
          ? await resolveAccessibleWorkOrder({
              user: input.user,
              workOrderId: parsed.workOrderId,
              workOrderSummary: parsed.workOrderSummary,
              customerName: parsed.customerName,
              locationName: parsed.locationName,
              technicianName: parsed.technicianName,
              locale: input.locale,
            })
          : null;

      let request =
        !workOrder &&
        (compactText(parsed.requestId) ||
          compactText(parsed.requestDescription) ||
          compactText(parsed.issueSummary) ||
          customer?.id ||
          location?.id)
          ? await resolveRequest({
              requestId: parsed.requestId,
              requestDescription: parsed.requestDescription ?? parsed.issueSummary,
              customerId: customer?.id ?? null,
              locationId: location?.id ?? null,
              locale: input.locale,
            })
          : null;

      if (!workOrder && !request) {
        if (!compactText(parsed.issueSummary) && !compactText(parsed.requestDescription)) {
          throw buildAssistantToolError(
            translate(input.locale, {
              el: "Για να κλείσω ραντεβού χωρίς υπάρχον request ή work order, χρειάζομαι σύντομη περιγραφή του θέματος.",
              en: "To schedule without an existing request or work order, I need a short issue description.",
            }),
          );
        }

        ensurePermission(input.user, "requests.write", input.locale);
        request = normalizeResolvedRequest(
          await createRequest(
            {
              customerId: customer?.id ?? null,
              locationId: location?.id ?? null,
              sourceChannel:
                input.channel === AssistantChannel.WHATSAPP
                  ? RequestSourceChannel.WHATSAPP
                  : RequestSourceChannel.APP,
              description:
                compactText(parsed.requestDescription) ?? compactText(parsed.issueSummary) ?? "",
              priority: parsed.priority ?? RequestPriority.TODAY,
              reportedByName: compactText(parsed.reportedByName) ?? input.user.fullName,
            },
            input.user,
          ),
        );
      }

      const appointment = await createAppointment(
        {
          requestId: request?.id ?? null,
          workOrderId: workOrder?.id ?? null,
          assignedUserId: technician.id,
          startAt: normalizedStartAt,
          endAt: normalizedEndAt,
          reasonNote: compactText(parsed.reasonNote) ?? compactText(parsed.issueSummary),
        },
        input.user,
      );

      const notifications = await notifyAssignedTechnician({
        assignedUserId: technician.id,
        actor: input.user,
        body: translate(input.locale, {
          el: `Νέο ραντεβού: ${appointment.startAt} για ${request?.customerName ?? workOrder?.customerName ?? customer?.businessName ?? "πελάτη"}.`,
          en: `New appointment: ${appointment.startAt} for ${request?.customerName ?? workOrder?.customerName ?? customer?.businessName ?? "a customer"}.`,
        }),
      });

      return {
        ok: true,
        action: "scheduled_service_appointment",
        message: translate(input.locale, {
          el: `Καταχώρησα ραντεβού για ${request?.customerName ?? workOrder?.customerName ?? customer?.businessName ?? "τον πελάτη"} στις ${new Date(appointment.startAt).toLocaleString("el-GR")} με τεχνικό ${technician.fullName}.`,
          en: `I scheduled an appointment for ${request?.customerName ?? workOrder?.customerName ?? customer?.businessName ?? "the customer"} at ${new Date(appointment.startAt).toLocaleString("en-US")} with technician ${technician.fullName}.`,
        }),
        entityType: DomainEntityType.APPOINTMENT,
        entityId: appointment.id,
        data: {
          appointment,
          request,
          workOrder,
          customer,
          location,
          technician: {
            id: technician.id,
            fullName: technician.fullName,
          },
        },
        notifications,
      } satisfies AssistantToolResult;
    }

    case "open_work_order": {
      const parsed = openWorkOrderArgsSchema.parse(input.args);
      ensurePermission(input.user, "work_orders.write", input.locale);

      const canCreateCustomer = input.user.permissions.includes("customers.write");
      const customer = await resolveCustomer({
        customerName: parsed.customerName,
        customerPhone: parsed.customerPhone,
        customerEmail: parsed.customerEmail,
        allowCreate: canCreateCustomer,
        user: input.user,
        locale: input.locale,
      });

      const location = await resolveLocationForCustomer({
        customer,
        locationName: parsed.locationName,
        locationAddress: parsed.locationAddress,
        city: parsed.city,
        allowCreate: canCreateCustomer,
        user: input.user,
        locale: input.locale,
      });

      if (!customer || !location) {
        throw buildAssistantToolError(
          translate(input.locale, {
            el: "Για νέο work order χρειάζομαι πελάτη και συγκεκριμένη τοποθεσία.",
            en: "To create a new work order I need both a customer and a specific location.",
          }),
        );
      }

      let request = await resolveRequest({
        requestId: parsed.requestId,
        requestDescription: parsed.requestDescription,
        customerId: customer.id,
        locationId: location.id,
        locale: input.locale,
      });

      if (!request && compactText(parsed.requestDescription)) {
        ensurePermission(input.user, "requests.write", input.locale);
        request = normalizeResolvedRequest(
          await createRequest(
            {
              customerId: customer.id,
              locationId: location.id,
              sourceChannel:
                input.channel === AssistantChannel.WHATSAPP
                  ? RequestSourceChannel.WHATSAPP
                  : RequestSourceChannel.APP,
              description: parsed.requestDescription ?? parsed.issueSummary,
              priority: RequestPriority.TODAY,
              reportedByName: input.user.fullName,
            },
            input.user,
          ),
        );
      }

      const technician = compactText(parsed.technicianName)
        ? await resolveTechnician({
            technicianName: parsed.technicianName,
            user: input.user,
            locale: input.locale,
          })
        : null;

      const workOrder = await createWorkOrder(
        {
          requestId: request?.id ?? null,
          customerId: customer.id,
          locationId: location.id,
          issueSummary: parsed.issueSummary,
          assignedUserId: technician?.id ?? null,
        },
        input.user,
      );

      const notifications = technician
        ? await notifyAssignedTechnician({
            assignedUserId: technician.id,
            actor: input.user,
            body: translate(input.locale, {
              el: `Σου ανατέθηκε νέο work order για ${customer.businessName} (${location.name}).`,
              en: `A new work order has been assigned to you for ${customer.businessName} (${location.name}).`,
            }),
          })
        : [];

      return {
        ok: true,
        action: "opened_work_order",
        message: translate(input.locale, {
          el: `Άνοιξα νέο work order για ${customer.businessName}.`,
          en: `I opened a new work order for ${customer.businessName}.`,
        }),
        entityType: DomainEntityType.WORK_ORDER,
        entityId: workOrder.id,
        data: {
          workOrder,
          request,
          customer,
          location,
          technician,
        },
        notifications,
      } satisfies AssistantToolResult;
    }

    case "update_work_order": {
      const parsed = updateWorkOrderArgsSchema.parse(input.args);
      const workOrder = await resolveAccessibleWorkOrder({
        user: input.user,
        workOrderId: parsed.workOrderId,
        workOrderSummary: parsed.workOrderSummary,
        customerName: parsed.customerName,
        locationName: parsed.locationName,
        technicianName: parsed.technicianName,
        locale: input.locale,
      });

      let updated: unknown;
      let notifications: AssistantToolResult["notifications"] = [];

      if (parsed.action === "start") {
        updated = await startWorkOrder(workOrder.id, input.user);
      } else if (parsed.action === "complete") {
        if (!compactText(parsed.resolutionSummary)) {
          throw buildAssistantToolError(
            translate(input.locale, {
              el: "Για ολοκλήρωση χρειάζομαι σύντομη σύνοψη επίλυσης.",
              en: "To complete the work order I need a short resolution summary.",
            }),
          );
        }
        updated = await completeWorkOrder(
          workOrder.id,
          { resolutionSummary: parsed.resolutionSummary ?? "" },
          input.user,
        );
      } else if (parsed.action === "follow_up") {
        if (!compactText(parsed.followUpReason)) {
          throw buildAssistantToolError(
            translate(input.locale, {
              el: "Για follow-up χρειάζομαι τον λόγο.",
              en: "For follow-up I need the reason.",
            }),
          );
        }
        updated = await markWorkOrderFollowUpRequired(
          workOrder.id,
          {
            followUpReason: parsed.followUpReason ?? "",
            resolutionSummary: compactText(parsed.resolutionSummary),
          },
          input.user,
        );
        notifications = await notifyOwnersAndAdmins(
          translate(input.locale, {
            el: `Critical: το work order "${workOrder.issueSummary}" πέρασε σε follow-up required.`,
            en: `Critical: work order "${workOrder.issueSummary}" moved to follow-up required.`,
          }),
        );
      } else if (parsed.action === "ready_for_invoice") {
        updated = await markWorkOrderReadyForInvoice(workOrder.id, input.user);
      } else if (parsed.action === "reassign") {
        ensurePermission(input.user, "work_orders.assign", input.locale);
        const technician = await resolveTechnician({
          technicianName: parsed.technicianName,
          user: input.user,
          locale: input.locale,
        });
        updated = await updateWorkOrder(
          workOrder.id,
          {
            assignedUserId: technician.id,
          },
          input.user,
        );
        notifications = await notifyAssignedTechnician({
          assignedUserId: technician.id,
          actor: input.user,
          body: translate(input.locale, {
            el: `Σου ανατέθηκε το work order "${workOrder.issueSummary}".`,
            en: `You have been assigned the work order "${workOrder.issueSummary}".`,
          }),
        });
      }

      return {
        ok: true,
        action: "updated_work_order",
        message: translate(input.locale, {
          el: "Το work order ενημερώθηκε.",
          en: "The work order was updated.",
        }),
        entityType: DomainEntityType.WORK_ORDER,
        entityId: workOrder.id,
        data: {
          workOrder: updated,
        },
        notifications,
      } satisfies AssistantToolResult;
    }

    case "log_work_time": {
      const parsed = logWorkTimeArgsSchema.parse(input.args);
      ensurePermission(input.user, "time_entries.write_own", input.locale);

      const workOrder = await resolveAccessibleWorkOrder({
        user: input.user,
        workOrderId: parsed.workOrderId,
        workOrderSummary: parsed.workOrderSummary,
        customerName: parsed.customerName,
        locationName: parsed.locationName,
        locale: input.locale,
      });

      const timeEntry = await createTimeEntry(
        workOrder.id,
        {
          minutesWorked: parsed.minutesWorked,
          minutesTravel: parsed.minutesTravel ?? 0,
          note: compactText(parsed.note),
        },
        input.user,
      );

      return {
        ok: true,
        action: "logged_work_time",
        message: translate(input.locale, {
          el: "Καταχώρησα τον χρόνο στο work order.",
          en: "I logged the time on the work order.",
        }),
        entityType: DomainEntityType.WORK_ORDER,
        entityId: workOrder.id,
        data: {
          workOrder,
          timeEntry,
        },
      } satisfies AssistantToolResult;
    }

    case "log_material_usage": {
      const parsed = logMaterialUsageArgsSchema.parse(input.args);
      ensurePermission(input.user, "materials.write_own", input.locale);

      const workOrder = await resolveAccessibleWorkOrder({
        user: input.user,
        workOrderId: parsed.workOrderId,
        workOrderSummary: parsed.workOrderSummary,
        customerName: parsed.customerName,
        locationName: parsed.locationName,
        locale: input.locale,
      });

      const material = await createMaterialUsage(
        workOrder.id,
        {
          description: parsed.description,
          quantity: parsed.quantity,
          unit: parsed.unit,
          estimatedCost: parsed.estimatedCost ?? null,
        },
        input.user,
      );

      return {
        ok: true,
        action: "logged_material_usage",
        message: translate(input.locale, {
          el: "Καταχώρησα το υλικό στο work order.",
          en: "I logged the material on the work order.",
        }),
        entityType: DomainEntityType.WORK_ORDER,
        entityId: workOrder.id,
        data: {
          workOrder,
          material,
        },
      } satisfies AssistantToolResult;
    }

    case "manage_invoice_reminder": {
      const parsed = manageInvoiceReminderArgsSchema.parse(input.args);
      ensurePermission(input.user, "reminders.manage", input.locale);

      const customer = await resolveCustomer({
        customerName: parsed.customerName,
        customerPhone: parsed.customerPhone,
        allowCreate: false,
        user: input.user,
        locale: input.locale,
      });

      if (!customer) {
        throw buildAssistantToolError(
          translate(input.locale, {
            el: "Χρειάζομαι πελάτη για το reminder τιμολόγησης.",
            en: "I need a customer for the invoice reminder.",
          }),
        );
      }

      const candidateWorkOrders = (await listWorkOrders(input.user)).filter(
        (workOrder) =>
          workOrder.customerId === customer.id &&
          (workOrder.state === "COMPLETED" || workOrder.state === "READY_FOR_INVOICE"),
      );

      const explicitIds = new Set(parsed.workOrderIds ?? []);
      const summaryMatches = candidateWorkOrders.filter((workOrder) =>
        (parsed.workOrderSummaries ?? []).some((summary) =>
          matchesQuery([workOrder.issueSummary, workOrder.locationName], summary),
        ),
      );

      const selectedWorkOrders = candidateWorkOrders.filter(
        (workOrder) => explicitIds.has(workOrder.id) || summaryMatches.some((item) => item.id === workOrder.id),
      );

      const finalWorkOrders =
        selectedWorkOrders.length > 0
          ? selectedWorkOrders
          : candidateWorkOrders.slice(0, 12);

      if (finalWorkOrders.length === 0) {
        throw buildAssistantToolError(
          translate(input.locale, {
            el: "Δεν βρήκα ολοκληρωμένα ή invoice-ready work orders για αυτόν τον πελάτη.",
            en: "I could not find completed or invoice-ready work orders for this customer.",
          }),
        );
      }

      const reminder = await createInvoiceReminder(
        {
          customerId: customer.id,
          workOrderIds: finalWorkOrders.map((workOrder) => workOrder.id),
          estimatedTotal: parsed.estimatedTotal,
          monthKey: parsed.monthKey ?? undefined,
          note: compactText(parsed.note),
        },
        input.user,
      );

      let queuedReminder: unknown = null;
      if (parsed.queueNow) {
        queuedReminder = await queueInvoiceReminder(reminder.id, input.user);
      }

      return {
        ok: true,
        action: "managed_invoice_reminder",
        message: translate(input.locale, {
          el: parsed.queueNow
            ? "Το reminder δημιουργήθηκε και μπήκε σε queue."
            : "Το reminder τιμολόγησης δημιουργήθηκε ή ενημερώθηκε.",
          en: parsed.queueNow
            ? "The reminder was created and queued."
            : "The invoice reminder was created or updated.",
        }),
        entityType: DomainEntityType.REMINDER,
        entityId: reminder.id,
        data: {
          reminder,
          queuedReminder,
          workOrders: finalWorkOrders,
        },
      } satisfies AssistantToolResult;
    }

    case "review_critical_events": {
      const parsed = reviewCriticalEventsArgsSchema.parse(input.args);
      const criticalEvents = await detectCriticalEvents({
        user: input.user,
        locale: input.locale,
        targetUserName: parsed.targetUserName,
      });

      return {
        ok: true,
        action: "reviewed_critical_events",
        message: translate(input.locale, {
          el: "Έκανα έλεγχο για κρίσιμα γεγονότα.",
          en: "I reviewed the critical events.",
        }),
        data: criticalEvents,
      } satisfies AssistantToolResult;
    }

    case "notify_staff_member": {
      const parsed = notifyStaffMemberArgsSchema.parse(input.args);
      const users = await listUsers();
      const candidates = users.filter((candidate) =>
        matchesQuery([candidate.fullName, candidate.email, candidate.phoneNumber], parsed.userName),
      );

      if (candidates.length !== 1) {
        throw buildAssistantToolError(
          candidates.length > 1
            ? translate(input.locale, {
                el: `Βρήκα πολλούς χρήστες: ${formatMatchList(candidates.map((item) => item.fullName))}.`,
                en: `I found multiple users: ${formatMatchList(candidates.map((item) => item.fullName))}.`,
              })
            : translate(input.locale, {
                el: "Δεν βρήκα αυτόν τον χρήστη.",
                en: "I could not find that user.",
              }),
        );
      }

      const target = candidates[0];
      const notification = await sendUserNotification({
        userId: target.id,
        body: parsed.body,
        channelPreference: parsed.channelPreference ?? "AUTO",
      });

      return {
        ok: true,
        action: "notified_staff_member",
        message: translate(input.locale, {
          el: notification.delivered
            ? `Έστειλα ενημέρωση στον ${target.fullName}.`
            : `Δεν βρήκα συνδεδεμένο προσωπικό κανάλι για τον ${target.fullName}.`,
          en: notification.delivered
            ? `I sent the update to ${target.fullName}.`
            : `I could not find a connected personal channel for ${target.fullName}.`,
        }),
        notifications: [
          {
            userId: target.id,
            userName: target.fullName,
            channel: notification.channel,
            delivered: notification.delivered,
            reason: notification.reason ?? undefined,
          },
        ],
        data: {
          targetUserId: target.id,
          targetUserName: target.fullName,
        },
      } satisfies AssistantToolResult;
    }

    default:
      throw new BusinessRuleError(
        "ASSISTANT_TOOL_UNSUPPORTED",
        translate(input.locale, {
          el: "Η assistant tool δεν υποστηρίζεται.",
          en: "This assistant tool is not supported.",
        }),
        422,
      );
  }
}

export function buildAssistantInstructions(input: AssistantRuntimeInput) {
  const clock = getCompanyClockSnapshot();
  const nowText = new Date(clock.nowIso).toLocaleString(
    input.locale === "el" ? "el-GR" : "en-US",
    {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: clock.timeZone,
    },
  );

  const highLevelRules = translate(input.locale, {
    el: [
      "Είσαι ο operational AI assistant του Company Assistant.",
      "Σκοπός σου είναι να βοηθάς owner, admin, operator και technician με φυσική γλώσσα πάνω στα πραγματικά δεδομένα της βάσης.",
      "Πρέπει να λειτουργείς σαν πραγματικός βοηθός: να λύνεις ονόματα, πελάτες, τοποθεσίες, requests, work orders και τεχνικούς χωρίς να ζητάς εσωτερικά IDs.",
      "Αν λείπουν στοιχεία, κάνε μία σύντομη και πρακτική διευκρινιστική ερώτηση.",
      "Αν υπάρχει αρκετή πληροφορία, χρησιμοποίησε tools και εκτέλεσε την ενέργεια.",
      "Μπορείς να δημιουργήσεις πελάτη, τοποθεσία, request, ραντεβού, work order, καταχώρηση χρόνου, υλικού και reminder χωρίς να ζητήσεις IDs.",
      "Για ραντεβού μπορείς να περάσεις ώρα είτε ως ISO είτε ως φυσική φράση όπως «αύριο στις 10», «μεθαύριο 9:30», «Δευτέρα 17:00» ή «next Monday at 5pm».",
      "Πριν απαντήσεις για live δεδομένα ή για εκτέλεση ενέργειας, προτίμησε tools αντί να μαντεύεις από το snapshot.",
      "Μη λες ποτέ ότι κάτι έγινε αν tool δεν επέστρεψε ok=true.",
      "Όταν tool επιστρέφει ok=false ή ambiguity, εξήγησε τι λείπει με μία σύντομη ερώτηση.",
      "Μετά από κάθε επιτυχημένη ενέργεια, στείλε σύντομη επιβεβαίωση για το τι καταχωρήθηκε ή ενημερώθηκε και αν απομένει κάτι να συμπληρωθεί.",
      "Να απαντάς στη γλώσσα του χρήστη. Σε WhatsApp και iMessage κράτα τις απαντήσεις σύντομες και πρακτικές.",
      "Όταν υπάρχει πραγματικό κρίσιμο γεγονός, μπορείς να ενημερώσεις τον κατάλληλο εσωτερικό χρήστη με notify_staff_member.",
    ].join("\n"),
    en: [
      "You are the operational AI assistant for Company Assistant.",
      "Your job is to help the owner, admin, operator, and technician using natural language on top of the live company database.",
      "Behave like a real assistant: resolve customer names, locations, requests, work orders, and technicians without asking for internal IDs.",
      "If essential information is missing, ask one short practical follow-up question.",
      "If there is enough information, use tools and complete the action.",
      "You may create customers, locations, requests, appointments, work orders, time entries, material usage, and invoice reminders without asking for IDs.",
      "For appointments you may pass time either as ISO or as natural phrases such as “tomorrow at 10”, “day after tomorrow 9:30”, “Monday 17:00”, or “next Monday at 5pm”.",
      "Before answering about live data or executing actions, prefer tools instead of guessing from the snapshot.",
      "Never claim an action succeeded unless the tool returned ok=true.",
      "If a tool returns ambiguity or missing-data feedback, explain it briefly and ask the user for the smallest missing detail.",
      "After each successful action, send a short confirmation of what was created or updated and mention any follow-up detail still needed.",
      "Reply in the user's language. For WhatsApp and iMessage keep replies short and practical.",
      "If there is a real critical event, you may notify the appropriate internal user with notify_staff_member.",
    ].join("\n"),
  });

  return [
    highLevelRules,
    `Current datetime: ${nowText} (${clock.timeZone}, ${clock.offset}, source=${clock.source}).`,
    `Current channel: ${input.channel}.`,
    `Current user role: ${input.user.role}.`,
    `Current user permissions: ${input.user.permissions.join(", ")}.`,
    input.allowMutations
      ? translate(input.locale, {
          el: "Ο χρήστης μπορεί να ζητήσει operational actions.",
          en: "The user may request operational actions.",
        })
      : translate(input.locale, {
          el: "Ο χρήστης είναι σε read-only assistant mode.",
          en: "The user is in read-only assistant mode.",
        }),
    `Structured snapshot JSON: ${JSON.stringify(input.context)}`,
    `Recent conversation transcript:\n${input.conversationTranscript || "(empty)"}`,
  ].join("\n\n");
}

export function getAssistantToolDefinitions(locale: UiLocale, allowMutations: boolean): AssistantToolDefinition[] {
  const readTools: AssistantToolDefinition[] = [
    {
      type: "function",
      name: "search_company_data",
      description: translate(locale, {
        el: "Κάνε live αναζήτηση σε πελάτες, τοποθεσίες, requests, ραντεβού, work orders, reminders, τεχνικούς ή κρίσιμα γεγονότα.",
        en: "Search live company data across customers, locations, requests, appointments, work orders, reminders, technicians, or critical events.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          scopes: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "customers",
                "locations",
                "requests",
                "appointments",
                "work_orders",
                "reminders",
                "technicians",
                "critical_events",
              ],
            },
          },
          limit: { type: "number" },
        },
      },
    },
    {
      type: "function",
      name: "review_critical_events",
      description: translate(locale, {
        el: "Έλεγξε για κρίσιμα operational γεγονότα, όπως overdue appointments, follow-up work orders και requests που θέλουν στοιχεία.",
        en: "Review critical operational events such as overdue appointments, follow-up work orders, and requests that still need details.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          targetUserName: { type: "string" },
        },
      },
    },
  ];

  if (!allowMutations) {
    return readTools;
  }

  return [
    ...readTools,
    {
      type: "function",
      name: "ensure_customer_profile",
      description: translate(locale, {
        el: "Βρες ή δημιούργησε πελάτη και, αν χρειάζεται, τοποθεσία, χωρίς να ζητήσεις IDs.",
        en: "Find or create a customer and, if needed, a location without asking for IDs.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          vatNumber: { type: "string" },
          notes: { type: "string" },
          locationName: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          locationNotes: { type: "string" },
        },
        required: ["customerName"],
      },
    },
    {
      type: "function",
      name: "capture_service_request",
      description: translate(locale, {
        el: "Καταχώρησε νέο service request με φυσικά στοιχεία πελάτη και τοποθεσίας.",
        en: "Create a new service request using natural customer and location details.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string" },
          customerPhone: { type: "string" },
          customerEmail: { type: "string" },
          locationName: { type: "string" },
          locationAddress: { type: "string" },
          city: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["URGENT", "TODAY", "PLANNED"] },
          reportedByName: { type: "string" },
          sourceChannel: { type: "string", enum: ["PHONE", "WHATSAPP", "APP", "MANUAL"] },
        },
        required: ["description"],
      },
    },
    {
      type: "function",
      name: "schedule_service_appointment",
      description: translate(locale, {
        el: "Κλείσε ραντεβού για request ή work order, ή δημιούργησε request αν χρειάζεται.",
        en: "Schedule an appointment for a request or work order, or create a request if needed.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string" },
          customerPhone: { type: "string" },
          customerEmail: { type: "string" },
          locationName: { type: "string" },
          locationAddress: { type: "string" },
          city: { type: "string" },
          requestId: { type: "string" },
          requestDescription: { type: "string" },
          workOrderId: { type: "string" },
          workOrderSummary: { type: "string" },
          issueSummary: { type: "string" },
          technicianName: { type: "string" },
          startAt: { type: "string" },
          endAt: { type: "string" },
          reasonNote: { type: "string" },
          priority: { type: "string", enum: ["URGENT", "TODAY", "PLANNED"] },
          reportedByName: { type: "string" },
        },
        required: ["startAt"],
      },
    },
    {
      type: "function",
      name: "open_work_order",
      description: translate(locale, {
        el: "Δημιούργησε νέο work order και προαιρετικά ανάθεσέ το σε τεχνικό.",
        en: "Create a new work order and optionally assign it to a technician.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string" },
          customerPhone: { type: "string" },
          customerEmail: { type: "string" },
          locationName: { type: "string" },
          locationAddress: { type: "string" },
          city: { type: "string" },
          requestId: { type: "string" },
          requestDescription: { type: "string" },
          issueSummary: { type: "string" },
          technicianName: { type: "string" },
        },
        required: ["issueSummary"],
      },
    },
    {
      type: "function",
      name: "update_work_order",
      description: translate(locale, {
        el: "Ξεκίνησε, ολοκλήρωσε, πέρασε σε follow-up, πέρασε σε ready for invoice ή κάνε reassign ένα work order.",
        en: "Start, complete, mark follow-up, mark ready for invoice, or reassign a work order.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workOrderId: { type: "string" },
          workOrderSummary: { type: "string" },
          customerName: { type: "string" },
          locationName: { type: "string" },
          technicianName: { type: "string" },
          action: {
            type: "string",
            enum: ["start", "complete", "follow_up", "ready_for_invoice", "reassign"],
          },
          resolutionSummary: { type: "string" },
          followUpReason: { type: "string" },
        },
        required: ["action"],
      },
    },
    {
      type: "function",
      name: "log_work_time",
      description: translate(locale, {
        el: "Καταχώρησε χρόνο εργασίας σε work order χωρίς να ζητήσεις ID αν μπορείς να το λύσεις από φυσική περιγραφή.",
        en: "Log work time on a work order without asking for the ID when it can be resolved from natural language.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workOrderId: { type: "string" },
          workOrderSummary: { type: "string" },
          customerName: { type: "string" },
          locationName: { type: "string" },
          minutesWorked: { type: "number" },
          minutesTravel: { type: "number" },
          note: { type: "string" },
        },
        required: ["minutesWorked"],
      },
    },
    {
      type: "function",
      name: "log_material_usage",
      description: translate(locale, {
        el: "Καταχώρησε υλικό σε work order με φυσική περιγραφή.",
        en: "Log material usage on a work order using natural details.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workOrderId: { type: "string" },
          workOrderSummary: { type: "string" },
          customerName: { type: "string" },
          locationName: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          estimatedCost: { type: "number" },
        },
        required: ["description", "quantity", "unit"],
      },
    },
    {
      type: "function",
      name: "manage_invoice_reminder",
      description: translate(locale, {
        el: "Δημιούργησε ή ενημέρωσε reminder τιμολόγησης και προαιρετικά βάλ' το σε queue.",
        en: "Create or update an invoice reminder and optionally queue it.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          customerName: { type: "string" },
          customerPhone: { type: "string" },
          workOrderIds: { type: "array", items: { type: "string" } },
          workOrderSummaries: { type: "array", items: { type: "string" } },
          estimatedTotal: { type: "number" },
          monthKey: { type: "string" },
          note: { type: "string" },
          queueNow: { type: "boolean" },
        },
        required: ["estimatedTotal"],
      },
    },
    {
      type: "function",
      name: "notify_staff_member",
      description: translate(locale, {
        el: "Στείλε εσωτερική ειδοποίηση σε συνδεδεμένο μέλος της εταιρίας μέσω WhatsApp ή iMessage.",
        en: "Send an internal notification to a connected staff member through WhatsApp or iMessage.",
      }),
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          userName: { type: "string" },
          body: { type: "string" },
          channelPreference: { type: "string", enum: ["AUTO", "WHATSAPP", "IMESSAGE"] },
        },
        required: ["userName", "body"],
      },
    },
  ];
}

export async function executeAssistantTool(input: {
  name: string;
  args: Record<string, unknown>;
  user: SessionUser;
  locale: UiLocale;
  channel: AssistantChannel;
}) {
  try {
    return await executeToolInternal(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        message: translate(input.locale, {
          el: "Λείπουν ή δεν είναι έγκυρα κάποια στοιχεία για την ενέργεια.",
          en: "Some required action details are missing or invalid.",
        }),
        data: {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      } satisfies AssistantToolResult;
    }

    return {
      ok: false,
      message:
        error instanceof BusinessRuleError || error instanceof Error
          ? error.message
          : translate(input.locale, {
              el: "Η ενέργεια απέτυχε.",
              en: "The action failed.",
            }),
    } satisfies AssistantToolResult;
  }
}
