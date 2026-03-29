import { z } from "zod";
import { appointmentStates } from "@/modules/operations/types";

export const createAppointmentSchema = z
  .object({
    requestId: z.string().trim().optional().nullable(),
    workOrderId: z.string().trim().optional().nullable(),
    assignedUserId: z.string().min(2),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().optional().nullable(),
    reasonNote: z.string().trim().optional().nullable(),
  })
  .refine((value) => value.requestId || value.workOrderId, {
    message: "Το ραντεβού πρέπει να συνδέεται με request ή work order.",
    path: ["requestId"],
  });

export const updateAppointmentSchema = z
  .object({
    assignedUserId: z.string().trim().optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional().nullable(),
    state: z.enum(appointmentStates).optional(),
    reasonNote: z.string().trim().optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Πρέπει να σταλεί τουλάχιστον ένα πεδίο για ενημέρωση.",
  });

export const rescheduleAppointmentSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional().nullable(),
  reasonNote: z.string().min(2),
});

export const markMissedAppointmentSchema = z.object({
  reasonNote: z.string().min(2),
});
