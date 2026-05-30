import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import type { Role } from "../auth/types.js";

export type Profile = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string | null;
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
  createLawyerProfile(input: Pick<LawyerCreate, "name" | "email" | "whatsapp">): Promise<Profile>;
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
  auditLogs: AuditLogRepository;
  matches: MatchRepository;
  matchEvents: MatchEventRepository;
  mode: "memory" | "supabase";
};
