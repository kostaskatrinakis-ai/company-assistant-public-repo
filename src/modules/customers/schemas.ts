import { z } from "zod";

export const createCustomerSchema = z.object({
  businessName: z.string().min(2),
  vatNumber: z.string().trim().optional().nullable(),
  mainPhone: z.string().trim().optional().nullable(),
  mainEmail: z.string().email().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export const createLocationSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(5),
  city: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});
