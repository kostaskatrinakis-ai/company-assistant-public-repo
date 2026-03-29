import {
  AppointmentState as DbAppointmentState,
  AuditActorSource,
  DomainEntityType,
} from "@prisma/client";
import type { AppointmentRecord } from "@/modules/operations/types";
import { recordAuditEvent } from "@/modules/audit/service";
import { assertAssignableTechnicianUserId } from "@/modules/users/service";
import type { SessionUser } from "@/shared/auth/types";
import { getDatabaseClient } from "@/shared/db/readiness";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import {
  getCompanyClockSnapshot,
  getDefaultAppointmentDurationMinutes,
} from "@/shared/time/company-clock";

const appointmentConflictStates: DbAppointmentState[] = [
  DbAppointmentState.SCHEDULED,
  DbAppointmentState.CONFIRMED,
  DbAppointmentState.IN_PROGRESS,
  DbAppointmentState.RESCHEDULED,
];

function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function getEffectiveAppointmentEnd(startAt: Date, endAt: Date | null) {
  return endAt ?? addMinutes(startAt, getDefaultAppointmentDurationMinutes());
}

function normalizeAppointmentRange(input: {
  startAt: string;
  endAt?: string | null;
}) {
  const startAt = new Date(input.startAt);
  const endAt = input.endAt ? new Date(input.endAt) : null;

  if (!isValidDate(startAt) || (endAt && !isValidDate(endAt))) {
    throw new BusinessRuleError(
      "APPOINTMENT_INVALID_DATETIME",
      "Η ημερομηνία ή ώρα του ραντεβού δεν είναι έγκυρη.",
      422,
    );
  }

  const effectiveEndAt = getEffectiveAppointmentEnd(startAt, endAt);
  if (effectiveEndAt.getTime() <= startAt.getTime()) {
    throw new BusinessRuleError(
      "APPOINTMENT_INVALID_RANGE",
      "Η ώρα λήξης πρέπει να είναι μετά την ώρα έναρξης.",
      422,
    );
  }

  return {
    startAt,
    endAt,
    effectiveEndAt,
  };
}

async function assertNoAppointmentConflict(input: {
  appointmentId?: string;
  assignedUserId: string;
  startAt: Date;
  endAt: Date | null;
}) {
  const db = await getDatabaseClient();
  const effectiveEndAt = getEffectiveAppointmentEnd(input.startAt, input.endAt);

  const candidates = await db.appointment.findMany({
    where: {
      assignedUserId: input.assignedUserId,
      state: {
        in: appointmentConflictStates,
      },
      ...(input.appointmentId ? { NOT: { id: input.appointmentId } } : {}),
      startAt: {
        lt: effectiveEndAt,
      },
      OR: [
        { endAt: null },
        { endAt: { gt: input.startAt } },
      ],
    },
    include: {
      assignedUser: {
        select: { fullName: true },
      },
    },
    orderBy: { startAt: "asc" },
    take: 10,
  });

  const conflict = candidates.find((candidate) => {
    const candidateEffectiveEndAt = getEffectiveAppointmentEnd(candidate.startAt, candidate.endAt);
    return candidate.startAt < effectiveEndAt && candidateEffectiveEndAt > input.startAt;
  });

  if (!conflict) {
    return;
  }

  throw new BusinessRuleError(
    "APPOINTMENT_CONFLICT",
    `Ο τεχνικός ${conflict.assignedUser.fullName} έχει ήδη ραντεβού που συγκρούεται χρονικά (${conflict.startAt.toISOString()} - ${getEffectiveAppointmentEnd(conflict.startAt, conflict.endAt).toISOString()}).`,
    409,
    {
      conflictingAppointmentId: conflict.id,
      conflictingStartAt: conflict.startAt.toISOString(),
      conflictingEndAt: getEffectiveAppointmentEnd(conflict.startAt, conflict.endAt).toISOString(),
      companyClock: getCompanyClockSnapshot(),
    },
  );
}

