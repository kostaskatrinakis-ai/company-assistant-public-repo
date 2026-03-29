import { listAppointments } from "@/modules/appointments/service";
import { listCustomers } from "@/modules/customers/service";
import { listRequests } from "@/modules/requests/service";
import type {
  AppointmentRecord,
  RequestPriority,
  RequestRecord,
  RequestSourceChannel,
  WorkOrderRecord,
} from "@/modules/operations/types";
import { listUsers } from "@/modules/users/service";
import { listWorkOrders } from "@/modules/work-orders/service";
import type { SessionUser } from "@/shared/auth/types";
import { getIntlLocale, translate, type UiLocale } from "@/shared/ui/types";

const dashboardTimeZone = "Europe/Athens";
const requestActionStates = new Set(["AWAITING_DETAILS", "NEW", "READY_TO_SCHEDULE"]);
const activeWorkOrderStates = new Set(["SCHEDULED", "IN_PROGRESS", "FOLLOW_UP_REQUIRED"]);

type DashboardMetric = {
  label: string;
  value: string;
  hint: string;
};

type DashboardDigest = {
  summary: string;
  highlights: string[];
};

export type DashboardRequestItem = RequestRecord & {
  updatedAtLabel: string;
};

export type DashboardAppointmentItem = AppointmentRecord & {
  customerName: string | null;
  locationName: string | null;
  issueSummary: string | null;
  slotLabel: string;
  requestPriority: RequestPriority | null;
  requestSourceChannel: RequestSourceChannel | null;
};

export type DashboardWorkOrderItem = WorkOrderRecord & {
  slotLabel: string | null;
  requestPriority: RequestPriority | null;
  requestSourceChannel: RequestSourceChannel | null;
};

export type TechnicianLoadItem = {
  id: string;
  name: string;
  todaysAppointments: number;
  openWorkOrders: number;
  scheduledHoursLabel: string;
  nextSlotLabel: string | null;
};

export type OperationsDashboardSnapshot = {
  metrics: DashboardMetric[];
  bossDigest: DashboardDigest;
  totalCustomers: number;
  requestsNeedingAction: DashboardRequestItem[];
  appointmentsToday: DashboardAppointmentItem[];
  activeWorkOrders: DashboardWorkOrderItem[];
  followUpQueue: DashboardWorkOrderItem[];
  readyForInvoiceQueue: DashboardWorkOrderItem[];
  technicianLoad: TechnicianLoadItem[];
};

export type TechnicianDashboardSnapshot = {
  metrics: DashboardMetric[];
  todaysAppointments: DashboardAppointmentItem[];
  openWorkOrders: DashboardWorkOrderItem[];
  completedWorkOrders: DashboardWorkOrderItem[];
};

function formatDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: dashboardTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function isToday(value: string | Date) {
  return formatDateKey(value) === formatDateKey(new Date());
}

function formatTime(value: string | Date, locale: UiLocale) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: dashboardTimeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string | Date, locale: UiLocale) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: dashboardTimeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAppointmentSlot(
  startAt: string,
  endAt: string | null | undefined,
  locale: UiLocale,
) {
  const startLabel = formatTime(startAt, locale);
  if (!endAt) {
    return `${startLabel} ->`;
  }

  return `${startLabel} - ${formatTime(endAt, locale)}`;
}

function calculateHours(startAt: string, endAt?: string | null) {
  if (!endAt) {
    return 0;
  }

  const diffMs = new Date(endAt).getTime() - new Date(startAt).getTime();
  return Math.max(diffMs / (1000 * 60 * 60), 0);
}

function compareByIsoAsc<T extends { startAt: string }>(left: T, right: T) {
  return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
}

