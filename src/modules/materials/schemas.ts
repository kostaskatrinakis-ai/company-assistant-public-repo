import { z } from "zod";

export const createMaterialUsageSchema = z.object({
  description: z.string().min(2),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1),
  estimatedCost: z.coerce.number().min(0).optional().nullable(),
});
