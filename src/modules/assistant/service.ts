import {
  AssistantActionOutcome,
  AssistantActionRequestStatus,
  AssistantChannel,
  AssistantContextType,
  AssistantConversationStatus,
  AssistantSenderType,
  AuditActorSource,
  DomainEntityType,
} from "@prisma/client";
import { z } from "zod";
import { getAssistantPolicy } from "@/modules/assistant/policy";
import {
  buildAssistantInstructions,
  executeAssistantTool,
  getAssistantToolDefinitions,
} from "@/modules/assistant/runtime";
import { createAppointment } from "@/modules/appointments/service";
import { recordAuditEvent } from "@/modules/audit/service";
import { createInvoiceReminder, queueInvoiceReminder } from "@/modules/reminders/service";
import { getSessionUserById } from "@/modules/users/service";
import { sendWhatsAppTextMessage } from "@/modules/whatsapp/outbound";
import {
  markWorkOrderReadyForInvoice,
} from "@/modules/work-orders/service";
import type { SessionUser } from "@/shared/auth/types";
import { env } from "@/shared/config/env";
import {
  getCodexAccessTokenFromCookie,
  getCodexBaseUrl,
} from "@/shared/config/codex-auth";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";
import { getDatabaseClient } from "@/shared/db/readiness";
import type { UiLocale } from "@/shared/ui/types";
import { translate } from "@/shared/ui/types";

const scheduleAppointmentArgsSchema = z
  .object({
    requestId: z.string().trim().optional().nullable(),
    workOrderId: z.string().trim().optional().nullable(),
    assignedUserId: z.string().trim().min(2),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().optional().nullable(),
    reasonNote: z.string().trim().optional().nullable(),
  })
  .refine((value) => value.requestId || value.workOrderId, {
    message: "Η ενέργεια πρέπει να συνδέεται με request ή work order.",
    path: ["requestId"],
  });

const createReminderArgsSchema = z.object({
  customerId: z.string().trim().min(2),
  workOrderIds: z.array(z.string().trim().min(2)).min(1),
  estimatedTotal: z.coerce.number().nonnegative(),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  note: z.string().trim().optional().nullable(),
});

const queueReminderArgsSchema = z.object({
  reminderId: z.string().trim().min(2),
});

const sendWhatsAppArgsSchema = z.object({
  to: z.string().trim().min(4),
  body: z.string().trim().min(2).max(1000),
  linkedEntityType: z.nativeEnum(DomainEntityType).optional(),
  linkedEntityId: z.string().trim().optional().nullable(),
});

const markReadyArgsSchema = z.object({
  workOrderId: z.string().trim().min(2),
});

type AssistantConversationRecord = {
  id: string;
  channel: AssistantChannel;
  contextType: AssistantContextType;
  contextEntityId: string | null;
  status: AssistantConversationStatus;
  updatedAt: string;
  createdAt: string;
  lastMessagePreview: string | null;
  pendingActions: number;
};

type AssistantMessageRecord = {
  id: string;
  senderType: AssistantSenderType;
  body: string;
  createdAt: string;
};

