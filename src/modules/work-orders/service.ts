import {
  AppointmentState as DbAppointmentState,
  AuditActorSource,
  DomainEntityType,
  WorkOrderAssignmentState,
  WorkOrderState as DbWorkOrderState,
} from "@prisma/client";
import type { SessionUser } from "@/shared/auth/types";
import type { WorkOrderRecord } from "@/modules/operations/types";
import { recordAuditEvent } from "@/modules/audit/service";
import { countTimeEntriesForWorkOrder } from "@/modules/time-entries/service";
import { assertAssignableTechnicianUserId } from "@/modules/users/service";
import { getWorkOrderMutationAccessRecord } from "@/modules/work-orders/access";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";

function mapWorkOrderRecord(workOrder: {
  id: string;
  requestId: string | null;
  customerId: string;
  locationId: string;
  state: DbWorkOrderState;
  issueSummary: string;
  resolutionSummary: string | null;
  followUpReason: string | null;
  invoiceReadyAt: Date | null;
  createdByUserId: string;
  createdByUserNameSnapshot?: string | null;
  closedByUserId: string | null;
  closedByUserNameSnapshot?: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { businessName: string };
  location: { name: string };
  createdBy: { fullName: string };
  closedBy: { fullName: string } | null;
  assignments: Array<{
    userId: string;
    state: WorkOrderAssignmentState;
    user: { fullName: string };
    isPrimary: boolean;
  }>;
}): WorkOrderRecord {
  const primaryAssignment =
    workOrder.assignments.find((assignment) => assignment.isPrimary) ??
    workOrder.assignments[0];

  return {
    id: workOrder.id,
    requestId: workOrder.requestId,
    customerId: workOrder.customerId,
    customerName: workOrder.customer.businessName,
    locationId: workOrder.locationId,
    locationName: workOrder.location.name,
    state: workOrder.state,
    issueSummary: workOrder.issueSummary,
    resolutionSummary: workOrder.resolutionSummary,
    followUpReason: workOrder.followUpReason,
    invoiceReadyAt: workOrder.invoiceReadyAt?.toISOString() ?? null,
    primaryAssigneeId: primaryAssignment?.userId ?? null,
    primaryAssigneeName: primaryAssignment?.user.fullName ?? null,
    createdByUserId: workOrder.createdByUserId,
    createdByUserName: workOrder.createdBy.fullName,
    closedByUserId: workOrder.closedByUserId,
    closedByUserName: workOrder.closedBy?.fullName ?? null,
    createdAt: workOrder.createdAt.toISOString(),
    updatedAt: workOrder.updatedAt.toISOString(),
  };
}

async function syncAppointmentStateForWorkOrder(
  workOrderId: string,
  nextState: DbAppointmentState,
  actor: SessionUser,
) {
  const db = await getDatabaseClient();

  await db.appointment.updateMany({
    where: {
      workOrderId,
      state: {
        in:
          nextState === DbAppointmentState.IN_PROGRESS
            ? [
                DbAppointmentState.SCHEDULED,
                DbAppointmentState.CONFIRMED,
                DbAppointmentState.RESCHEDULED,
              ]
            : [
                DbAppointmentState.SCHEDULED,
                DbAppointmentState.CONFIRMED,
                DbAppointmentState.IN_PROGRESS,
                DbAppointmentState.RESCHEDULED,
              ],
      },
    },
    data: {
      state: nextState,
      updatedByUserId: actor.id,
    },
  });
}

export async function listWorkOrders(user: SessionUser) {
  const db = await getDatabaseClient();

  const workOrders = await db.workOrder.findMany({
    where:
      user.role === "technician"
        ? {
            assignments: {
              some: {
                userId: user.id,
                state: WorkOrderAssignmentState.ACTIVE,
              },
            },
          }
        : undefined,
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return workOrders.map(mapWorkOrderRecord);
}

export async function getWorkOrderById(workOrderId: string, user: SessionUser) {
  const workOrders = await listWorkOrders(user);
  return workOrders.find((workOrder) => workOrder.id === workOrderId) ?? null;
}

export async function createWorkOrder(
  input: {
    requestId?: string | null;
    customerId: string;
    locationId: string;
    issueSummary: string;
    assignedUserId?: string | null;
  },
  actor: SessionUser,
) {
  const db = await getDatabaseClient();
  if (input.assignedUserId) {
    await assertAssignableTechnicianUserId(input.assignedUserId);
  }

  const workOrder = await db.workOrder.create({
    data: {
      requestId: input.requestId ?? null,
      customerId: input.customerId,
      locationId: input.locationId,
      issueSummary: input.issueSummary,
      state: input.assignedUserId ? DbWorkOrderState.SCHEDULED : DbWorkOrderState.DRAFT,
      createdByUserId: actor.id,
      assignments: input.assignedUserId
        ? {
            create: {
              userId: input.assignedUserId,
              state: WorkOrderAssignmentState.ACTIVE,
              isPrimary: true,
            },
          }
        : undefined,
    },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
  });

  const mapped = mapWorkOrderRecord(workOrder);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: mapped.id,
    eventName: "work_order.created",
    afterJson: mapped,
  });

  return mapped;
}

