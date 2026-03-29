import {
  AppointmentState,
  HeartbeatCadenceUnit,
  HeartbeatRunStatus,
  MessagingChannel,
  UserRole,
  WorkOrderAssignmentState,
} from "@prisma/client";
import { z } from "zod";
import { sendLinkedUserNotification } from "@/modules/personal-channels/service";
import { getSessionUserById } from "@/modules/users/service";
import { getDatabaseClient } from "@/shared/db/readiness";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  getCanonicalNow,
  getCompanyClockSnapshot,
  getCompanyTimeZone,
  refreshExternalClockSnapshot,
} from "@/shared/time/company-clock";

const heartbeatScope = "global";
const relevantHeartbeatEvents = [
  "appointment.created",
  "appointment.updated",
  "work_order.created",
  "work_order.updated",
  "work_order.started",
  "work_order.completed",
  "work_order.follow_up_required",
  "work_order.ready_for_invoice",
  "invoice_reminder.created",
  "invoice_reminder.updated",
] as const;

const updateHeartbeatSettingsSchema = z.object({
  enabled: z.boolean(),
  cadenceValue: z.coerce.number().int().min(1).max(365),
  cadenceUnit: z.nativeEnum(HeartbeatCadenceUnit),
});

type HeartbeatSettingsInput = z.infer<typeof updateHeartbeatSettingsSchema>;

type HeartbeatSettingsRecord = {
  enabled: boolean;
  cadenceValue: number;
  cadenceUnit: HeartbeatCadenceUnit;
  cadenceMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastCursorAt: string | null;
  lastDeliveryAt: string | null;
  lastRunStatus: HeartbeatRunStatus;
  lastRunSummary: string | null;
  lastError: string | null;
  clock: ReturnType<typeof getCompanyClockSnapshot>;
  recentNotifications: Array<{
    id: string;
    recipientUserName: string;
    channel: MessagingChannel | null;
    delivered: boolean;
    payload: string;
    reason: string | null;
    attemptCount: number;
    createdAt: string;
    deliveredAt: string | null;
  }>;
};

type HeartbeatNotificationDraft = {
  dedupeKey: string;
  recipientUserId: string;
  payload: string;
  auditLogId?: string | null;
  channelPreference?: "AUTO" | "WHATSAPP" | "IMESSAGE";
};

type HeartbeatRunResult = {
  ok: boolean;
  trigger: "auto" | "manual";
  checkedAt: string;
  scannedEvents: number;
  notificationAttempts: number;
  deliveredCount: number;
  summary: string;
  clock: ReturnType<typeof getCompanyClockSnapshot>;
  notifications: Array<{
    recipientUserId: string;
    recipientUserName: string;
    delivered: boolean;
    channel: MessagingChannel | "NONE";
    reason?: string;
    payload: string;
  }>;
};

type HeartbeatConfigRow = Awaited<ReturnType<typeof getOrCreateHeartbeatConfig>>;

function cadenceToMinutes(value: number, unit: HeartbeatCadenceUnit) {
  switch (unit) {
    case HeartbeatCadenceUnit.MINUTES:
      return value;
    case HeartbeatCadenceUnit.HOURS:
      return value * 60;
    case HeartbeatCadenceUnit.DAYS:
      return value * 24 * 60;
    default:
      return value;
  }
}

function formatHeartbeatCadence(value: number, unit: HeartbeatCadenceUnit) {
  const label =
    unit === HeartbeatCadenceUnit.MINUTES
      ? value === 1
        ? "minute"
        : "minutes"
      : unit === HeartbeatCadenceUnit.HOURS
        ? value === 1
          ? "hour"
          : "hours"
        : value === 1
          ? "day"
          : "days";

  return `${value} ${label}`;
}

function formatCompanyDateTime(value: Date) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: getCompanyTimeZone(),
  }).format(value);
}

function getNextRunAt(config: {
  enabled: boolean;
  lastRunAt: Date | null;
  updatedAt: Date;
  cadenceMinutes: number;
}) {
  if (!config.enabled) {
    return null;
  }

  const base = config.lastRunAt ?? config.updatedAt;
  return new Date(base.getTime() + config.cadenceMinutes * 60 * 1000);
}