type AssistantActionRequestRecord = {
  id: string;
  actionName: string;
  status: AssistantActionRequestStatus;
  targetEntityType: DomainEntityType;
  targetEntityId: string | null;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

type PendingAssistantActionRequestRecord = AssistantActionRequestRecord & {
  conversationId: string;
  requesterName: string;
};

type AssistantConversationDetail = {
  conversation: AssistantConversationRecord;
  messages: AssistantMessageRecord[];
  actionRequests: AssistantActionRequestRecord[];
  assistantReply?: string | null;
};

type ResponsesApiOutputItem =
  | {
      type: "function_call";
      name: string;
      arguments: string;
      call_id?: string;
      status?: string;
    }
  | {
      type: "message";
      role?: string;
      status?: string;
      content?: Array<
        | {
            type: "output_text";
            text: string;
          }
        | {
            type: string;
          }
      >;
  }
  | {
      type: string;
    };

type ResponsesApiPayload = {
  id?: string;
  output?: ResponsesApiOutputItem[];
  output_text?: string;
  error?: {
    message?: string;
  };
  detail?: string;
};

type ResponsesApiMessagePart = NonNullable<
  Extract<ResponsesApiOutputItem, { type: "message" }>["content"]
>[number];

function extractProviderErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  if ("detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }

  return null;
}

function isAssistantMessageOutputItem(
  item: ResponsesApiOutputItem,
): item is Extract<ResponsesApiOutputItem, { type: "message" }> {
  return item.type === "message";
}

function isFunctionCallOutputItem(
  item: ResponsesApiOutputItem,
): item is Extract<ResponsesApiOutputItem, { type: "function_call" }> {
  return item.type === "function_call";
}

function isOutputTextPart(
  part: ResponsesApiMessagePart,
): part is Extract<ResponsesApiMessagePart, { type: "output_text" }> {
  return part.type === "output_text";
}

function extractAssistantText(output: ResponsesApiOutputItem[]) {
  return output
    .flatMap((item) => {
      if (!isAssistantMessageOutputItem(item) || !Array.isArray(item.content)) {
        return [];
      }

      return item.content.flatMap((part) =>
        isOutputTextPart(part) && typeof part.text === "string"
          ? [part.text]
          : [],
      );
    })
    .join("\n")
    .trim();
}

function summarizeAssistantToolOutputs(
  results: Array<Awaited<ReturnType<typeof executeAssistantTool>>>,
  locale: UiLocale,
) {
  const messages = Array.from(
    new Set(
      results
        .map((result) => result.message?.trim())
        .filter((message): message is string => Boolean(message)),
    ),
  );

  if (messages.length === 0) {
    return translate(locale, {
      el: "Η ενέργεια ολοκληρώθηκε, αλλά δεν επέστρεψε τελική σύνοψη.",
      en: "The action completed, but it did not return a final summary.",
    });
  }

  return messages.slice(0, 3).join(" ");
}

function parseSseEventBlock(block: string) {
  let eventName: string | null = null;
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!eventName || dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n");

  try {
    return {
      event: eventName,
      data: JSON.parse(rawData) as unknown,
    };
  } catch {
    return {
      event: eventName,
      data: rawData,
    };
  }
}

async function parseCodexStreamingPayload(response: Response): Promise<ResponsesApiPayload> {
  const rawText = await response.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {};
  }

  if (!trimmed.includes("event:")) {
    try {
      return JSON.parse(trimmed) as ResponsesApiPayload;
    } catch {
      return {
        error: {
          message: trimmed,
        },
      };
    }
  }

  const blocks = trimmed
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const events = blocks
    .map(parseSseEventBlock)
    .filter((event): event is { event: string; data: unknown } => Boolean(event));

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.event === "response.completed" &&
      event.data &&
      typeof event.data === "object" &&
      "response" in event.data &&
      event.data.response &&
      typeof event.data.response === "object"
    ) {
      return event.data.response as ResponsesApiPayload;
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const message = extractProviderErrorMessage(event.data);
    if (message) {
      return {
        error: {
          message,
        },
      };
    }
  }

  return {
    error: {
      message: trimmed,
    },
  };
}

function ensureAssistantPermission(user: SessionUser) {
  if (!user.permissions.includes("assistant.use")) {
    throw new BusinessRuleError(
      "ASSISTANT_FORBIDDEN",
      "Ο χρήστης δεν έχει δικαίωμα χρήσης του assistant.",
      403,
    );
  }
}

function ensureAssistantExecutionPermission(user: SessionUser) {
  if (!user.permissions.includes("assistant.execute_actions")) {
    throw new BusinessRuleError(
      "ASSISTANT_ACTIONS_FORBIDDEN",
      "Ο χρήστης δεν έχει δικαίωμα εκτέλεσης assistant actions.",
      403,
    );
  }
}

function ensureWhatsAppSendPermission(user: SessionUser) {
  if (!user.permissions.includes("whatsapp.send")) {
    throw new BusinessRuleError(
      "WHATSAPP_SEND_FORBIDDEN",
      "Ο χρήστης δεν έχει δικαίωμα αποστολής WhatsApp.",
      403,
    );
  }
}

function mapConversationRecord(conversation: {
  id: string;
  channel: AssistantChannel;
  contextType: AssistantContextType;
  contextEntityId: string | null;
  status: AssistantConversationStatus;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    body: string;
  }>;
  actionRequests: Array<{
    id: string;
  }>;
}): AssistantConversationRecord {
  const lastMessage = conversation.messages[0];

  return {
    id: conversation.id,
    channel: conversation.channel,
    contextType: conversation.contextType,
    contextEntityId: conversation.contextEntityId,
    status: conversation.status,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessagePreview: lastMessage?.body ?? null,
    pendingActions: conversation.actionRequests.length,
  };
}

