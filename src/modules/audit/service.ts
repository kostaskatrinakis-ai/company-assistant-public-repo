import { AuditActorSource, DomainEntityType } from "@prisma/client";
import { getDatabaseClient } from "@/shared/db/readiness";

type AuditInput = {
  actorUserId?: string | null;
  actorSource: AuditActorSource;
  entityType: DomainEntityType;
  entityId?: string | null;
  eventName: string;
  beforeJson?: unknown;
  afterJson?: unknown;
};

export async function recordAuditEvent(input: AuditInput) {
  const db = await getDatabaseClient();

  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      actorSource: input.actorSource,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      eventName: input.eventName,
      beforeJson: input.beforeJson ? JSON.parse(JSON.stringify(input.beforeJson)) : undefined,
      afterJson: input.afterJson ? JSON.parse(JSON.stringify(input.afterJson)) : undefined,
    },
  });
}