function getStringField(value: unknown, field: string) {
  if (typeof value !== "object" || value === null || !(field in value)) {
    return null;
  }

  const nextValue = (value as Record<string, unknown>)[field];
  return typeof nextValue === "string" && nextValue.trim().length > 0 ? nextValue : null;
}

function buildRunSummary(input: {
  scannedEvents: number;
  notificationAttempts: number;
  deliveredCount: number;
  manualVerificationAttempts?: number;
}) {
  const deliverySuffix =
    input.notificationAttempts > 0
      ? ` Attempted ${input.notificationAttempts} notification(s), delivered ${input.deliveredCount}.`
      : "";
  const verificationSuffix =
    input.manualVerificationAttempts && input.manualVerificationAttempts > 0
      ? ` Manual channel verification attempted on ${input.manualVerificationAttempts} channel(s).`
      : "";

  if (input.scannedEvents === 0) {
    return `No new heartbeat events were found.${deliverySuffix}${verificationSuffix}`;
  }

  return `Scanned ${input.scannedEvents} changes, attempted ${input.notificationAttempts} notifications, delivered ${input.deliveredCount}.${verificationSuffix}`;
}

async function getOrCreateHeartbeatConfig() {
  const db = await getDatabaseClient();

  return db.heartbeatConfig.upsert({
    where: { scope: heartbeatScope },
    update: {},
    create: {
      scope: heartbeatScope,
      enabled: false,
      cadenceValue: 30,
      cadenceUnit: HeartbeatCadenceUnit.MINUTES,
      cadenceMinutes: 30,
      lastRunStatus: HeartbeatRunStatus.IDLE,
    },
  });
}