function mapAppointmentRecord(appointment: {
  id: string;
  requestId: string | null;
  workOrderId: string | null;
  assignedUserId: string;
  startAt: Date;
  endAt: Date | null;
  state: DbAppointmentState;
  reasonNote: string | null;
  createdByUserId: string;
  createdByUserNameSnapshot?: string | null;
  updatedByUserId: string | null;
  updatedByUserNameSnapshot?: string | null;
  createdAt: Date;
  updatedAt: Date;
  assignedUser: { fullName: string };
  createdBy: { fullName: string };
  updatedBy: { fullName: string } | null;
}): AppointmentRecord {
  return {
    id: appointment.id,
    requestId: appointment.requestId,
    workOrderId: appointment.workOrderId,
    assignedUserId: appointment.assignedUserId,
    assignedUserName: appointment.assignedUser.fullName,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt?.toISOString() ?? null,
    state: appointment.state,
    reasonNote: appointment.reasonNote,
    createdByUserId: appointment.createdByUserId,
    createdByUserName: appointment.createdBy.fullName,
    updatedByUserId: appointment.updatedByUserId,
    updatedByUserName: appointment.updatedBy?.fullName ?? null,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}

export async function listAppointments(user: SessionUser) {
  const db = await getDatabaseClient();

  const appointments = await db.appointment.findMany({
    where:
      user.role === "technician"
        ? { assignedUserId: user.id }
        : undefined,
    include: {
      assignedUser: {
        select: { fullName: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
    },
    orderBy: { startAt: "asc" },
  });

  return appointments.map(mapAppointmentRecord);
}

export async function createAppointment(
  input: {
    requestId?: string | null;
    workOrderId?: string | null;
    assignedUserId: string;
    startAt: string;
    endAt?: string | null;
    reasonNote?: string | null;
  },
  actor: SessionUser,
) {
  const db = await getDatabaseClient();
  await assertAssignableTechnicianUserId(input.assignedUserId);
  const range = normalizeAppointmentRange({
    startAt: input.startAt,
    endAt: input.endAt,
  });
  await assertNoAppointmentConflict({
    assignedUserId: input.assignedUserId,
    startAt: range.startAt,
    endAt: range.endAt,
  });

  const appointment = await db.appointment.create({
    data: {
      requestId: input.requestId ?? null,
      workOrderId: input.workOrderId ?? null,
      assignedUserId: input.assignedUserId,
      startAt: range.startAt,
      endAt: range.endAt ?? range.effectiveEndAt,
      state: DbAppointmentState.SCHEDULED,
      reasonNote: input.reasonNote ?? null,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
    },
    include: {
      assignedUser: {
        select: { fullName: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
    },
  });

  const mapped = mapAppointmentRecord(appointment);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.APPOINTMENT,
    entityId: mapped.id,
    eventName: "appointment.created",
    afterJson: mapped,
  });

  return mapped;
}

export async function updateAppointment(
  appointmentId: string,
  input: Partial<{
    assignedUserId: string;
    startAt: string;
    endAt: string | null;
    state: AppointmentRecord["state"];
    reasonNote: string | null;
  }>,
  actor: SessionUser,
) {
  const db = await getDatabaseClient();
  if (input.assignedUserId) {
    await assertAssignableTechnicianUserId(input.assignedUserId);
  }

  const before = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      assignedUser: {
        select: { fullName: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
    },
  });
  if (!before) {
    return null;
  }

  const nextAssignedUserId = input.assignedUserId ?? before.assignedUserId;
  const range =
    input.startAt || "endAt" in input
      ? normalizeAppointmentRange({
          startAt: input.startAt ?? before.startAt.toISOString(),
          endAt: "endAt" in input ? input.endAt ?? null : before.endAt?.toISOString() ?? null,
        })
      : {
          startAt: before.startAt,
          endAt: before.endAt,
          effectiveEndAt: getEffectiveAppointmentEnd(before.startAt, before.endAt),
        };

  await assertNoAppointmentConflict({
    appointmentId,
    assignedUserId: nextAssignedUserId,
    startAt: range.startAt,
    endAt: range.endAt,
  });

  const appointment = await db.appointment.update({
    where: { id: appointmentId },
    data: {
      assignedUserId: nextAssignedUserId,
      startAt: input.startAt ? range.startAt : undefined,
      endAt: "endAt" in input ? range.endAt ?? range.effectiveEndAt : undefined,
      state: input.state as DbAppointmentState | undefined,
      reasonNote: "reasonNote" in input ? input.reasonNote ?? null : undefined,
      updatedByUserId: actor.id,
    },
    include: {
      assignedUser: {
        select: { fullName: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
    },
  });

  const beforeMapped = mapAppointmentRecord(before);
  const mapped = mapAppointmentRecord(appointment);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.APPOINTMENT,
    entityId: mapped.id,
    eventName: "appointment.updated",
    beforeJson: beforeMapped,
    afterJson: mapped,
  });

  return mapped;
}

export async function deleteAppointment(appointmentId: string, actor: SessionUser) {
  const db = await getDatabaseClient();

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      assignedUser: {
        select: { fullName: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
    },
  });

  if (!appointment) {
    return null;
  }

  const before = mapAppointmentRecord(appointment);

  await db.appointment.delete({
    where: { id: appointmentId },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.APPOINTMENT,
    entityId: appointmentId,
    eventName: "appointment.deleted",
    beforeJson: before,
  });

  return before;
}
