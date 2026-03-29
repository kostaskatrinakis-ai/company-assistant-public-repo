import {
  AuditActorSource,
  DomainEntityType,
} from "@prisma/client";
import { recordAuditEvent } from "@/modules/audit/service";
import type { MaterialUsageRecord } from "@/modules/operations/types";
import { getWorkOrderMutationAccessRecord } from "@/modules/work-orders/access";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import type { SessionUser } from "@/shared/auth/types";
import { getDatabaseClient } from "@/shared/db/readiness";

function mapMaterialUsageRecord(material: {
  id: string;
  workOrderId: string;
  description: string;
  quantity: { toString(): string } | number | string;
  unit: string;
  estimatedCost: { toString(): string } | number | string | null;
  createdByUserId: string;
  createdAt: Date;
  createdBy: { fullName: string };
}): MaterialUsageRecord {
  return {
    id: material.id,
    workOrderId: material.workOrderId,
    description: material.description,
    quantity: String(material.quantity),
    unit: material.unit,
    estimatedCost:
      material.estimatedCost === null ? null : String(material.estimatedCost),
    createdByUserId: material.createdByUserId,
    createdByUserName: material.createdBy.fullName,
    createdAt: material.createdAt.toISOString(),
  };
}

export async function createMaterialUsage(
  workOrderId: string,
  input: {
    description: string;
    quantity: number;
    unit: string;
    estimatedCost?: number | null;
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
      "Δεν μπορεί να προστεθεί υλικό σε ακυρωμένο ή invoice-ready work order.",
      409,
    );
  }

  const db = await getDatabaseClient();

  const material = await db.materialUsage.create({
    data: {
      workOrderId,
      description: input.description,
      quantity: input.quantity,
      unit: input.unit,
      estimatedCost: input.estimatedCost ?? null,
      createdByUserId: actor.id,
    },
    include: {
      createdBy: {
        select: { fullName: true },
      },
    },
  });

  const mapped = mapMaterialUsageRecord(material);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.WORK_ORDER,
    entityId: workOrderId,
    eventName: "work_order.material.created",
    afterJson: mapped,
  });

  return mapped;
}