async function listLeadershipUsers() {
  const db = await getDatabaseClient();

  return db.user.findMany({
    where: {
      isActive: true,
      role: {
        in: [UserRole.ADMIN, UserRole.OWNER],
      },
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
    select: {
      id: true,
      fullName: true,
      role: true,
    },
  });
}

async function getRecentHeartbeatNotifications(limit = 8) {
  const db = await getDatabaseClient();

  return db.heartbeatNotification.findMany({
    where: {
      config: {
        scope: heartbeatScope,
      },
    },
    include: {
      recipientUser: {
        select: {
          fullName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

async function mapHeartbeatSettings(config: HeartbeatConfigRow): Promise<HeartbeatSettingsRecord> {
  const recentNotifications = await getRecentHeartbeatNotifications();

  return {
    enabled: config.enabled,
    cadenceValue: config.cadenceValue,
    cadenceUnit: config.cadenceUnit,
    cadenceMinutes: config.cadenceMinutes,
    nextRunAt: getNextRunAt(config)?.toISOString() ?? null,
    lastRunAt: config.lastRunAt?.toISOString() ?? null,
    lastCursorAt: config.lastCursorAt?.toISOString() ?? null,
    lastDeliveryAt: config.lastDeliveryAt?.toISOString() ?? null,
    lastRunStatus: config.lastRunStatus,
    lastRunSummary: config.lastRunSummary ?? null,
    lastError: config.lastError ?? null,
    clock: getCompanyClockSnapshot(),
    recentNotifications: recentNotifications.map((notification) => ({
      id: notification.id,
      recipientUserName: notification.recipientUser.fullName,
      channel: notification.channel,
      delivered: notification.delivered,
      payload: notification.payload,
      reason: notification.reason ?? null,
      attemptCount: notification.attemptCount,
      createdAt: notification.createdAt.toISOString(),
      deliveredAt: notification.deliveredAt?.toISOString() ?? null,
    })),
  };
}

async function buildAppointmentNotification(
  audit: {
    id: string;
    eventName: string;
    entityId: string | null;
    beforeJson: unknown;
    afterJson: unknown;
  },
) {
  if (!audit.entityId) {
    return [] as HeartbeatNotificationDraft[];
  }

  const assignedUserId = getStringField(audit.afterJson, "assignedUserId");
  const beforeAssignedUserId = getStringField(audit.beforeJson, "assignedUserId");
  const afterStartAt = getStringField(audit.afterJson, "startAt");
  const beforeStartAt = getStringField(audit.beforeJson, "startAt");
  const afterState = getStringField(audit.afterJson, "state");
  const beforeState = getStringField(audit.beforeJson, "state");

  if (!assignedUserId) {
    return [];
  }

  if (
    audit.eventName === "appointment.updated" &&
    assignedUserId === beforeAssignedUserId &&
    afterStartAt === beforeStartAt &&
    afterState === beforeState
  ) {
    return [];
  }

  const db = await getDatabaseClient();
  const appointment = await db.appointment.findUnique({
    where: { id: audit.entityId },
    include: {
      assignedUser: {
        select: {
          fullName: true,
        },
      },
      request: {
        include: {
          customer: { select: { businessName: true } },
          location: { select: { name: true } },
        },
      },
      workOrder: {
        include: {
          customer: { select: { businessName: true } },
          location: { select: { name: true } },
        },
      },
    },
  });

  if (!appointment) {
    return [];
  }

  if (
    appointment.state === AppointmentState.CANCELED ||
    appointment.state === AppointmentState.COMPLETED ||
    appointment.state === AppointmentState.MISSED
  ) {
    return [];
  }

  const customerName =
    appointment.workOrder?.customer.businessName ??
    appointment.request?.customer?.businessName ??
    "πελάτη";
  const locationName =
    appointment.workOrder?.location.name ??
    appointment.request?.location?.name ??
    "χωρίς τοποθεσία";
  const startLabel = formatCompanyDateTime(appointment.startAt);
  const prefix =
    audit.eventName === "appointment.created"
      ? "Heartbeat: νέο ραντεβού"
      : appointment.state === AppointmentState.RESCHEDULED
        ? "Heartbeat: μεταφορά ραντεβού"
        : "Heartbeat: ενημέρωση ραντεβού";
  const note = appointment.reasonNote ? `\nΣημείωση: ${appointment.reasonNote}` : "";

  return [
    {
      dedupeKey: `audit:${audit.id}:appointment:${appointment.id}:user:${appointment.assignedUserId}`,
      recipientUserId: appointment.assignedUserId,
      payload: `${prefix} για ${customerName} • ${locationName} στις ${startLabel}.${note}`,
      auditLogId: audit.id,
      channelPreference: "AUTO",
    },
  ];
}

async function buildWorkOrderCreatedNotification(audit: {
  id: string;
  entityId: string | null;
}) {
  if (!audit.entityId) {
    return [] as HeartbeatNotificationDraft[];
  }

  const db = await getDatabaseClient();
  const workOrder = await db.workOrder.findUnique({
    where: { id: audit.entityId },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
  });

  const primaryAssignment =
    workOrder?.assignments.find((assignment) => assignment.isPrimary) ??
    workOrder?.assignments[0];

  if (!workOrder || !primaryAssignment) {
    return [];
  }

  return [
    {
      dedupeKey: `audit:${audit.id}:work-order-created:user:${primaryAssignment.userId}`,
      recipientUserId: primaryAssignment.userId,
      payload:
        `Heartbeat: νέα εργασία ${workOrder.id} για ${workOrder.customer.businessName} • ${workOrder.location.name}.` +
        `\nΘέμα: ${workOrder.issueSummary}`,
      auditLogId: audit.id,
    },
  ];
}

async function buildWorkOrderReassignmentNotifications(audit: {
  id: string;
  entityId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
}) {
  if (!audit.entityId) {
    return [] as HeartbeatNotificationDraft[];
  }

  const nextAssigneeId = getStringField(audit.afterJson, "primaryAssigneeId");
  const previousAssigneeId = getStringField(audit.beforeJson, "primaryAssigneeId");
  if (!nextAssigneeId || nextAssigneeId === previousAssigneeId) {
    return [];
  }

  const db = await getDatabaseClient();
  const workOrder = await db.workOrder.findUnique({
    where: { id: audit.entityId },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
    },
  });

  if (!workOrder) {
    return [];
  }

  return [
    {
      dedupeKey: `audit:${audit.id}:work-order-reassign:user:${nextAssigneeId}`,
      recipientUserId: nextAssigneeId,
      payload:
        `Heartbeat: σου ανατέθηκε η εργασία ${workOrder.id} για ${workOrder.customer.businessName} • ${workOrder.location.name}.` +
        `\nΘέμα: ${workOrder.issueSummary}`,
      auditLogId: audit.id,
    },
  ];
}

async function buildWorkOrderLeadershipNotifications(input: {
  auditId: string;
  workOrderId: string | null;
  kind: "started" | "completed" | "follow_up_required" | "ready_for_invoice";
  occurredAt: Date;
}) {
  if (!input.workOrderId) {
    return [] as HeartbeatNotificationDraft[];
  }

  const db = await getDatabaseClient();
  const [workOrder, leadershipUsers] = await Promise.all([
    db.workOrder.findUnique({
      where: { id: input.workOrderId },
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
        assignments: {
          where: { state: WorkOrderAssignmentState.ACTIVE },
          include: { user: { select: { fullName: true } } },
        },
      },
    }),
    listLeadershipUsers(),
  ]);

  if (!workOrder || leadershipUsers.length === 0) {
    return [];
  }

  const primaryAssignment =
    workOrder.assignments.find((assignment) => assignment.isPrimary) ??
    workOrder.assignments[0];
  const technicianName = primaryAssignment?.user.fullName ?? "τεχνικός";
  const occurredLabel = formatCompanyDateTime(input.occurredAt);
  const summary =
    input.kind === "started"
      ? `ο ${technicianName} ξεκίνησε`
      : input.kind === "completed"
        ? `ο ${technicianName} ολοκλήρωσε`
        : input.kind === "follow_up_required"
          ? `το work order χρειάζεται follow-up`
          : `το work order πέρασε σε ready for invoice`;
  const followUpLine =
    input.kind === "follow_up_required" && workOrder.followUpReason
      ? `\nΑιτία follow-up: ${workOrder.followUpReason}`
      : "";

  return leadershipUsers.map((user) => ({
    dedupeKey: `audit:${input.auditId}:work-order:${input.kind}:user:${user.id}`,
    recipientUserId: user.id,
    payload:
      `Heartbeat: ${summary} (${workOrder.id}) στις ${occurredLabel}.` +
      `\nΠελάτης: ${workOrder.customer.businessName}` +
      `\nΤοποθεσία: ${workOrder.location.name}` +
      `\nΘέμα: ${workOrder.issueSummary}${followUpLine}`,
    auditLogId: input.auditId,
  }));
}

async function buildWorkOrderCompletionTechnicianNotification(audit: {
  id: string;
  entityId: string | null;
  createdAt: Date;
}) {
  if (!audit.entityId) {
    return [] as HeartbeatNotificationDraft[];
  }

  const db = await getDatabaseClient();
  const workOrder = await db.workOrder.findUnique({
    where: { id: audit.entityId },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
  });

  const primaryAssignment =
    workOrder?.assignments.find((assignment) => assignment.isPrimary) ??
    workOrder?.assignments[0];

  if (!workOrder || !primaryAssignment) {
    return [];
  }

  const nextAppointment = await db.appointment.findFirst({
    where: {
      assignedUserId: primaryAssignment.userId,
      startAt: {
        gt: audit.createdAt,
      },
      state: {
        in: [
          AppointmentState.SCHEDULED,
          AppointmentState.CONFIRMED,
          AppointmentState.RESCHEDULED,
        ],
      },
    },
    include: {
      request: {
        include: {
          customer: { select: { businessName: true } },
          location: { select: { name: true } },
        },
      },
      workOrder: {
        include: {
          customer: { select: { businessName: true } },
          location: { select: { name: true } },
        },
      },
    },
    orderBy: { startAt: "asc" },
  });

  const completionLabel = formatCompanyDateTime(audit.createdAt);
  const nextAppointmentLine = nextAppointment
    ? `\nΕπόμενο ραντεβού: ${
        nextAppointment.workOrder?.customer.businessName ??
        nextAppointment.request?.customer?.businessName ??
        "πελάτης"
      } • ${
        nextAppointment.workOrder?.location.name ??
        nextAppointment.request?.location?.name ??
        "χωρίς τοποθεσία"
      } στις ${formatCompanyDateTime(nextAppointment.startAt)}.`
    : "\nΔεν βρέθηκε επόμενο ραντεβού στο πρόγραμμα σου.";

  return [
    {
      dedupeKey: `audit:${audit.id}:work-order-complete:user:${primaryAssignment.userId}`,
      recipientUserId: primaryAssignment.userId,
      payload:
        `Heartbeat: έκλεισες την εργασία ${workOrder.id} για ${workOrder.customer.businessName} • ${workOrder.location.name} στις ${completionLabel}.` +
        nextAppointmentLine,
      auditLogId: audit.id,
    },
  ];
}

async function buildReminderNotifications(audit: {
  id: string;
  eventName: string;
  entityId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
}) {
  if (!audit.entityId) {
    return [] as HeartbeatNotificationDraft[];
  }

  const afterState = getStringField(audit.afterJson, "state");
  const beforeState = getStringField(audit.beforeJson, "state");

  if (
    audit.eventName === "invoice_reminder.updated" &&
    afterState === beforeState
  ) {
    return [];
  }

  if (
    afterState !== "QUEUED_FOR_MONTH" &&
    afterState !== "READY_FOR_ACCOUNTING" &&
    audit.eventName !== "invoice_reminder.created"
  ) {
    return [];
  }

  const db = await getDatabaseClient();
  const [reminder, leadershipUsers] = await Promise.all([
    db.invoiceReminder.findUnique({
      where: { id: audit.entityId },
      include: {
        customer: { select: { businessName: true } },
        workOrders: {
          include: {
            workOrder: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    }),
    listLeadershipUsers(),
  ]);

  if (!reminder || leadershipUsers.length === 0) {
    return [];
  }

  const summary =
    afterState === "READY_FOR_ACCOUNTING"
      ? "reminder έτοιμο για λογιστήριο"
      : afterState === "QUEUED_FOR_MONTH"
        ? "reminder μπήκε στην ουρά μήνα"
        : "δημιουργήθηκε νέο reminder";
  const workOrderList =
    reminder.workOrders.length > 0
      ? reminder.workOrders.map((item) => item.workOrder.id).join(", ")
      : "χωρίς συσχετισμένα work orders";

  return leadershipUsers.map((user) => ({
    dedupeKey: `audit:${audit.id}:reminder:user:${user.id}`,
    recipientUserId: user.id,
    payload:
      `Heartbeat: ${summary} για ${reminder.customer.businessName} (${reminder.monthKey}).` +
      `\nWork orders: ${workOrderList}` +
      `\nEstimated total: ${reminder.estimatedTotal.toFixed(2)}`,
    auditLogId: audit.id,
  }));
}

async function buildNotificationDraftsForAudit(audit: {
  id: string;
  eventName: string;
  entityId: string | null;
  createdAt: Date;
  beforeJson: unknown;
  afterJson: unknown;
}) {
  switch (audit.eventName) {
    case "appointment.created":
    case "appointment.updated":
      return buildAppointmentNotification(audit);
    case "work_order.created":
      return buildWorkOrderCreatedNotification(audit);
    case "work_order.updated":
      return buildWorkOrderReassignmentNotifications(audit);
    case "work_order.started":
      return buildWorkOrderLeadershipNotifications({
        auditId: audit.id,
        workOrderId: audit.entityId,
        kind: "started",
        occurredAt: audit.createdAt,
      });
    case "work_order.completed":
      return [
        ...(await buildWorkOrderCompletionTechnicianNotification(audit)),
        ...(await buildWorkOrderLeadershipNotifications({
          auditId: audit.id,
          workOrderId: audit.entityId,
          kind: "completed",
          occurredAt: audit.createdAt,
        })),
      ];
    case "work_order.follow_up_required":
      return buildWorkOrderLeadershipNotifications({
        auditId: audit.id,
        workOrderId: audit.entityId,
        kind: "follow_up_required",
        occurredAt: audit.createdAt,
      });
    case "work_order.ready_for_invoice":
      return buildWorkOrderLeadershipNotifications({
        auditId: audit.id,
        workOrderId: audit.entityId,
        kind: "ready_for_invoice",
        occurredAt: audit.createdAt,
      });
    case "invoice_reminder.created":
    case "invoice_reminder.updated":
      return buildReminderNotifications(audit);
    default:
      return [];
  }
}

async function deliverHeartbeatNotification(input: {
  configId: string;
  draft: HeartbeatNotificationDraft;
}) {
  const db = await getDatabaseClient();
  const existing = await db.heartbeatNotification.findUnique({
    where: { dedupeKey: input.draft.dedupeKey },
    include: {
      recipientUser: {
        select: { fullName: true },
      },
    },
  });

  if (existing?.delivered) {
    return {
      skipped: true,
      recipientUserId: existing.recipientUserId,
      recipientUserName: existing.recipientUser.fullName,
      payload: existing.payload,
      delivered: true,
      channel: existing.channel ?? "NONE",
    } as const;
  }

  const recipient = await getSessionUserById(input.draft.recipientUserId);
  if (!recipient?.isActive) {
    return {
      skipped: true,
      recipientUserId: input.draft.recipientUserId,
      recipientUserName: recipient?.fullName ?? "Unknown user",
      payload: input.draft.payload,
      delivered: false,
      channel: "NONE" as const,
      reason: "Recipient is inactive or unavailable.",
    } as const;
  }

  const result = await sendLinkedUserNotification({
    userId: input.draft.recipientUserId,
    body: input.draft.payload,
    channelPreference: input.draft.channelPreference ?? "AUTO",
  });

  if (existing) {
    await db.heartbeatNotification.update({
      where: { dedupeKey: input.draft.dedupeKey },
      data: {
        payload: input.draft.payload,
        channel: result.channel === "NONE" ? null : result.channel,
        delivered: result.delivered,
        reason: result.reason ?? null,
        attemptCount: existing.attemptCount + 1,
        lastAttemptAt: getCanonicalNow(),
        deliveredAt: result.delivered ? getCanonicalNow() : null,
      },
    });
  } else {
    await db.heartbeatNotification.create({
      data: {
        configId: input.configId,
        dedupeKey: input.draft.dedupeKey,
        auditLogId: input.draft.auditLogId ?? null,
        recipientUserId: input.draft.recipientUserId,
        channel: result.channel === "NONE" ? null : result.channel,
        payload: input.draft.payload,
        delivered: result.delivered,
        reason: result.reason ?? null,
        deliveredAt: result.delivered ? getCanonicalNow() : null,
        lastAttemptAt: getCanonicalNow(),
      },
    });
  }

  return {
    skipped: false,
    recipientUserId: recipient.id,
    recipientUserName: recipient.fullName,
    payload: input.draft.payload,
    delivered: result.delivered,
    channel: result.channel,
    reason: result.reason,
  } as const;
}

class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;

  private dueAt: Date | null = null;

  private initialized = false;

  private initializePromise: Promise<void> | null = null;

  private runPromise: Promise<HeartbeatRunResult> | null = null;

  async ensureRunning() {
    if (this.initialized) {
      return;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = (async () => {
      const config = await getOrCreateHeartbeatConfig();
      this.schedule(config);
      this.initialized = true;
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async getSettings() {
    await this.ensureRunning();
    const config = await getOrCreateHeartbeatConfig();
    return mapHeartbeatSettings(config);
  }

  async updateSettings(input: HeartbeatSettingsInput, actorUserId: string) {
    await this.ensureRunning();
    const parsed = updateHeartbeatSettingsSchema.parse(input);
    const config = await getOrCreateHeartbeatConfig();
    const now = getCanonicalNow();
    const cadenceMinutes = cadenceToMinutes(parsed.cadenceValue, parsed.cadenceUnit);
    const enabling = !config.enabled && parsed.enabled;
    const db = await getDatabaseClient();

    const updated = await db.heartbeatConfig.update({
      where: { scope: heartbeatScope },
      data: {
        enabled: parsed.enabled,
        cadenceValue: parsed.cadenceValue,
        cadenceUnit: parsed.cadenceUnit,
        cadenceMinutes,
        updatedByUserId: actorUserId,
        lastCursorAt:
          enabling && !config.lastCursorAt
            ? now
            : enabling && !config.enabled
              ? now
              : undefined,
        lastRunSummary: enabling
          ? `Heartbeat enabled with cadence ${formatHeartbeatCadence(parsed.cadenceValue, parsed.cadenceUnit)}.`
          : parsed.enabled
            ? undefined
            : "Heartbeat disabled by admin.",
        lastError: null,
      },
    });

    this.schedule(updated);
    return mapHeartbeatSettings(updated);
  }

  async runNow(actorUserId: string) {
    await this.ensureRunning();
    const result = await this.runCycle({
      trigger: "manual",
      actorUserId,
    });
    const config = await getOrCreateHeartbeatConfig();
    return {
      run: result,
      settings: await mapHeartbeatSettings(config),
    };
  }

  private schedule(config: HeartbeatConfigRow) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!config.enabled) {
      this.dueAt = null;
      return;
    }

    const nextRunAt = getNextRunAt(config) ?? new Date(getCanonicalNow().getTime() + 60_000);
    this.dueAt = nextRunAt;
    const delay = Math.max(
      1_000,
      Math.min(nextRunAt.getTime() - getCanonicalNow().getTime(), 60 * 60 * 1000),
    );

    this.timer = setTimeout(() => {
      void this.handleScheduledTick();
    }, delay);
  }

  private async handleScheduledTick() {
    const config = await getOrCreateHeartbeatConfig();
    if (!config.enabled) {
      this.schedule(config);
      return;
    }

    const dueAt = getNextRunAt(config);
    if (dueAt && dueAt.getTime() > getCanonicalNow().getTime()) {
      this.schedule(config);
      return;
    }

    try {
      await this.runCycle({ trigger: "auto" });
    } finally {
      const nextConfig = await getOrCreateHeartbeatConfig();
      this.schedule(nextConfig);
    }
  }

  private async runCycle(input: {
    trigger: "auto" | "manual";
    actorUserId?: string;
  }): Promise<HeartbeatRunResult> {
    if (this.runPromise) {
      return this.runPromise;
    }

    this.runPromise = this.runCycleInner(input);

    try {
      return await this.runPromise;
    } finally {
      this.runPromise = null;
    }
  }

  private async runCycleInner(input: {
    trigger: "auto" | "manual";
    actorUserId?: string;
  }): Promise<HeartbeatRunResult> {
    const db = await getDatabaseClient();
    const config = await getOrCreateHeartbeatConfig();

    if (!config.enabled && input.trigger === "auto") {
      return {
        ok: true,
        trigger: input.trigger,
        checkedAt: getCanonicalNow().toISOString(),
        scannedEvents: 0,
        notificationAttempts: 0,
        deliveredCount: 0,
        summary: "Heartbeat is disabled.",
        clock: getCompanyClockSnapshot(),
        notifications: [],
      };
    }

    const externalClock = await refreshExternalClockSnapshot({ force: true });
    const startedAt = getCanonicalNow();
    const cursor = config.lastCursorAt ?? startedAt;

    try {
      const audits = await db.auditLog.findMany({
        where: {
          createdAt: {
            gt: cursor,
          },
          eventName: {
            in: [...relevantHeartbeatEvents],
          },
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });

      const drafts: HeartbeatNotificationDraft[] = [];
      for (const audit of audits) {
        drafts.push(...(await buildNotificationDraftsForAudit(audit)));
      }

      const deliveries = [];
      for (const draft of drafts) {
        deliveries.push(
          await deliverHeartbeatNotification({
            configId: config.id,
            draft,
          }),
        );
      }

      let manualVerificationAttempts = 0;

      if (input.trigger === "manual" && input.actorUserId) {
        const baseMessage =
          `Heartbeat verification ολοκληρώθηκε στις ${formatCompanyDateTime(startedAt)}.` +
          `\nΑλλαγές που ελέγχθηκαν: ${audits.length}` +
          `\nClock check: ${externalClock.status}`;
        const manualDrafts: HeartbeatNotificationDraft[] = [
          {
            dedupeKey: `manual:${startedAt.toISOString()}:user:${input.actorUserId}:whatsapp`,
            recipientUserId: input.actorUserId,
            payload: `${baseMessage}\nChannel test: WhatsApp OK path checked.`,
            channelPreference: "WHATSAPP",
          },
          {
            dedupeKey: `manual:${startedAt.toISOString()}:user:${input.actorUserId}:imessage`,
            recipientUserId: input.actorUserId,
            payload: `${baseMessage}\nChannel test: iMessage OK path checked.`,
            channelPreference: "IMESSAGE",
          },
        ];

        manualVerificationAttempts = manualDrafts.length;
        for (const manualDraft of manualDrafts) {
          deliveries.push(
            await deliverHeartbeatNotification({
              configId: config.id,
              draft: manualDraft,
            }),
          );
        }
      }

      const deliveredCount = deliveries.filter((item) => item.delivered).length;
      const summary = buildRunSummary({
        scannedEvents: audits.length,
        notificationAttempts: drafts.length + manualVerificationAttempts,
        deliveredCount,
        manualVerificationAttempts,
      });

      const latestCursor = audits[audits.length - 1]?.createdAt ?? startedAt;
      await db.heartbeatConfig.update({
        where: { scope: heartbeatScope },
        data: {
          lastRunAt: startedAt,
          lastCursorAt: latestCursor,
          lastDeliveryAt: deliveries.some((item) => item.delivered) ? startedAt : config.lastDeliveryAt,
          lastRunStatus: HeartbeatRunStatus.SUCCESS,
          lastRunSummary: summary,
          lastError: null,
        },
      });

      return {
        ok: true,
        trigger: input.trigger,
        checkedAt: startedAt.toISOString(),
        scannedEvents: audits.length,
        notificationAttempts: drafts.length + manualVerificationAttempts,
        deliveredCount: deliveries.filter((item) => item.delivered).length,
        summary,
        clock: getCompanyClockSnapshot(),
        notifications: deliveries.map((delivery) => ({
          recipientUserId: delivery.recipientUserId,
          recipientUserName: delivery.recipientUserName,
          delivered: delivery.delivered,
          channel: delivery.channel,
          reason: "reason" in delivery ? (delivery.reason ?? undefined) : undefined,
          payload: delivery.payload,
        })),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Heartbeat run failed.";
      await db.heartbeatConfig.update({
        where: { scope: heartbeatScope },
        data: {
          lastRunAt: startedAt,
          lastRunStatus: HeartbeatRunStatus.FAILED,
          lastRunSummary: "Heartbeat run failed.",
          lastError: message,
        },
      });

      return {
        ok: false,
        trigger: input.trigger,
        checkedAt: startedAt.toISOString(),
        scannedEvents: 0,
        notificationAttempts: 0,
        deliveredCount: 0,
        summary: message,
        clock: getCompanyClockSnapshot(),
        notifications: [],
      };
    }
  }
}

declare global {
  var __companyAssistantHeartbeatService: HeartbeatService | undefined;
}

function getHeartbeatService() {
  if (!globalThis.__companyAssistantHeartbeatService) {
    globalThis.__companyAssistantHeartbeatService = new HeartbeatService();
  }

  return globalThis.__companyAssistantHeartbeatService;
}

export async function ensureHeartbeatServiceRunning() {
  await getHeartbeatService().ensureRunning();
}

export async function getHeartbeatSettings() {
  return getHeartbeatService().getSettings();
}

export async function updateHeartbeatSettings(input: HeartbeatSettingsInput, actorUserId: string) {
  return getHeartbeatService().updateSettings(input, actorUserId);
}

export async function runHeartbeatNow(actorUserId: string) {
  return getHeartbeatService().runNow(actorUserId);
}

export function parseHeartbeatSettingsInput(input: unknown) {
  return updateHeartbeatSettingsSchema.parse(input);
}

export function assertAdminHeartbeatCadenceInput(input: unknown) {
  const parsed = updateHeartbeatSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new BusinessRuleError(
      "HEARTBEAT_INVALID_SETTINGS",
      "Heartbeat settings are invalid.",
      422,
      {
        issues: parsed.error.flatten(),
      },
    );
  }

  return parsed.data;
}
