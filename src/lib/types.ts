export type Priority = "urgent" | "today" | "planned";

export type WorkOrderStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "follow_up"
  | "ready_for_invoice";

export type TechnicianState = "driving" | "on_site" | "standby";

export type Metric = {
  label: string;
  value: string;
  hint: string;
};

export type TechnicianActivity = {
  id: string;
  name: string;
  state: TechnicianState;
  currentLocation: string;
  nextStop: string;
  hoursToday: number;
  travelHours: number;
  workHours: number;
  materialsLogged: number;
};

export type WorkOrder = {
  id: string;
  customer: string;
  site: string;
  issue: string;
  assignedTo: string;
  slot: string;
  priority: Priority;
  status: WorkOrderStatus;
  materials: string[];
  estimatedAmount: number;
  source: "whatsapp" | "web" | "operator";
};

export type InvoiceReminder = {
  id: string;
  customer: string;
  amountEstimate: number;
  workOrderIds: string[];
  monthLabel: string;
  note: string;
};

export type WhatsappEvent = {
  id: string;
  time: string;
  sender: string;
  direction: "incoming" | "outgoing";
  body: string;
  linkedWorkOrderId?: string;
};

export type BossDigest = {
  summary: string;
  highlights: string[];
};
