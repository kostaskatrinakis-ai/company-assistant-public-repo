import {
  InvoiceReminderState,
  WorkOrderAssignmentState,
  WorkOrderState,
} from "@prisma/client";
import { getDatabaseClient } from "@/shared/db/readiness";

function minutesToHoursLabel(totalMinutes: number) {
  return `${(totalMinutes / 60).toFixed(1)} h`;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

function formatMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function getApiPayload() {
  const db = await getDatabaseClient();
  const { start, end } = getTodayRange();
  const activeStates = [
    WorkOrderState.SCHEDULED,
    WorkOrderState.IN_PROGRESS,
    WorkOrderState.FOLLOW_UP_REQUIRED,
  ];

  const [
    activeWorkOrders,
    readyForInvoiceCount,
    completedToday,
    timeEntriesToday,
    materialsToday,
    remindersThisMonth,
    technicians,
    appointmentsToday,
    recentMessages,
    recentWorkOrders,
  ] = await Promise.all([
    db.workOrder.findMany({
      where: { state: { in: activeStates } },
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
        assignments: {
          where: { state: WorkOrderAssignmentState.ACTIVE },
          include: { user: { select: { fullName: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.workOrder.count({
      where: { state: WorkOrderState.READY_FOR_INVOICE },
    }),
    db.workOrder.count({
      where: {
        state: { in: [WorkOrderState.COMPLETED, WorkOrderState.READY_FOR_INVOICE] },
        updatedAt: { gte: start, lt: end },
      },
    }),
    db.timeEntry.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.materialUsage.findMany({
      where: { createdAt: { gte: start, lt: end } },
      include: {
        workOrder: {
          include: {
            customer: { select: { businessName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.invoiceReminder.findMany({
      where: {
        monthKey: formatMonthKey(),
        state: {
          in: [
            InvoiceReminderState.PENDING,
            InvoiceReminderState.QUEUED_FOR_MONTH,
            InvoiceReminderState.READY_FOR_ACCOUNTING,
          ],
        },
      },
      include: {
        customer: { select: { businessName: true } },
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
      orderBy: { updatedAt: "desc" },
    }),
    db.user.findMany({
      where: { role: "TECHNICIAN", isActive: true },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        timeEntries: {
          where: { createdAt: { gte: start, lt: end } },
          select: {
            minutesWorked: true,
            minutesTravel: true,
          },
        },
        assignedAppointments: {
          where: { startAt: { gte: start, lt: end } },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            state: true,
          },
          orderBy: { startAt: "asc" },
        },
        assignments: {
          where: {
            state: WorkOrderAssignmentState.ACTIVE,
            workOrder: {
              state: { in: activeStates },
            },
          },
          select: {
            workOrderId: true,
          },
        },
      },
    }),
    db.appointment.findMany({
      where: { startAt: { gte: start, lt: end } },
      include: {
        assignedUser: { select: { fullName: true } },
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
    }),
    db.whatsAppMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.workOrder.findMany({
      include: {
        customer: { select: { businessName: true } },
        location: { select: { name: true } },
        assignments: {
          where: { state: WorkOrderAssignmentState.ACTIVE },
          include: { user: { select: { fullName: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);

  const totalMinutesWorked = timeEntriesToday.reduce(
    (sum, entry) => sum + entry.minutesWorked + entry.minutesTravel,
    0,
  );
  const followUps = activeWorkOrders.filter(
    (workOrder) => workOrder.state === WorkOrderState.FOLLOW_UP_REQUIRED,
  ).length;

  const metrics = [
    {
      label: "Ανοιχτές εργασίες",
      value: String(activeWorkOrders.length),
      hint: "Scheduled, in progress ή follow-up required.",
    },
    {
      label: "Ώρες συνεργείου",
      value: minutesToHoursLabel(totalMinutesWorked),
      hint: "Σύνολο πεδίου και μετακίνησης σήμερα.",
    },
    {
      label: "Υλικά σήμερα",
      value: String(materialsToday.length),
      hint: "Καταχωρήσεις υλικών που περάστηκαν σήμερα.",
    },
    {
      label: "Προς τιμολόγηση",
      value: String(readyForInvoiceCount + remindersThisMonth.length),
      hint: "Ready for invoice ή active monthly reminders.",
    },
  ];

  const technicianActivity = technicians.map((technician) => {
    const totalWorkMinutes = technician.timeEntries.reduce(
      (sum, entry) => sum + entry.minutesWorked,
      0,
    );
    const totalTravelMinutes = technician.timeEntries.reduce(
      (sum, entry) => sum + entry.minutesTravel,
      0,
    );
    const nextSlot = technician.assignedAppointments.find(
      (appointment) =>
        appointment.state !== "COMPLETED" && appointment.state !== "CANCELED",
    );

    return {
      id: technician.id,
      name: technician.fullName,
      hoursToday: Number(((totalWorkMinutes + totalTravelMinutes) / 60).toFixed(2)),
      workHours: Number((totalWorkMinutes / 60).toFixed(2)),
      travelHours: Number((totalTravelMinutes / 60).toFixed(2)),
      todaysAppointments: technician.assignedAppointments.length,
      openWorkOrders: technician.assignments.length,
      nextStop: nextSlot
        ? new Intl.DateTimeFormat("el-GR", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(nextSlot.startAt)
        : null,
    };
  });

  const busiestTechnician = [...technicianActivity].sort((left, right) => {
    if (right.hoursToday !== left.hoursToday) {
      return right.hoursToday - left.hoursToday;
    }

    return right.openWorkOrders - left.openWorkOrders;
  })[0];

  const bossDigest = {
    summary:
      activeWorkOrders.length === 0 &&
      appointmentsToday.length === 0 &&
      timeEntriesToday.length === 0
        ? "Δεν έχουν καταγραφεί ακόμη σημερινές εργασίες ή ραντεβού."
        : `Σήμερα καταγράφηκαν ${minutesToHoursLabel(totalMinutesWorked)}, ${completedToday} εργασίες έκλεισαν και ${followUps} χρειάζονται follow-up.`,
    highlights: [
      appointmentsToday.length > 0
        ? `${appointmentsToday.length} ραντεβού είναι περασμένα για σήμερα.`
        : "Δεν υπάρχουν ραντεβού περασμένα για σήμερα.",
      materialsToday.length > 0
        ? `${materialsToday.length} γραμμές υλικών έχουν ήδη καταχωρηθεί σήμερα.`
        : "Δεν έχουν περαστεί ακόμη υλικά σήμερα.",
      busiestTechnician
        ? `${busiestTechnician.name}: ${busiestTechnician.hoursToday.toFixed(1)} ώρες και ${busiestTechnician.openWorkOrders} ανοιχτές εργασίες.`
        : "Δεν υπάρχουν ακόμη τεχνικοί με σημερινή δραστηριότητα.",
      remindersThisMonth.length > 0
        ? `Υπάρχουν ${remindersThisMonth.length} ενεργές υπενθυμίσεις τιμολόγησης για τον μήνα.`
        : "Δεν υπάρχουν ακόμη ενεργές υπενθυμίσεις τιμολόγησης για τον μήνα.",
    ],
  };

  return {
    generatedAt: new Date().toISOString(),
    metrics,
    bossDigest,
    workOrders: recentWorkOrders.map((workOrder) => ({
      id: workOrder.id,
      customer: workOrder.customer.businessName,
      site: workOrder.location.name,
      issue: workOrder.issueSummary,
      status: workOrder.state,
      assignedTo:
        workOrder.assignments.find((assignment) => assignment.isPrimary)?.user.fullName ??
        workOrder.assignments[0]?.user.fullName ??
        null,
      updatedAt: workOrder.updatedAt.toISOString(),
    })),
    technicians: technicianActivity,
    reminders: remindersThisMonth.map((reminder) => ({
      id: reminder.id,
      customer: reminder.customer.businessName,
      monthKey: reminder.monthKey,
      state: reminder.state,
      estimatedTotal: reminder.estimatedTotal.toNumber(),
      note: reminder.note,
      workOrders: reminder.workOrders.map((link) => ({
        id: link.workOrder.id,
        issueSummary: link.workOrder.issueSummary,
      })),
    })),
    whatsappFeed: recentMessages.map((message) => ({
      id: message.id,
      createdAt: message.createdAt.toISOString(),
      direction: message.direction,
      senderPhone: message.senderPhone,
      receiverPhone: message.receiverPhone,
      body: message.body,
      linkedEntityType: message.linkedEntityType,
      linkedEntityId: message.linkedEntityId,
      processedStatus: message.processedStatus,
    })),
  };
}