export async function updateWorkOrder(
  workOrderId: string,
  input: Partial<{
    state: WorkOrderRecord["state"];
    resolutionSummary: string | null;
    followUpReason: string | null;
    assignedUserId: string | null;
    markReadyForInvoice: boolean;
  }>,
  actor: SessionUser,
) {
  const db = await getDatabaseClient();

  const before = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
  });
  if (!before) {
    return null;
  }

  if ("assignedUserId" in input) {
    if (input.assignedUserId) {
      await assertAssignableTechnicianUserId(input.assignedUserId);
    }

    await db.workOrderAssignment.updateMany({
      where: { workOrderId, state: WorkOrderAssignmentState.ACTIVE },
      data: {
        state: WorkOrderAssignmentState.REMOVED,
        releasedAt: new Date(),
      },
    });

    if (input.assignedUserId) {
      await db.workOrderAssignment.create({
        data: {
          workOrderId,
          userId: input.assignedUserId,
          state: WorkOrderAssignmentState.ACTIVE,
          isPrimary: true,
        },
      });
    }
  }

  const workOrder = await db.workOrder.update({
    where: { id: workOrderId },
    data: {
      state: input.markReadyForInvoice
        ? DbWorkOrderState.READY_FOR_INVOICE
        : (input.state as DbWorkOrderState | undefined),
      resolutionSummary:
        "resolutionSummary" in input ? input.resolutionSummary ?? null : undefined,
      followUpReason:
        "followUpReason" in input ? input.followUpReason ?? null : undefined,
      invoiceReadyAt:
        input.markReadyForInvoice === true ? new Date() : undefined,
      closedByUserId:
        input.state === "COMPLETED" || input.markReadyForInvoice ? actor.id : undefined,
    },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
  });

  const beforeMapped = mapWorkOrderRecord(before);
  const mapped = mapWorkOrderRecord(workOrder);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: mapped.id,
    eventName: "work_order.updated",
    beforeJson: beforeMapped,
    afterJson: mapped,
  });

  return mapped;
}

export async function deleteWorkOrder(workOrderId: string, actor: SessionUser) {
  const db = await getDatabaseClient();

  const workOrder = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      closedBy: { select: { fullName: true } },
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        include: { user: { select: { fullName: true } } },
      },
    },
  });

  if (!workOrder) {
    return null;
  }

  const before = mapWorkOrderRecord(workOrder);
  const appointmentCount = await db.appointment.count({
    where: { workOrderId },
  });

  if (appointmentCount > 0) {
    throw new BusinessRuleError(
      "WORK_ORDER_DELETE_BLOCKED",
      "Το work order έχει συνδεδεμένα ραντεβού. Διέγραψε πρώτα τα συνδεδεμένα ραντεβού.",
      409,
      {
        appointmentCount,
      },
    );
  }

  await db.workOrder.delete({
    where: { id: workOrderId },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.deleted",
    beforeJson: before,
  });

  return before;
}

export async function startWorkOrder(workOrderId: string, actor: SessionUser) {
  const accessRecord = await getWorkOrderMutationAccessRecord(workOrderId, actor);
  if (!accessRecord) {
    return null;
  }

  if (!accessRecord.primaryAssigneeId) {
    throw new BusinessRuleError(
      "WORK_ORDER_NOT_ASSIGNED",
      "Το work order δεν μπορεί να ξεκινήσει χωρίς ανατεθειμένο τεχνικό.",
      409,
    );
  }

  if (
    accessRecord.state !== "SCHEDULED" &&
    accessRecord.state !== "FOLLOW_UP_REQUIRED"
  ) {
    throw new BusinessRuleError(
      "WORK_ORDER_INVALID_START_STATE",
      "Το work order μπορεί να ξεκινήσει μόνο από scheduled ή follow-up required κατάσταση.",
      409,
    );
  }

  const updated = await updateWorkOrder(
    workOrderId,
    {
      state: "IN_PROGRESS",
      followUpReason: null,
    },
    actor,
  );

  if (!updated) {
    return null;
  }

  await syncAppointmentStateForWorkOrder(
    workOrderId,
    DbAppointmentState.IN_PROGRESS,
    actor,
  );

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.started",
    afterJson: updated,
  });

  return updated;
}

