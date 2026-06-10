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

const safeHttpsUrlSchema = z.preprocess((value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}, z.string().url().nullable());

const officeManualLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export const cityMatchRequestSchema = z.object({
  stateId: z.string().uuid(),
  cityId: z.string().uuid(),
  areaIds: z.array(z.string()).min(1),
  page: z.number().int().positive().default(1),
  pageSize: z.literal(5).default(5)
});

const lawyerBaseSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  whatsapp: z.string().min(10),
  oabNumber: z.string().min(3),
  oabState: z.string().length(2),
  mainAreaId: z.string(),
  secondaryAreaIds: z.array(z.string()).default([]),
  officeCep: z.string().regex(/^\d{5}-?\d{3}$/),
  officeNumber: z.string().min(1),
  serviceCityId: z.string().uuid(),
  availableForMatches: z.boolean().default(true),
  avatarUrl: safeHttpsUrlSchema.optional(),
  coverUrl: safeHttpsUrlSchema.optional(),
  miniBio: z.string().trim().max(240).nullable().optional(),
  fullBio: z.string().trim().max(1200).nullable().optional(),
  instagramUrl: safeHttpsUrlSchema.optional(),
  linkedinUrl: safeHttpsUrlSchema.optional(),
  facebookUrl: safeHttpsUrlSchema.optional(),
  websiteUrl: safeHttpsUrlSchema.optional(),
  status: z.enum(["draft", "pending_review", "approved", "rejected", "suspended"]).default("draft")
});

export const lawyerCreateSchema = lawyerBaseSchema.extend({
  serviceStateId: z.string().uuid(),
  officeManualLocation: officeManualLocationSchema
});

export const lawyerPatchSchema = lawyerBaseSchema.partial().extend({
  serviceStateId: z.string().uuid().optional(),
  status: z.enum(["draft", "pending_review", "approved", "rejected", "suspended"]).optional(),
  officeManualLocation: officeManualLocationSchema.optional()
});

export const stateCreateSchema = z.object({
  code: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  active: z.boolean().default(true)
});
export const statePatchSchema = stateCreateSchema.partial();
export const cityCreateSchema = z.object({
  stateId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  center: officeManualLocationSchema
});
export const cityPatchSchema = cityCreateSchema.partial();

export const geocodeCepSchema = z.object({
  cep: z.string().regex(/^\d{5}-?\d{3}$/),
  officeNumber: z.string().trim().min(1).optional()
});

export const prayerRequestSchema = z.object({
  message: z.string().trim().min(20).max(500),
  anonymous: z.boolean().default(true)
});

export const adminUserPatchSchema = z.object({
  blocked: z.boolean()
});

export const adminPrayerRequestPatchSchema = z.object({
  status: z.enum(["received", "read"])
});

export const adminImageUploadSchema = z.object({
  kind: z.enum(["avatar", "cover", "partnerLogo"]),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64Data: z.string().min(1).max(3_000_000)
});

export const adminLawyerImageUploadSchema = adminImageUploadSchema.extend({
  kind: z.enum(["avatar", "cover"])
});

export const adminPartnerLogoCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  logoUrl: safeHttpsUrlSchema.refine((value): value is string => Boolean(value), "Logo HTTPS obrigatoria."),
  websiteUrl: safeHttpsUrlSchema.optional(),
  active: z.boolean().default(true)
});

export const clientSignupSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(72)
});

export const changePasswordSchema = z.object({
  newPassword: z.string().min(8).max(72)
});

export type MatchRequest = z.infer<typeof matchRequestSchema>;
export type CityMatchRequest = z.infer<typeof cityMatchRequestSchema>;
export type LawyerCreate = Omit<z.infer<typeof lawyerBaseSchema>, "serviceCityId" | "availableForMatches"> & {
  serviceCityId?: string | null;
  availableForMatches?: boolean;
};
export type LawyerPatch = z.infer<typeof lawyerPatchSchema>;
export type GeocodeCep = z.infer<typeof geocodeCepSchema>;
export type PrayerRequest = z.infer<typeof prayerRequestSchema>;
export type AdminUserPatch = z.infer<typeof adminUserPatchSchema>;
export type AdminPrayerRequestPatch = z.infer<typeof adminPrayerRequestPatchSchema>;
export type AdminImageUpload = z.infer<typeof adminImageUploadSchema>;
export type AdminLawyerImageUpload = z.infer<typeof adminLawyerImageUploadSchema>;
export type AdminPartnerLogoCreate = z.infer<typeof adminPartnerLogoCreateSchema>;
export type ClientSignup = z.infer<typeof clientSignupSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;
export type StateCreate = z.infer<typeof stateCreateSchema>;
export type StatePatch = z.infer<typeof statePatchSchema>;
export type CityCreate = z.infer<typeof cityCreateSchema>;
export type CityPatch = z.infer<typeof cityPatchSchema>;
