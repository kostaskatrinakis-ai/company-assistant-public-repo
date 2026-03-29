import { z } from "zod";
import { workOrderStates } from "@/modules/operations/types";

export const createWorkOrderSchema = z.object({
  requestId: z.string().trim().optional().nullable(),
  customerId: z.string().min(2),
  locationId: z.string().min(2),
  issueSummary: z.string().min(5),
  assignedUserId: z.string().trim().optional().nullable(),
});

export const updateWorkOrderSchema = z
  .object({
    state: z.enum(workOrderStates).optional(),
    resolutionSummary: z.string().trim().optional().nullable(),
    followUpReason: z.string().trim().optional().nullable(),
    assignedUserId: z.string().trim().optional().nullable(),
    markReadyForInvoice: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Πρέπει να σταλεί τουλάχιστον ένα πεδίο για ενημέρωση.",
  });

export const startWorkOrderSchema = z.object({
  note: z.string().trim().optional().nullable(),
});

export const completeWorkOrderSchema = z.object({
  resolutionSummary: z.string().min(5),
});

export const followUpWorkOrderSchema = z.object({
  followUpReason: z.string().min(5),
  resolutionSummary: z.string().trim().optional().nullable(),
});