function mapMessageRecord(message: {
  id: string;
  senderType: AssistantSenderType;
  body: string;
  createdAt: Date;
}): AssistantMessageRecord {
  return {
    id: message.id,
    senderType: message.senderType,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

function mapActionRequestRecord(request: {
  id: string;
  actionName: string;
  status: AssistantActionRequestStatus;
  targetEntityType: DomainEntityType;
  targetEntityId: string | null;
  title: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
}): AssistantActionRequestRecord {
  return {
    id: request.id,
    actionName: request.actionName,
    status: request.status,
    targetEntityType: request.targetEntityType,
    targetEntityId: request.targetEntityId,
    title: request.title,
    summary: request.summary,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function mapPendingActionRequestRecord(request: {
  id: string;
  actionName: string;
  status: AssistantActionRequestStatus;
  targetEntityType: DomainEntityType;
  targetEntityId: string | null;
  title: string;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
  conversationId: string;
  user: {
    fullName: string;
  };
}): PendingAssistantActionRequestRecord {
  return {
    ...mapActionRequestRecord(request),
    conversationId: request.conversationId,
    requesterName: request.user.fullName,
  };
}

async function buildConversationTranscript(conversationId: string) {
  const db = await getDatabaseClient();
  const messages = await db.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 14,
  });

  return messages
    .reverse()
    .map((message) => `${message.senderType}: ${message.body}`)
    .join("\n");
}

async function buildAssistantContext(user: SessionUser) {
  const db = await getDatabaseClient();
  const [customers, requests, workOrders, reminders, technicians] = await Promise.all([
    db.customer.findMany({
      orderBy: { businessName: "asc" },
      take: 20,
      select: {
        id: true,
        businessName: true,
        mainPhone: true,
      },
    }),
    db.request.findMany({
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        description: true,
        state: true,
        priority: true,
        customer: {
          select: { businessName: true },
        },
        location: {
          select: { name: true },
        },
      },
    }),
    db.workOrder.findMany({
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        state: true,
        issueSummary: true,
        customerId: true,
        customer: {
          select: { businessName: true },
        },
        location: {
          select: { name: true },
        },
        assignments: {
          where: { state: "ACTIVE" },
          select: {
            userId: true,
            user: {
              select: { fullName: true },
            },
            isPrimary: true,
          },
        },
      },
    }),
    db.invoiceReminder.findMany({
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        monthKey: true,
        state: true,
        customerId: true,
        customer: {
          select: { businessName: true },
        },
      },
    }),
    db.user.findMany({
      where: { role: "TECHNICIAN", isActive: true },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
      },
    }),
  ]);

  return {
    currentUser: {
      id: user.id,
      role: user.role,
      permissions: user.permissions,
      phoneNumber: user.phoneNumber ?? null,
    },
    customers,
    requests: requests.map((request) => ({
      id: request.id,
      description: request.description,
      state: request.state,
      priority: request.priority,
      customerName: request.customer?.businessName ?? null,
      locationName: request.location?.name ?? null,
    })),
    workOrders: workOrders.map((workOrder) => ({
      id: workOrder.id,
      state: workOrder.state,
      issueSummary: workOrder.issueSummary,
      customerId: workOrder.customerId,
      customerName: workOrder.customer.businessName,
      locationName: workOrder.location.name,
      primaryAssigneeId:
        workOrder.assignments.find((assignment) => assignment.isPrimary)?.userId ??
        workOrder.assignments[0]?.userId ??
        null,
      primaryAssigneeName:
        workOrder.assignments.find((assignment) => assignment.isPrimary)?.user.fullName ??
        workOrder.assignments[0]?.user.fullName ??
        null,
    })),
    reminders: reminders.map((reminder) => ({
      id: reminder.id,
      monthKey: reminder.monthKey,
      state: reminder.state,
      customerId: reminder.customerId,
      customerName: reminder.customer.businessName,
    })),
    technicians,
  };
}

