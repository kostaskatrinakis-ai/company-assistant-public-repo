import {
  AuditActorSource,
  DomainEntityType,
  InvoiceReminderState,
  Prisma,
  UserRole,
  WorkOrderState,
} from "@prisma/client";
import { recordAuditEvent } from "@/modules/audit/service";
import { sendWhatsAppTextMessage } from "@/modules/whatsapp/outbound";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";
import type { SessionUser } from "@/shared/auth/types";

export type ReminderRecord = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  monthKey: string;
  state: InvoiceReminderState;
  estimatedTotal: string;
  note: string | null;
  createdByUserName: string | null;
  updatedByUserName: string | null;
  workOrders: Array<{
    id: string;
    issueSummary: string;
    state: WorkOrderState;
  }>;
  createdAt: string;
  updatedAt: string;
};

function mapReminder(reminder: {
  id: string;
  customerId: string;
  monthKey: string;
  state: InvoiceReminderState;
  estimatedTotal: Prisma.Decimal;
  note: string | null;
  createdByUserNameSnapshot?: string | null;
  updatedByUserNameSnapshot?: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { businessName: string; mainPhone: string | null };
  createdBy: { fullName: string };
  updatedBy: { fullName: string } | null;
  workOrders: Array<{
    workOrder: {
      id: string;
      issueSummary: string;
      state: WorkOrderState;
    };
  }>;
}): ReminderRecord {
  return {
    id: reminder.id,
    customerId: reminder.customerId,
    customerName: reminder.customer.businessName,
    customerPhone: reminder.customer.mainPhone,
    monthKey: reminder.monthKey,
    state: reminder.state,
    estimatedTotal: reminder.estimatedTotal.toFixed(2),
    note: reminder.note,
    createdByUserName:
      reminder.createdByUserNameSnapshot ?? reminder.createdBy.fullName ?? null,
    updatedByUserName:
      reminder.updatedByUserNameSnapshot ?? reminder.updatedBy?.fullName ?? null,
    workOrders: reminder.workOrders.map((link) => ({
      id: link.workOrder.id,
      issueSummary: link.workOrder.issueSummary,
      state: link.workOrder.state,
    })),
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

function getMonthKey(input?: string) {
  if (input) {
    return input;
  }

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

async function assertWorkOrdersBelongToCustomer(customerId: string, workOrderIds: string[]) {
  const db = await getDatabaseClient();
  const workOrders = await db.workOrder.findMany({
    where: {
      id: { in: workOrderIds },
    },
    select: {
      id: true,
      customerId: true,
      state: true,
    },
  });

  if (workOrders.length !== workOrderIds.length) {
    throw new BusinessRuleError(
      "REMINDER_WORK_ORDER_NOT_FOUND",
      "Κάποιο work order για το reminder δεν βρέθηκε.",
      404,
    );
  }

  if (workOrders.some((workOrder) => workOrder.customerId !== customerId)) {
    throw new BusinessRuleError(
      "REMINDER_CUSTOMER_MISMATCH",
      "Όλα τα work orders του reminder πρέπει να ανήκουν στον ίδιο πελάτη.",
      422,
    );
  }

  if (
    workOrders.some(
      (workOrder) =>
        workOrder.state !== WorkOrderState.READY_FOR_INVOICE &&
        workOrder.state !== WorkOrderState.COMPLETED,
    )
  ) {
    throw new BusinessRuleError(
      "REMINDER_WORK_ORDER_NOT_READY",
      "Reminder μπορεί να συνδεθεί μόνο με work order που είναι ολοκληρωμένο ή ready for invoice.",
      422,
    );
  }
}

export async function listInvoiceReminders() {
  const db = await getDatabaseClient();
  const reminders = await db.invoiceReminder.findMany({
    include: {
      customer: {
        select: { businessName: true, mainPhone: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
      workOrders: {
        include: {
          workOrder: {
            select: {
              id: true,
              issueSummary: true,
              state: true,
            },
          },
        },
      },
    },
    orderBy: [{ monthKey: "desc" }, { updatedAt: "desc" }],
  });

  return reminders.map(mapReminder);
}

export async function createInvoiceReminder(
  input: {
    customerId: string;
    workOrderIds: string[];
    estimatedTotal: number;
    monthKey?: string;
    note?: string | null;
  },
  actor: SessionUser,
) {
  const db = await getDatabaseClient();
  const monthKey = getMonthKey(input.monthKey);

  await assertWorkOrdersBelongToCustomer(input.customerId, input.workOrderIds);

  const existing = await db.invoiceReminder.findUnique({
    where: {
      customerId_monthKey: {
        customerId: input.customerId,
        monthKey,
      },
    },
    include: {
      customer: {
        select: { businessName: true, mainPhone: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
      workOrders: {
        include: {
          workOrder: {
            select: {
              id: true,
              issueSummary: true,
              state: true,
            },
          },
        },
      },
    },
  });

  if (existing) {
    const existingWorkOrderIds = new Set(existing.workOrders.map((link) => link.workOrder.id));
    const workOrderIdsToAdd = input.workOrderIds.filter((id) => !existingWorkOrderIds.has(id));

    const updated = await db.invoiceReminder.update({
      where: { id: existing.id },
      data: {
        estimatedTotal: new Prisma.Decimal(input.estimatedTotal),
        note: input.note ?? null,
        updatedByUserId: actor.id,
        updatedByUserNameSnapshot: actor.fullName,
        workOrders: workOrderIdsToAdd.length
          ? {
              createMany: {
                data: workOrderIdsToAdd.map((workOrderId) => ({
                  workOrderId,
                })),
              },
            }
          : undefined,
      },
      include: {
        customer: {
          select: { businessName: true, mainPhone: true },
        },
        createdBy: {
          select: { fullName: true },
        },
        updatedBy: {
          select: { fullName: true },
        },
        workOrders: {
          include: {
            workOrder: {
              select: {
                id: true,
                issueSummary: true,
                state: true,
              },
            },
          },
        },
      },
    });

    const mapped = mapReminder(updated);

    await recordAuditEvent({
      actorUserId: actor.id,
      actorSource: AuditActorSource.APP,
      entityType: DomainEntityType.REMINDER,
      entityId: mapped.id,
      eventName: "invoice_reminder.updated",
      afterJson: mapped,
    });

    return mapped;
  }

  let created;

  try {
    created = await db.invoiceReminder.create({
      data: {
        customerId: input.customerId,
        monthKey,
        estimatedTotal: new Prisma.Decimal(input.estimatedTotal),
        note: input.note ?? null,
        createdByUserId: actor.id,
        createdByUserNameSnapshot: actor.fullName,
        updatedByUserId: actor.id,
        updatedByUserNameSnapshot: actor.fullName,
        workOrders: {
          createMany: {
            data: input.workOrderIds.map((workOrderId) => ({
              workOrderId,
            })),
          },
        },
      },
      include: {
        customer: {
          select: { businessName: true, mainPhone: true },
        },
        createdBy: {
          select: { fullName: true },
        },
        updatedBy: {
          select: { fullName: true },
        },
        workOrders: {
          include: {
            workOrder: {
              select: {
                id: true,
                issueSummary: true,
                state: true,
              },
            },
          },
        },
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return createInvoiceReminder(
        {
          ...input,
          monthKey,
        },
        actor,
      );
    }

    throw error;
  }

  const mapped = mapReminder(created);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REMINDER,
    entityId: mapped.id,
    eventName: "invoice_reminder.created",
    afterJson: mapped,
  });

  return mapped;
}

export async function updateInvoiceReminder(
  reminderId: string,
  input: Partial<{
    estimatedTotal: number;
    note: string | null;
    state: InvoiceReminderState;
  }>,
  actor: SessionUser,
) {
  const db = await getDatabaseClient();
  const before = await db.invoiceReminder.findUnique({
    where: { id: reminderId },
    include: {
      customer: {
        select: { businessName: true, mainPhone: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
      workOrders: {
        include: {
          workOrder: {
            select: {
              id: true,
              issueSummary: true,
              state: true,
            },
          },
        },
      },
    },
  });

  if (!before) {
    return null;
  }

  const updated = await db.invoiceReminder.update({
    where: { id: reminderId },
    data: {
      estimatedTotal:
        typeof input.estimatedTotal === "number"
          ? new Prisma.Decimal(input.estimatedTotal)
          : undefined,
      note: "note" in input ? input.note ?? null : undefined,
      state: input.state,
      updatedByUserId: actor.id,
      updatedByUserNameSnapshot: actor.fullName,
    },
    include: {
      customer: {
        select: { businessName: true, mainPhone: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
      workOrders: {
        include: {
          workOrder: {
            select: {
              id: true,
              issueSummary: true,
              state: true,
            },
          },
        },
      },
    },
  });

  const beforeMapped = mapReminder(before);
  const mapped = mapReminder(updated);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REMINDER,
    entityId: mapped.id,
    eventName: "invoice_reminder.updated",
    beforeJson: beforeMapped,
    afterJson: mapped,
  });

  return mapped;
}

export async function queueInvoiceReminder(reminderId: string, actor: SessionUser) {
  return updateInvoiceReminder(
    reminderId,
    { state: InvoiceReminderState.QUEUED_FOR_MONTH },
    actor,
  );
}

export async function markInvoiceReminderReadyForAccounting(
  reminderId: string,
  actor: SessionUser,
) {
  return updateInvoiceReminder(
    reminderId,
    { state: InvoiceReminderState.READY_FOR_ACCOUNTING },
    actor,
  );
}

export async function sendInvoiceReminderHandoff(
  reminderId: string,
  actor: SessionUser,
) {
  const db = await getDatabaseClient();
  const reminder = await db.invoiceReminder.findUnique({
    where: { id: reminderId },
    include: {
      customer: {
        select: { businessName: true },
      },
      workOrders: {
        include: {
          workOrder: {
            select: {
              id: true,
              issueSummary: true,
            },
          },
        },
      },
    },
  });

  if (!reminder) {
    throw new BusinessRuleError(
      "REMINDER_NOT_FOUND",
      "Το reminder δεν βρέθηκε.",
      404,
    );
  }

  const recipients = await db.user.findMany({
    where: {
      isActive: true,
      role: {
        in: [UserRole.ADMIN, UserRole.OWNER],
      },
      phoneNumber: {
        not: null,
      },
    },
    select: {
      phoneNumber: true,
    },
  });

  if (recipients.length === 0) {
    throw new BusinessRuleError(
      "REMINDER_HANDOFF_RECIPIENTS_MISSING",
      "Δεν υπάρχουν ενεργοί admin ή owner με τηλέφωνο για WhatsApp handoff.",
      422,
    );
  }

  const body =
    `Invoice handoff ${reminder.monthKey}\n` +
    `Customer: ${reminder.customer.businessName}\n` +
    `Estimated total: ${reminder.estimatedTotal.toFixed(2)}\n` +
    `Work orders: ${reminder.workOrders.map((item) => item.workOrder.id).join(", ")}`;

  const sent = await Promise.all(
    recipients
      .map((recipient) => recipient.phoneNumber)
      .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber))
      .map((phoneNumber) =>
        sendWhatsAppTextMessage({
          to: phoneNumber,
          body,
          actor,
          linkedEntityType: DomainEntityType.REMINDER,
          linkedEntityId: reminder.id,
        }),
      ),
  );

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REMINDER,
    entityId: reminder.id,
    eventName: "invoice_reminder.handoff_sent",
    afterJson: {
      recipients: sent.map((item) => item.receiverPhone),
    },
  });

  return {
    reminderId: reminder.id,
    sentCount: sent.length,
  };
}

export async function deleteInvoiceReminder(reminderId: string, actor: SessionUser) {
  const db = await getDatabaseClient();
  const reminder = await db.invoiceReminder.findUnique({
    where: { id: reminderId },
    include: {
      customer: {
        select: { businessName: true, mainPhone: true },
      },
      createdBy: {
        select: { fullName: true },
      },
      updatedBy: {
        select: { fullName: true },
      },
      workOrders: {
        include: {
          workOrder: {
            select: {
              id: true,
              issueSummary: true,
              state: true,
            },
          },
        },
      },
    },
  });

  if (!reminder) {
    return null;
  }

  const before = mapReminder(reminder);

  await db.invoiceReminder.delete({
    where: { id: reminderId },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.REMINDER,
    entityId: reminderId,
    eventName: "invoice_reminder.deleted",
    beforeJson: before,
  });

  return before;
}