function compareByIsoDesc<T extends { updatedAt: string }>(left: T, right: T) {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function buildAppointmentItems(params: {
  appointments: AppointmentRecord[];
  requests: RequestRecord[];
  workOrders: WorkOrderRecord[];
  locale: UiLocale;
}) {
  const requestMap = new Map(params.requests.map((request) => [request.id, request]));
  const workOrderMap = new Map(
    params.workOrders.map((workOrder) => [workOrder.id, workOrder]),
  );

  return params.appointments
    .map<DashboardAppointmentItem>((appointment) => {
      const workOrder = appointment.workOrderId
        ? workOrderMap.get(appointment.workOrderId)
        : null;
      const request = appointment.requestId
        ? requestMap.get(appointment.requestId)
        : workOrder?.requestId
          ? requestMap.get(workOrder.requestId)
          : null;

      return {
        ...appointment,
        customerName: workOrder?.customerName ?? request?.customerName ?? null,
        locationName: workOrder?.locationName ?? request?.locationName ?? null,
        issueSummary: workOrder?.issueSummary ?? request?.description ?? null,
        slotLabel: formatAppointmentSlot(appointment.startAt, appointment.endAt, params.locale),
        requestPriority: request?.priority ?? null,
        requestSourceChannel: request?.sourceChannel ?? null,
      };
    })
    .sort(compareByIsoAsc);
}

function buildWorkOrderItems(params: {
  workOrders: WorkOrderRecord[];
  requests: RequestRecord[];
  appointments: AppointmentRecord[];
  locale: UiLocale;
}) {
  const requestMap = new Map(params.requests.map((request) => [request.id, request]));
  const latestAppointmentByWorkOrder = new Map<string, AppointmentRecord>();

  for (const appointment of params.appointments) {
    if (!appointment.workOrderId) {
      continue;
    }

    const existing = latestAppointmentByWorkOrder.get(appointment.workOrderId);
    if (!existing || new Date(appointment.startAt) > new Date(existing.startAt)) {
      latestAppointmentByWorkOrder.set(appointment.workOrderId, appointment);
    }
  }

  return params.workOrders.map<DashboardWorkOrderItem>((workOrder) => {
    const request = workOrder.requestId ? requestMap.get(workOrder.requestId) : null;
    const appointment = latestAppointmentByWorkOrder.get(workOrder.id);

    return {
      ...workOrder,
      slotLabel: appointment
        ? formatAppointmentSlot(appointment.startAt, appointment.endAt, params.locale)
        : null,
      requestPriority: request?.priority ?? null,
      requestSourceChannel: request?.sourceChannel ?? null,
    };
  });
}

function buildTechnicianLoad(params: {
  appointments: DashboardAppointmentItem[];
  workOrders: DashboardWorkOrderItem[];
  technicianUsers: Array<{ id: string; fullName: string }>;
}) {
  return params.technicianUsers.map<TechnicianLoadItem>((technician) => {
    const todaysAppointments = params.appointments.filter(
      (appointment) => appointment.assignedUserId === technician.id,
    );
    const openWorkOrders = params.workOrders.filter(
      (workOrder) =>
        workOrder.primaryAssigneeId === technician.id &&
        activeWorkOrderStates.has(workOrder.state),
    );
    const nextAppointment = todaysAppointments.find(
      (appointment) =>
        appointment.state !== "COMPLETED" &&
        appointment.state !== "CANCELED",
    );
    const scheduledHours = todaysAppointments.reduce((sum, appointment) => {
      return sum + calculateHours(appointment.startAt, appointment.endAt);
    }, 0);

    return {
      id: technician.id,
      name: technician.fullName,
      todaysAppointments: todaysAppointments.length,
      openWorkOrders: openWorkOrders.length,
      scheduledHoursLabel: `${scheduledHours.toFixed(1)} h`,
      nextSlotLabel: nextAppointment?.slotLabel ?? null,
    };
  });
}

function buildBossDigest(snapshot: {
  requestsNeedingAction: DashboardRequestItem[];
  activeWorkOrders: DashboardWorkOrderItem[];
  readyForInvoiceQueue: DashboardWorkOrderItem[];
  appointmentsToday: DashboardAppointmentItem[];
  technicianLoad: TechnicianLoadItem[];
  locale: UiLocale;
}) {
  const followUps = snapshot.activeWorkOrders.filter(
    (workOrder) => workOrder.state === "FOLLOW_UP_REQUIRED",
  ).length;

  const busiestTechnician = [...snapshot.technicianLoad].sort((left, right) => {
    if (right.todaysAppointments !== left.todaysAppointments) {
      return right.todaysAppointments - left.todaysAppointments;
    }

    return right.openWorkOrders - left.openWorkOrders;
  })[0];

  return {
    summary: translate(snapshot.locale, {
      el: `Σήμερα υπάρχουν ${snapshot.appointmentsToday.length} ραντεβού, ${snapshot.activeWorkOrders.length} ανοιχτά work orders και ${snapshot.readyForInvoiceQueue.length} περιστατικά προς τιμολόγηση.`,
      en: `Today there are ${snapshot.appointmentsToday.length} appointments, ${snapshot.activeWorkOrders.length} open work orders, and ${snapshot.readyForInvoiceQueue.length} cases ready for invoicing.`,
    }),
    highlights: [
      snapshot.requestsNeedingAction.length > 0
        ? translate(snapshot.locale, {
            el: `${snapshot.requestsNeedingAction.length} requests χρειάζονται operator ενέργεια ή συμπλήρωση στοιχείων.`,
            en: `${snapshot.requestsNeedingAction.length} requests need operator action or more details.`,
          })
        : translate(snapshot.locale, {
            el: "Δεν υπάρχουν requests που να περιμένουν στοιχεία ή προγραμματισμό.",
            en: "There are no requests waiting for details or scheduling.",
          }),
      followUps > 0
        ? translate(snapshot.locale, {
            el: `${followUps} work orders ζητούν follow-up επίσκεψη.`,
            en: `${followUps} work orders require a follow-up visit.`,
          })
        : translate(snapshot.locale, {
            el: "Δεν υπάρχει ανοιχτό follow-up στο τρέχον queue.",
            en: "There is no open follow-up in the current queue.",
          }),
      busiestTechnician
        ? translate(snapshot.locale, {
            el: `${busiestTechnician.name}: ${busiestTechnician.todaysAppointments} ραντεβού και ${busiestTechnician.scheduledHoursLabel} προγραμματισμένος χρόνος.`,
            en: `${busiestTechnician.name}: ${busiestTechnician.todaysAppointments} appointments and ${busiestTechnician.scheduledHoursLabel} scheduled time.`,
          })
        : translate(snapshot.locale, {
            el: "Δεν υπάρχει ακόμη φόρτος αναθέσεων για τεχνικούς.",
            en: "There is no technician assignment load yet.",
          }),
    ],
  };
}

function buildMetrics(snapshot: {
  totalCustomers: number;
  requestsNeedingAction: DashboardRequestItem[];
  appointmentsToday: DashboardAppointmentItem[];
  activeWorkOrders: DashboardWorkOrderItem[];
  readyForInvoiceQueue: DashboardWorkOrderItem[];
  locale: UiLocale;
}) {
  return [
    {
      label: translate(snapshot.locale, { el: "Πελάτες", en: "Customers" }),
      value: String(snapshot.totalCustomers),
      hint: translate(snapshot.locale, {
        el: "Σύνολο εταιρικών λογαριασμών με ενεργά στοιχεία στο πρόγραμμα.",
        en: "Total company accounts with active records in the app.",
      }),
    },
    {
      label: translate(snapshot.locale, { el: "Requests σε αναμονή", en: "Pending requests" }),
      value: String(snapshot.requestsNeedingAction.length),
      hint: translate(snapshot.locale, {
        el: "Νέα αιτήματα, ελλιπή στοιχεία ή περιπτώσεις που θέλουν scheduling.",
        en: "New requests, incomplete details, or cases that need scheduling.",
      }),
    },
    {
      label: translate(snapshot.locale, { el: "Ραντεβού σήμερα", en: "Appointments today" }),
      value: String(snapshot.appointmentsToday.length),
      hint: translate(snapshot.locale, {
        el: "Ημερήσιο πρόγραμμα συνεργείου για το σημερινό operations view.",
        en: "Daily field schedule for today's operations view.",
      }),
    },
    {
      label: translate(snapshot.locale, {
        el: "Έτοιμα για τιμολόγηση",
        en: "Ready for invoicing",
      }),
      value: String(snapshot.readyForInvoiceQueue.length),
      hint: translate(snapshot.locale, {
        el: "Work orders που μπορούν να περάσουν σε μηνιαία υπενθύμιση.",
        en: "Work orders that can move into the monthly reminder flow.",
      }),
    },
    {
      label: translate(snapshot.locale, { el: "Ανοιχτά work orders", en: "Open work orders" }),
      value: String(snapshot.activeWorkOrders.length),
      hint: translate(snapshot.locale, {
        el: "Προγραμματισμένα, σε εξέλιξη ή με follow-up requirement.",
        en: "Scheduled, in progress, or requiring follow-up.",
      }),
    },
  ];
}

async function loadOperationsData(user: SessionUser, locale: UiLocale) {
  const [customers, requests, appointments, workOrders, users] = await Promise.all([
    listCustomers(),
    listRequests(),
    listAppointments(user),
    listWorkOrders(user),
    listUsers(),
  ]);

  const requestQueue = requests
    .filter((request) => requestActionStates.has(request.state))
    .sort(compareByIsoDesc)
    .map<DashboardRequestItem>((request) => ({
      ...request,
      updatedAtLabel: formatDateTime(request.updatedAt, locale),
    }));
  const appointmentItems = buildAppointmentItems({
    appointments: appointments.filter((appointment) => isToday(appointment.startAt)),
    requests,
    workOrders,
    locale,
  });
  const workOrderItems = buildWorkOrderItems({
    workOrders,
    requests,
    appointments,
    locale,
  });
  const activeWorkOrders = workOrderItems.filter((workOrder) =>
    activeWorkOrderStates.has(workOrder.state),
  );
  const readyForInvoiceQueue = workOrderItems.filter(
    (workOrder) => workOrder.state === "READY_FOR_INVOICE",
  );
  const technicianUsers = users
    .filter((candidate) => candidate.role === "technician" && candidate.isActive)
    .map((technician) => ({
      id: technician.id,
      fullName: technician.fullName,
    }));
  const technicianLoad = buildTechnicianLoad({
    appointments: appointmentItems,
    workOrders: workOrderItems,
    technicianUsers,
  });

  return {
    requests,
    appointments,
    workOrders,
    totalCustomers: customers.length,
    requestsNeedingAction: requestQueue,
    appointmentsToday: appointmentItems,
    activeWorkOrders,
    followUpQueue: workOrderItems.filter(
      (workOrder) => workOrder.state === "FOLLOW_UP_REQUIRED",
    ),
    readyForInvoiceQueue,
    technicianLoad,
  };
}

export async function getOperationsDashboardSnapshot(
  user: SessionUser,
  locale: UiLocale,
): Promise<OperationsDashboardSnapshot> {
  const data = await loadOperationsData(user, locale);

  return {
    ...data,
    metrics: buildMetrics({ ...data, locale }),
    bossDigest: buildBossDigest({ ...data, locale }),
  };
}

export async function getTechnicianDashboardSnapshot(
  user: SessionUser,
  locale: UiLocale,
): Promise<TechnicianDashboardSnapshot> {
  const data = await loadOperationsData(user, locale);
  const myAppointments = data.appointmentsToday.filter(
    (appointment) => appointment.assignedUserId === user.id,
  );
  const myWorkOrders = [...data.activeWorkOrders, ...data.readyForInvoiceQueue].filter(
    (workOrder) => workOrder.primaryAssigneeId === user.id,
  );
  const completedWorkOrders = data.workOrders.filter(
    (workOrder) => workOrder.state === "COMPLETED" && workOrder.primaryAssigneeId === user.id,
  );
  const completedItems = buildWorkOrderItems({
    workOrders: completedWorkOrders,
    requests: data.requests,
    appointments: data.appointments,
    locale,
  });

  return {
    metrics: [
      {
        label: translate(locale, { el: "Ραντεβού σήμερα", en: "Appointments today" }),
        value: String(myAppointments.length),
        hint: translate(locale, {
          el: "Το σημερινό πρόγραμμα που σου έχει ανατεθεί.",
          en: "Today's schedule assigned to you.",
        }),
      },
      {
        label: translate(locale, { el: "Ανοιχτές εργασίες", en: "Open work orders" }),
        value: String(myWorkOrders.length),
        hint: translate(locale, {
          el: "Αναθέσεις που είναι scheduled, in progress ή περιμένουν follow-up.",
          en: "Assignments that are scheduled, in progress, or waiting for follow-up.",
        }),
      },
      {
        label: "Follow-up",
        value: String(
          myWorkOrders.filter((workOrder) => workOrder.state === "FOLLOW_UP_REQUIRED")
            .length,
        ),
        hint: translate(locale, {
          el: "Εργασίες που χρειάζονται δεύτερη ενέργεια από το συνεργείο.",
          en: "Jobs that need a second action from the field team.",
        }),
      },
      {
        label: translate(locale, { el: "Κλεισμένες εργασίες", en: "Completed work" }),
        value: String(completedItems.length),
        hint: translate(locale, {
          el: "Ολοκληρωμένες δικές σου δουλειές που έχουν ήδη περαστεί στο σύστημα.",
          en: "Your completed jobs that are already recorded in the system.",
        }),
      },
    ],
    todaysAppointments: myAppointments,
    openWorkOrders: myWorkOrders,
    completedWorkOrders: completedItems,
  };
}