async function callOpenAiAssistant(input: {
  message: string;
  user: SessionUser;
  locale: UiLocale;
  allowActions: boolean;
  conversationId: string;
  channel: AssistantChannel;
  codexTokenCookie?: string;
}) {
  const hasCodexCookie = Boolean(input.codexTokenCookie);

  if (!hasCodexCookie && !env.openAiApiKey) {
    throw new BusinessRuleError(
      "OPENAI_NOT_CONFIGURED",
      "Δεν έχεις συνδεθεί με OpenAI. Πάτησε 'Login with OpenAI' στο assistant.",
      503,
    );
  }

  // Resolve endpoint, auth header and extra headers
  let apiUrl: string;
  let authHeader: string;
  let model: string;
  let useCodexStreaming = false;
  const extraHeaders: Record<string, string> = {};

  if (hasCodexCookie) {
    try {
      const result = await getCodexAccessTokenFromCookie(input.codexTokenCookie!);
      apiUrl = `${getCodexBaseUrl()}/responses`;
      authHeader = `Bearer ${result.tokens.access_token}`;
      model = env.codexModel;
      useCodexStreaming = true;

      if (result.tokens.account_id) {
        extraHeaders["chatgpt-account-id"] = result.tokens.account_id;
      }
      extraHeaders["OpenAI-Beta"] = "responses=experimental";

      console.log("[assistant] Using Codex OAuth endpoint.");
    } catch (error) {
      console.warn("[assistant] Codex cookie invalid, falling back:", error);
      if (!env.openAiApiKey) {
        throw new BusinessRuleError(
          "CODEX_AUTH_EXPIRED",
          "Η σύνδεση OpenAI έληξε. Πάτησε 'Login with OpenAI' ξανά.",
          401,
        );
      }
      apiUrl = "https://api.openai.com/v1/responses";
      authHeader = `Bearer ${env.openAiApiKey}`;
      model = env.openAiAssistantModel;
    }
  } else {
    apiUrl = "https://api.openai.com/v1/responses";
    authHeader = `Bearer ${env.openAiApiKey}`;
    model = env.openAiAssistantModel;
    console.log("[assistant] Using OpenAI API key endpoint.");
  }

  const context = await buildAssistantContext(input.user);
  const conversationTranscript = await buildConversationTranscript(input.conversationId);
  const tools = getAssistantToolDefinitions(input.locale, input.allowActions);

  const baseRequestBody: Record<string, unknown> = {
    model,
    store: false,
    instructions: buildAssistantInstructions({
      user: input.user,
      locale: input.locale,
      channel: input.channel,
      context,
      conversationTranscript,
      allowMutations: input.allowActions,
    }),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: input.message,
          },
        ],
      },
    ],
    tools,
  };

  if (useCodexStreaming) {
    baseRequestBody.stream = true;
  }

  let requestBody = baseRequestBody;
  let previousResponseId: string | null = null;
  let lastToolResults: Array<Awaited<ReturnType<typeof executeAssistantTool>>> = [];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(requestBody),
    });

    const payload = useCodexStreaming
      ? await parseCodexStreamingPayload(response)
      : ((await response.json()) as ResponsesApiPayload);

    if (!response.ok) {
      throw new BusinessRuleError(
        "OPENAI_RESPONSE_FAILED",
        extractProviderErrorMessage(payload) ?? "Αποτυχία επικοινωνίας με το OpenAI.",
        502,
      );
    }

    previousResponseId = payload.id ?? previousResponseId;
    const output = Array.isArray(payload.output) ? payload.output : [];
    const functionCalls = output.filter(isFunctionCallOutputItem);

    if (functionCalls.length === 0) {
      const assistantText =
        payload.output_text?.trim() ||
        extractAssistantText(output) ||
        summarizeAssistantToolOutputs(lastToolResults, input.locale);

      return {
        text: assistantText,
      };
    }

    const toolExecutions = await Promise.all(
      functionCalls.map(async (functionCall, index) => {
        let parsedArguments: Record<string, unknown>;

        try {
          parsedArguments = JSON.parse(functionCall.arguments) as Record<string, unknown>;
        } catch {
          parsedArguments = {};
        }

        const result = await executeAssistantTool({
          name: functionCall.name,
          args: parsedArguments,
          user: input.user,
          locale: input.locale,
          channel: input.channel,
        });

        return {
          result,
          output: {
            type: "function_call_output" as const,
            call_id: functionCall.call_id ?? `${functionCall.name}-${iteration}-${index}`,
            output: JSON.stringify(result),
          },
        };
      }),
    );
    lastToolResults = toolExecutions.map((item) => item.result);
    const toolOutputs = toolExecutions.map((item) => item.output);

    requestBody = previousResponseId
      ? {
          model,
          store: false,
          previous_response_id: previousResponseId,
          input: toolOutputs,
          tools,
          ...(useCodexStreaming ? { stream: true } : {}),
        }
      : {
          ...baseRequestBody,
          input: [...((baseRequestBody.input as Array<Record<string, unknown>>) ?? []), ...toolOutputs],
        };
  }

  return {
    text:
      lastToolResults.length > 0
        ? summarizeAssistantToolOutputs(lastToolResults, input.locale)
        : translate(input.locale, {
            el: "Έκανα αρκετές assistant ενέργειες αλλά δεν παρήχθη τελική απάντηση. Δοκίμασε ξανά με πιο συγκεκριμένο αίτημα.",
            en: "I completed several assistant steps but no final answer was produced. Please try again with a more specific request.",
          }),
  };
}

