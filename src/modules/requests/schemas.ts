import { z } from "zod";
import {
  requestPriorities,
  requestSourceChannels,
  requestStates,
} from "@/modules/operations/types";

export const createRequestSchema = z.object({
  customerId: z.string().trim().optional().nullable(),
  locationId: z.string().trim().optional().nullable(),
  sourceChannel: z.enum(requestSourceChannels),
  description: z.string().min(5),
  priority: z.enum(requestPriorities),
  reportedByName: z.string().trim().optional().nullable(),
});

export const updateRequestSchema = z
  .object({
    customerId: z.string().trim().optional().nullable(),
    locationId: z.string().trim().optional().nullable(),
    description: z.string().min(5).optional(),
    priority: z.enum(requestPriorities).optional(),
    state: z.enum(requestStates).optional(),
    reportedByName: z.string().trim().optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Πρέπει να σταλεί τουλάχιστον ένα πεδίο για ενημέρωση.",
  });

export const convertRequestSchema = z.object({
  issueSummary: z.string().min(5),
  assignedUserId: z.string().trim().optional().nullable(),
});
