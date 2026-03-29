import { z } from "zod";

export const createTimeEntrySchema = z
  .object({
    minutesWorked: z.coerce.number().int().min(0),
    minutesTravel: z.coerce.number().int().min(0).optional().default(0),
    note: z.string().trim().optional().nullable(),
  })
  .refine((value) => value.minutesWorked + value.minutesTravel > 0, {
    message: "Πρέπει να δηλωθεί χρόνος εργασίας ή μετακίνησης.",
    path: ["minutesWorked"],
  });
