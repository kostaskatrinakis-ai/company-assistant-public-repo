import {
  AuditActorSource,
  DomainEntityType,
} from "@prisma/client";
import { recordAuditEvent } from "@/modules/audit/service";
import type { TimeEntryRecord } from "@/modules/operations/types";
import { getWorkOrderMutationAccessRecord } from "@/modules/work-orders/access";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import type { SessionUser } from "@/shared/auth/types";
import { getDatabaseClient } from "@/shared/db/readiness";

function mapTimeEntryRecord(entry: {
  id: string;
  workOrderId: string;
  userId: string;
  minutesWorked: number;
  minutesTravel: number;
  note: string | null;
  createdAt: Date;
  user: { fullName: string };
}): TimeEntryRecord {
  return {
    id: entry.id,
    workOrderId: entry.workOrderId,
    userId: entry.userId,
    userName: entry.user.fullName,
    minutesWorked: entry.minutesWorked,
    minutesTravel: entry.minutesTravel,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function countTimeEntriesForWorkOrder(workOrderId: string) {
  const db = await getDatabaseClient();

  return db.timeEntry.count({
    where: { workOrderId },
  });
}

export async function createTimeEntry(
  workOrderId: string,
  input: {
    minutesWorked: number;
    minutesTravel?: number;
    note?: string | null;
  },
  actor: SessionUser,
) {
  const accessRecord = await getWorkOrderMutationAccessRecord(workOrderId, actor);
  if (!accessRecord) {
    throw new BusinessRuleError(
      "WORK_ORDER_NOT_ACCESSIBLE",
      "Το work order δεν βρέθηκε ή δεν επιτρέπεται η πρόσβαση.",
      404,
    );
  }

  if (accessRecord.state === "CANCELED" || accessRecord.state === "READY_FOR_INVOICE") {
    throw new BusinessRuleError(
      "WORK_ORDER_LOCKED",
      "Δεν μπορεί να προστεθεί χρόνος σε ακυρωμένο ή invoice-ready work order.",
      409,
    );
  }

  const db = await getDatabaseClient();

  const timeEntry = await db.timeEntry.create({
    data: {
      workOrderId,
      userId: actor.id,
      minutesWorked: input.minutesWorked,
      minutesTravel: input.minutesTravel ?? 0,
      note: input.note ?? null,
    },
    include: {
      user: {
        select: { fullName: true },
      },
    },
  });

  const mapped = mapTimeEntryRecord(timeEntry);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.time_entry.created",
    afterJson: mapped,
  });

  return mapped;
}
