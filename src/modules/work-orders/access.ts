import { WorkOrderAssignmentState, WorkOrderState as DbWorkOrderState } from "@prisma/client";
import type { SessionUser } from "@/shared/auth/types";
import { getDatabaseClient } from "@/shared/db/readiness";

export type WorkOrderMutationAccessRecord = {
  id: string;
  state: DbWorkOrderState | "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "FOLLOW_UP_REQUIRED" | "READY_FOR_INVOICE" | "CANCELED";
  primaryAssigneeId: string | null;
};

export async function getWorkOrderMutationAccessRecord(
  workOrderId: string,
  actor: SessionUser,
): Promise<WorkOrderMutationAccessRecord | null> {
  const db = await getDatabaseClient();

  const workOrder = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      assignments: {
        where: { state: WorkOrderAssignmentState.ACTIVE },
        orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
        select: {
          userId: true,
        },
      },
    },
  });

  if (!workOrder) {
    return null;
  }

  const primaryAssigneeId = workOrder.assignments[0]?.userId ?? null;

  if (actor.role === "technician" && primaryAssigneeId !== actor.id) {
    return null;
  }

  return {
    id: workOrder.id,
    state: workOrder.state,
    primaryAssigneeId,
  };
}