async function createConversationMessage(
  conversationId: string,
  senderType: AssistantSenderType,
  body: string,
  providerMessageId?: string | null,
) {
  const db = await getDatabaseClient();

  return db.assistantMessage.create({
    data: {
      conversationId,
      senderType,
      body,
      providerMessageId: providerMessageId ?? null,
    },
  });
}

export async function buildActionRequestPresentation(input: {
  actionName: string;
  payload: Record<string, unknown>;
  locale: UiLocale;
}) {
  const db = await getDatabaseClient();

  if (input.actionName === "schedule_appointment") {
    const payload = scheduleAppointmentArgsSchema.parse(input.payload);
    const technician = await db.user.findUnique({
      where: { id: payload.assignedUserId },
      select: { fullName: true },
    });

    return {
      targetEntityType: DomainEntityType.APPOINTMENT,
      targetEntityId: payload.requestId ?? payload.workOrderId ?? null,
      title: translate(input.locale, {
        el: "Έτοιμο για νέο ραντεβού",
        en: "Ready to schedule appointment",
      }),
      summary: translate(input.locale, {
        el: `Να κλειστεί ραντεβού για ${new Date(payload.startAt).toLocaleString("el-GR")} με τεχνικό ${technician?.fullName ?? payload.assignedUserId}.`,
        en: `Schedule an appointment for ${new Date(payload.startAt).toLocaleString("en-US")} with technician ${technician?.fullName ?? payload.assignedUserId}.`,
      }),
    };
  }

  if (input.actionName === "mark_work_order_ready_for_invoice") {
    const payload = markReadyArgsSchema.parse(input.payload);
    const workOrder = await db.workOrder.findUnique({
      where: { id: payload.workOrderId },
      include: {
        customer: {
          select: { businessName: true },
        },
      },
    });

    return {
      targetEntityType: DomainEntityType.WORK_ORDER,
      targetEntityId: payload.workOrderId,
      title: translate(input.locale, {
        el: "Έτοιμο για handoff τιμολόγησης",
        en: "Ready for invoicing handoff",
      }),
      summary: translate(input.locale, {
        el: `Να περάσει το work order ${payload.workOrderId} (${workOrder?.customer.businessName ?? "άγνωστος πελάτης"}) σε ready for invoice.`,
        en: `Move work order ${payload.workOrderId} (${workOrder?.customer.businessName ?? "unknown customer"}) to ready for invoice.`,
      }),
    };
  }

  if (input.actionName === "create_invoice_reminder") {
    const payload = createReminderArgsSchema.parse(input.payload);
    const customer = await db.customer.findUnique({
      where: { id: payload.customerId },
      select: { businessName: true },
    });

    return {
      targetEntityType: DomainEntityType.REMINDER,
      targetEntityId: payload.customerId,
      title: translate(input.locale, {
        el: "Έτοιμο reminder τιμολόγησης",
        en: "Invoice reminder ready",
      }),
      summary: translate(input.locale, {
        el: `Να δημιουργηθεί ή ενημερωθεί reminder για ${customer?.businessName ?? payload.customerId} με ${payload.workOrderIds.length} work orders και εκτίμηση ${payload.estimatedTotal.toFixed(2)}.`,
        en: `Create or update a reminder for ${customer?.businessName ?? payload.customerId} with ${payload.workOrderIds.length} work orders and estimated total ${payload.estimatedTotal.toFixed(2)}.`,
      }),
    };
  }

  if (input.actionName === "queue_invoice_reminder") {
    const payload = queueReminderArgsSchema.parse(input.payload);

    return {
      targetEntityType: DomainEntityType.REMINDER,
      targetEntityId: payload.reminderId,
      title: translate(input.locale, {
        el: "Έτοιμο για monthly queue",
        en: "Ready for monthly queue",
      }),
      summary: translate(input.locale, {
        el: `Να περάσει το reminder ${payload.reminderId} σε queued for month.`,
        en: `Queue reminder ${payload.reminderId} for the month.`,
      }),
    };
  }

  if (input.actionName === "send_whatsapp_text") {
    const payload = sendWhatsAppArgsSchema.parse(input.payload);

    return {
      targetEntityType: payload.linkedEntityType ?? DomainEntityType.UNKNOWN,
      targetEntityId: payload.linkedEntityId ?? null,
      title: translate(input.locale, {
        el: "Έτοιμο outbound WhatsApp",
        en: "Outbound WhatsApp ready",
      }),
      summary: translate(input.locale, {
        el: `Να σταλεί WhatsApp στο ${payload.to}: ${payload.body}`,
        en: `Send WhatsApp to ${payload.to}: ${payload.body}`,
      }),
    };
  }

  throw new BusinessRuleError(
    "ASSISTANT_ACTION_UNSUPPORTED",
    "Η assistant action δεν υποστηρίζεται.",
    422,
  );
}

