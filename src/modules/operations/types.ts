export const requestSourceChannels = ["PHONE", "WHATSAPP", "APP", "MANUAL"] as const;
export const requestPriorities = ["URGENT", "TODAY", "PLANNED"] as const;
export const requestStates = [
  "NEW",
  "AWAITING_DETAILS",
  "READY_TO_SCHEDULE",
  "SCHEDULED",
  "CANCELED",
  "CONVERTED",
] as const;
export const appointmentStates = [
  "DRAFT",
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "MISSED",
  "RESCHEDULED",
  "CANCELED",
] as const;
export const workOrderStates = [
  "DRAFT",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "FOLLOW_UP_REQUIRED",
  "READY_FOR_INVOICE",
  "CANCELED",
] as const;

export type RequestSourceChannel = (typeof requestSourceChannels)[number];
export type RequestPriority = (typeof requestPriorities)[number];
export type RequestState = (typeof requestStates)[number];
export type AppointmentState = (typeof appointmentStates)[number];
export type WorkOrderState = (typeof workOrderStates)[number];

export type LocationRecord = {
  id: string;
  customerId: string;
  name: string;
  address: string;
  city?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
};

export type CustomerRecord = {
  id: string;
  businessName: string;
  vatNumber?: string | null;
  mainPhone?: string | null;
  mainEmail?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  createdByUserName?: string | null;
  locations: LocationRecord[];
};

export type RequestRecord = {
  id: string;
  customerId?: string | null;
  customerName?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  sourceChannel: RequestSourceChannel;
  description: string;
  priority: RequestPriority;
  state: RequestState;
  reportedByName?: string | null;
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentRecord = {
  id: string;
  requestId?: string | null;
  workOrderId?: string | null;
  assignedUserId: string;
  assignedUserName: string;
  startAt: string;
  endAt?: string | null;
  state: AppointmentState;
  reasonNote?: string | null;
  createdByUserId: string;
  createdByUserName: string;
  updatedByUserId?: string | null;
  updatedByUserName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkOrderRecord = {
  id: string;
  requestId?: string | null;
  customerId: string;
  customerName: string;
  locationId: string;
  locationName: string;
  state: WorkOrderState;
  issueSummary: string;
  resolutionSummary?: string | null;
  followUpReason?: string | null;
  invoiceReadyAt?: string | null;
  primaryAssigneeId?: string | null;
  primaryAssigneeName?: string | null;
  createdByUserId: string;
  createdByUserName: string;
  closedByUserId?: string | null;
  closedByUserName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeEntryRecord = {
  id: string;
  workOrderId: string;
  userId: string;
  userName: string;
  minutesWorked: number;
  minutesTravel: number;
  note?: string | null;
  createdAt: string;
};

export type MaterialUsageRecord = {
  id: string;
  workOrderId: string;
  description: string;
  quantity: string;
  unit: string;
  estimatedCost?: string | null;
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
};
