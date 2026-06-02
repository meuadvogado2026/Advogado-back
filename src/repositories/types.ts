import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import type { Role } from "../auth/types.js";

export type Profile = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
};

export type LawyerVisualFields = {
  avatarUrl?: string | null;
  coverUrl?: string | null;
  miniBio?: string | null;
  fullBio?: string | null;
};

export type LegalSpecialty = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
};

export type LawyerRecord = LawyerCreate & {
  id: string;
  profileId: string;
  officeLat?: number | null;
  officeLng?: number | null;
  createdAt: string;
  updatedAt: string;
};

/** Coordenada geocodificada persistida no escritorio do advogado (office_location). */
export type LawyerCoordinates = { lat: number; lng: number };

export interface ProfileRepository {
  getById(id: string): Promise<Profile | null>;
  createLawyerProfile(input: Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">): Promise<Profile>;
  updateVisualFields(profileId: string, input: Pick<LawyerVisualFields, "avatarUrl" | "coverUrl">): Promise<void>;
}

export interface LegalSpecialtyRepository {
  listActive(): Promise<LegalSpecialty[]>;
}

export interface LawyerRepository {
  list(): Promise<LawyerRecord[]>;
  getById(id: string): Promise<LawyerRecord | null>;
  create(input: LawyerCreate, coordinates?: LawyerCoordinates): Promise<LawyerRecord>;
  update(id: string, patch: LawyerPatch, coordinates?: LawyerCoordinates): Promise<LawyerRecord | null>;
}

/** Allowlist publica do perfil profissional exposto ao cliente autenticado. */
export type PublicLawyerProfile = {
  id: string;
  name: string;
  oabNumber: string;
  oabState: string;
  city: string | null;
  state: string | null;
  areaIds: string[];
  areas: Array<{ id: string; name: string }>;
  whatsapp: string;
  verified: true;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  miniBio?: string | null;
  fullBio?: string | null;
  yearsExperience?: number | null;
  planLabel?: string | null;
  emergencyAvailable?: boolean;
};

export interface PublicLawyerProfileRepository {
  getApprovedById(id: string): Promise<PublicLawyerProfile | null>;
}

export interface AuditLogRepository {
  record(input: {
    actorProfileId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export type NearestLawyerInput = {
  lat: number;
  lng: number;
  areaIds: string[];
  maxRadiusKm: number;
};

/** Campos seguros expostos ao cliente. Nunca inclui CEP, endereco completo nem PII interna. */
export type MatchedLawyer = {
  id: string;
  name: string;
  whatsapp: string;
  city: string | null;
  state: string | null;
  areaIds: string[];
};

export type NearestLawyerResult = {
  lawyer: MatchedLawyer;
  distanceKm: number;
} | null;

export interface MatchRepository {
  findNearest(input: NearestLawyerInput): Promise<NearestLawyerResult>;
}

export type MatchEventInput = {
  clientProfileId?: string;
  lawyerProfileId?: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  specialtyIds: string[];
  distanceKm?: number;
  algorithmVersion: string;
};

export interface MatchEventRepository {
  record(input: MatchEventInput): Promise<void>;
}

export type Repositories = {
  profiles: ProfileRepository;
  legalSpecialties: LegalSpecialtyRepository;
  lawyers: LawyerRepository;
  publicLawyerProfiles: PublicLawyerProfileRepository;
  auditLogs: AuditLogRepository;
  matches: MatchRepository;
  matchEvents: MatchEventRepository;
  mode: "memory" | "supabase";
};