export async function completeWorkOrder(
  workOrderId: string,
  input: {
    resolutionSummary: string;
  },
  actor: SessionUser,
) {
  const accessRecord = await getWorkOrderMutationAccessRecord(workOrderId, actor);
  if (!accessRecord) {
    return null;
  }

  if (
    accessRecord.state === "CANCELED" ||
    accessRecord.state === "READY_FOR_INVOICE"
  ) {
    throw new BusinessRuleError(
      "WORK_ORDER_LOCKED",
      "Το work order δεν μπορεί να ολοκληρωθεί από την τρέχουσα κατάσταση.",
      409,
    );
  }

  const timeEntryCount = await countTimeEntriesForWorkOrder(workOrderId);
  if (timeEntryCount < 1) {
    throw new BusinessRuleError(
      "TIME_ENTRY_REQUIRED",
      "Η ολοκλήρωση απαιτεί τουλάχιστον μία καταγραφή χρόνου.",
      422,
    );
  }

  const updated = await updateWorkOrder(
    workOrderId,
    {
      state: "COMPLETED",
      resolutionSummary: input.resolutionSummary,
      followUpReason: null,
    },
    actor,
  );

  if (!updated) {
    return null;
  }

  await syncAppointmentStateForWorkOrder(
    workOrderId,
    DbAppointmentState.COMPLETED,
    actor,
  );

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.completed",
    afterJson: updated,
  });

  return updated;
}

export async function markWorkOrderFollowUpRequired(
  workOrderId: string,
  input: {
    followUpReason: string;
    resolutionSummary?: string | null;
  },
  actor: SessionUser,
) {
  const accessRecord = await getWorkOrderMutationAccessRecord(workOrderId, actor);
  if (!accessRecord) {
    return null;
  }

  if (
    accessRecord.state === "CANCELED" ||
    accessRecord.state === "READY_FOR_INVOICE"
  ) {
    throw new BusinessRuleError(
      "WORK_ORDER_LOCKED",
      "Το work order δεν μπορεί να περάσει σε follow-up από την τρέχουσα κατάσταση.",
      409,
    );
  }

  const updated = await updateWorkOrder(
    workOrderId,
    {
      state: "FOLLOW_UP_REQUIRED",
      followUpReason: input.followUpReason,
      resolutionSummary:
        "resolutionSummary" in input ? input.resolutionSummary ?? null : undefined,
    },
    actor,
  );

  if (!updated) {
    return null;
  }

  await syncAppointmentStateForWorkOrder(
    workOrderId,
    DbAppointmentState.COMPLETED,
    actor,
  );

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.follow_up_required",
    afterJson: updated,
  });

  return updated;
}

export async function markWorkOrderReadyForInvoice(
  workOrderId: string,
  actor: SessionUser,
) {
  const accessRecord = await getWorkOrderMutationAccessRecord(workOrderId, actor);
  if (!accessRecord) {
    return null;
  }

  if (accessRecord.state !== "COMPLETED") {
    throw new BusinessRuleError(
      "WORK_ORDER_NOT_COMPLETED",
      "Το work order πρέπει να είναι ολοκληρωμένο πριν περάσει σε ready for invoice.",
      422,
    );
  }

  const timeEntryCount = await countTimeEntriesForWorkOrder(workOrderId);
  if (timeEntryCount < 1) {
    throw new BusinessRuleError(
      "TIME_ENTRY_REQUIRED",
      "Η μετάβαση σε ready for invoice απαιτεί τουλάχιστον μία καταγραφή χρόνου.",
      422,
    );
  }

  const updated = await updateWorkOrder(
    workOrderId,
    {
      markReadyForInvoice: true,
    },
    actor,
  );

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.ready_for_invoice",
    afterJson: updated,
  });

  return updated;
}