async function executeActionRequest(input: {
  actionName: string;
  payloadJson: unknown;
  actor: SessionUser;
}) {
  const payload = input.payloadJson as Record<string, unknown>;

  switch (input.actionName) {
    case "schedule_appointment":
      return createAppointment(scheduleAppointmentArgsSchema.parse(payload), input.actor);
    case "mark_work_order_ready_for_invoice":
      return markWorkOrderReadyForInvoice(
        markReadyArgsSchema.parse(payload).workOrderId,
        input.actor,
      );
    case "create_invoice_reminder":
      return createInvoiceReminder(createReminderArgsSchema.parse(payload), input.actor);
    case "queue_invoice_reminder":
      return queueInvoiceReminder(queueReminderArgsSchema.parse(payload).reminderId, input.actor);
    case "send_whatsapp_text": {
      ensureWhatsAppSendPermission(input.actor);
      const parsed = sendWhatsAppArgsSchema.parse(payload);
      return sendWhatsAppTextMessage({
        to: parsed.to,
        body: parsed.body,
        actor: input.actor,
        linkedEntityType: parsed.linkedEntityType,
        linkedEntityId: parsed.linkedEntityId,
      });
    }
    default:
      throw new BusinessRuleError(
        "ASSISTANT_ACTION_UNSUPPORTED",
        "Η assistant action δεν υποστηρίζεται.",
        422,
      );
  }
}

async function getConversationRecord(
  conversationId: string,
  userId: string,
) {
  const db = await getDatabaseClient();

  return db.assistantConversation.findFirst({
    where: {
      id: conversationId,
      userId,
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      actionRequests: {
        where: { status: AssistantActionRequestStatus.PENDING },
      },
    },
  });
}

