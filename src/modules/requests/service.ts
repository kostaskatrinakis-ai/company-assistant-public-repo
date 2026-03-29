import {
  AuditActorSource,
  DomainEntityType,
  RequestPriority as DbRequestPriority,
  RequestSourceChannel as DbRequestSourceChannel,
  RequestState as DbRequestState,
} from "@prisma/client";
import type { RequestRecord } from "@/modules/operations/types";
import { recordAuditEvent } from "@/modules/audit/service";
import type { SessionUser } from "@/shared/auth/types";
import { getDatabaseClient } from "@/shared/db/readiness";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";

function mapRequestRecord(request: {
  id: string;
  customerId: string | null;
  locationId: string | null;
  sourceChannel: DbRequestSourceChannel;
  description: string;
  priority: DbRequestPriority;
  state: DbRequestState;
  reportedByName: string | null;
  createdByUserId: string;
  createdByUserNameSnapshot?: string | null;
  createdBy: { fullName: string };
  createdAt: Date;
  updatedAt: Date;
  customer: { businessName: string } | null;
  location: { name: string } | null;
}): RequestRecord {
  return {
    id: request.id,
    customerId: request.customerId,
    customerName: request.customer?.businessName ?? null,
    locationId: request.locationId,
    locationName: request.location?.name ?? null,
    sourceChannel: request.sourceChannel,
    description: request.description,
    priority: request.priority,
    state: request.state,
    reportedByName: request.reportedByName,
    createdByUserId: request.createdByUserId,
    createdByUserName: request.createdBy.fullName,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

export async function listRequests() {
  const db = await getDatabaseClient();

  const requests = await db.request.findMany({
    include: {
      customer: {
        select: { businessName: true },
      },
      location: {
        select: { name: true },
      },
      createdBy: {
        select: { fullName: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return requests.map(mapRequestRecord);
}

export async function getRequestById(requestId: string) {
  const db = await getDatabaseClient();

  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      customer: {
        select: { businessName: true },
      },
      location: {
        select: { name: true },
      },
      createdBy: {
        select: { fullName: true },
      },
    },
  });

  return request ? mapRequestRecord(request) : null;
}

export async function createRequest(
  input: {
    customerId?: string | null;
    locationId?: string | null;
    sourceChannel: RequestRecord["sourceChannel"];
    description: string;
    priority: RequestRecord["priority"];
    reportedByName?: string | null;
  },
  actor: SessionUser,
) {
  const db = await getDatabaseClient();

  const hasDetails = Boolean(input.customerId && input.locationId);

  const request = await db.request.create({
    data: {
      customerId: input.customerId ?? null,
      locationId: input.locationId ?? null,
      sourceChannel: input.sourceChannel as DbRequestSourceChannel,
      description: input.description,
      priority: input.priority as DbRequestPriority,
      state: hasDetails ? DbRequestState.NEW : DbRequestState.AWAITING_DETAILS,
      reportedByName: input.reportedByName ?? null,
      createdByUserId: actor.id,
    },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const mapped = mapRequestRecord(request);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REQUEST,
    entityId: mapped.id,
    eventName: "request.created",
    afterJson: mapped,
  });

  return mapped;
}

export async function updateRequest(
  requestId: string,
  input: Partial<{
    customerId: string | null;
    locationId: string | null;
    description: string;
    priority: RequestRecord["priority"];
    state: RequestRecord["state"];
    reportedByName: string | null;
  }>,
  actor: SessionUser,
) {
  const db = await getDatabaseClient();

  const before = await getRequestById(requestId);
  if (!before) {
    return null;
  }

  const currentState = before.state;
  const nextCustomerId =
    "customerId" in input ? input.customerId ?? null : before.customerId ?? null;
  const nextLocationId =
    "locationId" in input ? input.locationId ?? null : before.locationId ?? null;

  const request = await db.request.update({
    where: { id: requestId },
    data: {
      customerId: "customerId" in input ? input.customerId ?? null : undefined,
      locationId: "locationId" in input ? input.locationId ?? null : undefined,
      description: input.description,
      priority: input.priority as DbRequestPriority | undefined,
      state: (input.state ??
        (nextCustomerId && nextLocationId ? currentState : "AWAITING_DETAILS")) as DbRequestState,
      reportedByName:
        "reportedByName" in input ? input.reportedByName ?? null : undefined,
    },
    include: {
      customer: { select: { businessName: true } },
      location: { select: { name: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  const mapped = mapRequestRecord(request);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REQUEST,
    entityId: mapped.id,
    eventName: "request.updated",
    beforeJson: before,
    afterJson: mapped,
  });

  return mapped;
}

export async function deleteRequest(requestId: string, actor: SessionUser) {
  const db = await getDatabaseClient();

  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      customer: {
        select: { businessName: true },
      },
      location: {
        select: { name: true },
      },
      createdBy: {
        select: { fullName: true },
      },
    },
  });

  if (!request) {
    return null;
  }

  const before = mapRequestRecord(request);

  const [appointmentCount, workOrderCount] = await Promise.all([
    db.appointment.count({
      where: { requestId },
    }),
    db.workOrder.count({
      where: { requestId },
    }),
  ]);

  if (appointmentCount > 0 || workOrderCount > 0) {
    throw new BusinessRuleError(
      "REQUEST_DELETE_BLOCKED",
      "Το αίτημα έχει συνδεδεμένα ραντεβού ή work orders. Διέγραψε πρώτα τα συνδεδεμένα δεδομένα.",
      409,
      {
        appointmentCount,
        workOrderCount,
      },
    );
  }

  await db.request.delete({
    where: { id: requestId },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REQUEST,
    entityId: requestId,
    eventName: "request.deleted",
    beforeJson: before,
  });

  return before;
}
