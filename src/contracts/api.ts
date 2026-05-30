import { z } from "zod";

export const legalAreaSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string()
});

export const matchRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().positive().max(5000),
  areaIds: z.array(z.string()).min(1)
});

export const lawyerCreateSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  whatsapp: z.string().min(10),
  oabNumber: z.string().min(3),
  oabState: z.string().length(2),
  mainAreaId: z.string(),
  secondaryAreaIds: z.array(z.string()).default([]),
  officeCep: z.string().regex(/^\d{5}-?\d{3}$/),
  officeNumber: z.string().min(1),
  status: z.enum(["draft", "pending_review", "approved", "rejected", "suspended"]).default("draft")
});

export const lawyerPatchSchema = lawyerCreateSchema.partial().extend({
  status: z.enum(["draft", "pending_review", "approved", "rejected", "suspended"]).optional()
});

export const geocodeCepSchema = z.object({
  cep: z.string().regex(/^\d{5}-?\d{3}$/)
});

export type MatchRequest = z.infer<typeof matchRequestSchema>;
export type LawyerCreate = z.infer<typeof lawyerCreateSchema>;
export type LawyerPatch = z.infer<typeof lawyerPatchSchema>;
export type GeocodeCep = z.infer<typeof geocodeCepSchema>;