export async function listAssistantConversations(user: SessionUser) {
  ensureAssistantPermission(user);
  const db = await getDatabaseClient();
  const conversations = await db.assistantConversation.findMany({
    where: {
      userId: user.id,
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      actionRequests: {
        where: { status: AssistantActionRequestStatus.PENDING },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return conversations.map(mapConversationRecord);
}

export async function listPendingAssistantActionRequests(user: SessionUser) {
  ensureAssistantPermission(user);
  const db = await getDatabaseClient();
  const pendingRequests = await db.assistantActionRequest.findMany({
    where: user.permissions.includes("assistant.execute_actions")
      ? { status: AssistantActionRequestStatus.PENDING }
      : {
          status: AssistantActionRequestStatus.PENDING,
          userId: user.id,
        },
    include: {
      user: {
        select: {
          fullName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return pendingRequests.map(mapPendingActionRequestRecord);
}

export async function createAssistantConversation(
  input: {
    channel?: AssistantChannel;
    contextType?: AssistantContextType;
    contextEntityId?: string | null;
  },
  user: SessionUser,
) {
  ensureAssistantPermission(user);
  const db = await getDatabaseClient();
  const created = await db.assistantConversation.create({
    data: {
      userId: user.id,
      channel: input.channel ?? AssistantChannel.APP,
      contextType: input.contextType ?? AssistantContextType.GLOBAL,
      contextEntityId: input.contextEntityId ?? null,
    },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      actionRequests: {
        where: { status: AssistantActionRequestStatus.PENDING },
      },
    },
  });

  return mapConversationRecord(created);
}

export async function getAssistantConversationDetail(
  conversationId: string,
  user: SessionUser,
) {
  ensureAssistantPermission(user);
  const db = await getDatabaseClient();
  const conversation = await db.assistantConversation.findFirst({
    where: {
      id: conversationId,
      ...(user.permissions.includes("assistant.execute_actions")
        ? {}
        : { userId: user.id }),
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
      actionRequests: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!conversation) {
    return null;
  }

  return {
    conversation: {
      id: conversation.id,
      channel: conversation.channel,
      contextType: conversation.contextType,
      contextEntityId: conversation.contextEntityId,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessagePreview: conversation.messages.at(-1)?.body ?? null,
      pendingActions: conversation.actionRequests.filter(
        (item) => item.status === AssistantActionRequestStatus.PENDING,
      ).length,
    },
    messages: conversation.messages.map(mapMessageRecord),
    actionRequests: conversation.actionRequests.map(mapActionRequestRecord),
    assistantReply: conversation.messages.at(-1)?.body ?? null,
  } satisfies AssistantConversationDetail;
}

export async function sendAssistantMessage(input: {
  conversationId?: string;
  body: string;
  locale: UiLocale;
  channel?: AssistantChannel;
  contextType?: AssistantContextType;
  contextEntityId?: string | null;
  user: SessionUser;
  codexTokenCookie?: string;
}) {
  ensureAssistantPermission(input.user);
  const db = await getDatabaseClient();
  const conversation =
    input.conversationId
      ? await getConversationRecord(input.conversationId, input.user.id)
      : await db.assistantConversation.findFirst({
          where: {
            userId: input.user.id,
            channel: input.channel ?? AssistantChannel.APP,
            status: AssistantConversationStatus.OPEN,
          },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            actionRequests: {
              where: { status: AssistantActionRequestStatus.PENDING },
            },
          },
          orderBy: { updatedAt: "desc" },
        });

  const resolvedConversation =
    conversation ??
    (await db.assistantConversation.create({
      data: {
        userId: input.user.id,
        channel: input.channel ?? AssistantChannel.APP,
        contextType: input.contextType ?? AssistantContextType.GLOBAL,
        contextEntityId: input.contextEntityId ?? null,
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        actionRequests: {
          where: { status: AssistantActionRequestStatus.PENDING },
        },
      },
    }));

  if (!resolvedConversation) {
    throw new BusinessRuleError(
      "ASSISTANT_CONVERSATION_NOT_FOUND",
      "Η assistant conversation δεν βρέθηκε.",
      404,
    );
  }

  const userMessage = await createConversationMessage(
    resolvedConversation.id,
    AssistantSenderType.USER,
    input.body,
  );

  const assistantResult = await callOpenAiAssistant({
    message: input.body,
    user: input.user,
    locale: input.locale,
    allowActions: getAssistantPolicy(
      input.user,
      input.channel ?? AssistantChannel.APP,
    ).canRequestActions,
    conversationId: resolvedConversation.id,
    channel: input.channel ?? AssistantChannel.APP,
    codexTokenCookie: input.codexTokenCookie,
  });

  const assistantReply =
    assistantResult.text ||
    translate(input.locale, {
      el: "Δεν έχω αρκετά στοιχεία για ασφαλή απάντηση. Δώσε περισσότερες λεπτομέρειες.",
      en: "I do not have enough information for a safe answer. Please provide more details.",
    });

  const assistantMessage = await createConversationMessage(
    resolvedConversation.id,
    AssistantSenderType.ASSISTANT,
    assistantReply,
  );

  await recordAuditEvent({
    actorUserId: input.user.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.ASSISTANT_CONVERSATION,
    entityId: resolvedConversation.id,
    eventName: "assistant.message.created",
    afterJson: {
      conversationId: resolvedConversation.id,
      actionRequestId: null,
    },
  });

  try {
    const detail = await getAssistantConversationDetail(resolvedConversation.id, input.user);
    if (detail) {
      return {
        ...detail,
        assistantReply,
      };
    }
  } catch {
    // Keep the primary assistant reply available even if the detail refresh fails.
  }

  return {
    conversation: {
      id: resolvedConversation.id,
      channel: resolvedConversation.channel,
      contextType: resolvedConversation.contextType,
      contextEntityId: resolvedConversation.contextEntityId,
      status: resolvedConversation.status,
      createdAt: resolvedConversation.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessagePreview: assistantReply,
      pendingActions: resolvedConversation.actionRequests.filter(
        (item) => item.status === AssistantActionRequestStatus.PENDING,
      ).length,
    },
    messages: [
      {
        id: userMessage.id,
        senderType: AssistantSenderType.USER,
        body: input.body,
        createdAt: userMessage.createdAt.toISOString(),
      },
      {
        id: assistantMessage.id,
        senderType: AssistantSenderType.ASSISTANT,
        body: assistantReply,
        createdAt: assistantMessage.createdAt.toISOString(),
      },
    ],
    actionRequests: resolvedConversation.actionRequests.map(mapActionRequestRecord),
    assistantReply,
  };
}

export async function approveAssistantActionRequest(input: {
  actionRequestId: string;
  user: SessionUser;
  locale: UiLocale;
  decisionNote?: string | null;
}) {
  ensureAssistantExecutionPermission(input.user);
  const db = await getDatabaseClient();
  const request = await db.assistantActionRequest.findUnique({
    where: {
      id: input.actionRequestId,
    },
  });

  if (!request) {
    throw new BusinessRuleError(
      "ASSISTANT_ACTION_REQUEST_NOT_FOUND",
      "Το assistant action request δεν βρέθηκε.",
      404,
    );
  }

  const claimResult = await db.assistantActionRequest.updateMany({
    where: {
      id: request.id,
      status: AssistantActionRequestStatus.PENDING,
    },
    data: {
      status: AssistantActionRequestStatus.APPROVED,
      decisionNote: input.decisionNote ?? null,
    },
  });

  if (claimResult.count === 0) {
    throw new BusinessRuleError(
      "ASSISTANT_ACTION_REQUEST_LOCKED",
      "Το assistant action request δεν είναι πλέον σε pending κατάσταση.",
      409,
    );
  }

  try {
    const executionResult = await executeActionRequest({
      actionName: request.actionName,
      payloadJson: request.payloadJson,
      actor: input.user,
    });

    await db.assistantActionRequest.update({
      where: { id: request.id },
      data: {
        status: AssistantActionRequestStatus.EXECUTED,
        decisionNote: input.decisionNote ?? null,
      },
    });

    await db.assistantActionLog.create({
      data: {
        conversationId: request.conversationId,
        userId: input.user.id,
        actionName: request.actionName,
        targetEntityType: request.targetEntityType,
        targetEntityId: request.targetEntityId,
        outcome: AssistantActionOutcome.SUCCESS,
      },
    });

    await createConversationMessage(
      request.conversationId,
      AssistantSenderType.SYSTEM,
      translate(input.locale, {
        el: `Η ενέργεια "${request.title}" εγκρίθηκε και εκτελέστηκε επιτυχώς.`,
        en: `The action "${request.title}" was approved and executed successfully.`,
      }),
    );

    await recordAuditEvent({
      actorUserId: input.user.id,
      actorSource: AuditActorSource.APP,
      entityType: DomainEntityType.ASSISTANT_CONVERSATION,
      entityId: request.conversationId,
      eventName: "assistant.action_request.executed",
      afterJson: executionResult,
    });
  } catch (error) {
    await db.assistantActionRequest.update({
      where: { id: request.id },
      data: {
        status: AssistantActionRequestStatus.FAILED,
        decisionNote:
          error instanceof Error
            ? error.message
            : input.decisionNote ?? null,
      },
    });

    await db.assistantActionLog.create({
      data: {
        conversationId: request.conversationId,
        userId: input.user.id,
        actionName: request.actionName,
        targetEntityType: request.targetEntityType,
        targetEntityId: request.targetEntityId,
        outcome: AssistantActionOutcome.FAILED,
      },
    });

    await createConversationMessage(
      request.conversationId,
      AssistantSenderType.SYSTEM,
      error instanceof Error
        ? error.message
        : translate(input.locale, {
            el: "Η ενέργεια απέτυχε κατά την εκτέλεση.",
            en: "The action failed during execution.",
          }),
    );

    throw error;
  }

  const refreshedUser = (await getSessionUserById(input.user.id)) ?? input.user;
  return getAssistantConversationDetail(request.conversationId, refreshedUser);
}

export async function rejectAssistantActionRequest(input: {
  actionRequestId: string;
  user: SessionUser;
  locale: UiLocale;
  decisionNote?: string | null;
}) {
  ensureAssistantExecutionPermission(input.user);
  const db = await getDatabaseClient();
  const request = await db.assistantActionRequest.findUnique({
    where: {
      id: input.actionRequestId,
    },
  });

  if (!request) {
    throw new BusinessRuleError(
      "ASSISTANT_ACTION_REQUEST_NOT_FOUND",
      "Το assistant action request δεν βρέθηκε.",
      404,
    );
  }

  const rejectResult = await db.assistantActionRequest.updateMany({
    where: {
      id: request.id,
      status: AssistantActionRequestStatus.PENDING,
    },
    data: {
      status: AssistantActionRequestStatus.REJECTED,
      decisionNote: input.decisionNote ?? null,
    },
  });

  if (rejectResult.count === 0) {
    throw new BusinessRuleError(
      "ASSISTANT_ACTION_REQUEST_LOCKED",
      "Το assistant action request δεν είναι πλέον σε pending κατάσταση.",
      409,
    );
  }

  await db.assistantActionLog.create({
    data: {
      conversationId: request.conversationId,
      userId: input.user.id,
      actionName: request.actionName,
      targetEntityType: request.targetEntityType,
      targetEntityId: request.targetEntityId,
      outcome: AssistantActionOutcome.REJECTED,
    },
  });

  await createConversationMessage(
    request.conversationId,
    AssistantSenderType.SYSTEM,
    translate(input.locale, {
      el: `Η ενέργεια "${request.title}" απορρίφθηκε.`,
      en: `The action "${request.title}" was rejected.`,
    }),
  );

  const refreshedUser = (await getSessionUserById(input.user.id)) ?? input.user;
  return getAssistantConversationDetail(request.conversationId, refreshedUser);
}
