import { z } from "zod";

export const createLocalUserSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(["admin", "owner", "operator", "technician"]),
  password: z.string().min(8).max(128),
  phoneNumber: z.string().trim().max(40).optional().nullable(),
});

export const updateLocalUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: z.enum(["admin", "owner", "operator", "technician"]).optional(),
    password: z.string().min(8).max(128).optional(),
    phoneNumber: z.string().trim().max(40).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Πρέπει να σταλεί τουλάχιστον ένα πεδίο για ενημέρωση.",
  });
