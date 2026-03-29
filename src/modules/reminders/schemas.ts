import { z } from "zod";

export const createInvoiceReminderSchema = z.object({
  customerId: z.string().min(2),
  workOrderIds: z.array(z.string().min(2)).min(1),
  estimatedTotal: z.coerce.number().nonnegative(),
  monthKey: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  note: z.string().trim().optional().nullable(),
});

export const updateInvoiceReminderSchema = z
  .object({
    estimatedTotal: z.coerce.number().nonnegative().optional(),
    note: z.string().trim().optional().nullable(),
    state: z
      .enum(["PENDING", "QUEUED_FOR_MONTH", "READY_FOR_ACCOUNTING", "CLEARED", "CANCELED"])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Πρέπει να σταλεί τουλάχιστον ένα πεδίο για ενημέρωση.",
  });
