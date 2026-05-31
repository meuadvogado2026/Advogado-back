import type { SupabaseClient } from "@supabase/supabase-js";
import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import type {
  AuditLogRepository,
  LawyerCoordinates,
  LawyerRecord,
  LawyerRepository,
  LegalSpecialty,
  LegalSpecialtyRepository,
  MatchEventInput,
  MatchEventRepository,
  MatchRepository,
  NearestLawyerInput,
  Profile,
  ProfileRepository,
  PublicLawyerProfile,
  PublicLawyerProfileRepository,
  Repositories
} from "./types.js";

function assertSupabaseOk(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getById(id: string): Promise<Profile | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select("id, role, name, email, phone")
      .eq("id", id)
      .maybeSingle();
    assertSupabaseOk(error, "profiles.getById");
    return data as Profile | null;
  }

  async createLawyerProfile(input: Pick<LawyerCreate, "name" | "email" | "whatsapp">): Promise<Profile> {
    const { data, error } = await this.supabase
      .from("profiles")
      .insert({
        role: "lawyer",
        name: input.name,
        email: input.email,
        phone: input.whatsapp
      })
      .select("id, role, name, email, phone")
      .single();
    assertSupabaseOk(error, "profiles.createLawyerProfile");
    return data as Profile;
  }
}

class SupabaseLegalSpecialtyRepository implements LegalSpecialtyRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listActive(): Promise<LegalSpecialty[]> {
    const { data, error } = await this.supabase
      .from("legal_specialties")
      .select("id, slug, name, active")
      .eq("active", true)
      .order("name", { ascending: true });
    assertSupabaseOk(error, "legal_specialties.listActive");
    return (data ?? []) as LegalSpecialty[];
  }
}

// Inclui office_lat/office_lng para refletir a coordenada persistida no escritorio.
const LAWYER_COLUMNS =
  "id, profile_id, status, oab_number, oab_state, whatsapp, office_cep, office_number, office_lat, office_lng, created_at, updated_at";

type LawyerRow = {
  id: string;
  profile_id: string;
  status: LawyerRecord["status"];
  oab_number: string;
  oab_state: string;
  whatsapp: string;
  office_cep: string;
  office_number: string;
  office_lat: number | string | null;
  office_lng: number | string | null;
  created_at: string;
  updated_at: string;
};

const toCoord = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

/**
 * Monta a geografia 4326 a partir de lng/lat no formato EWKT aceito pelo
 * PostGIS (mesmo formato usado em `match_events.client_location`). Espelha o
 * `st_setsrid(st_makepoint(lng, lat), 4326)` do seed `001_match_fixtures.sql`.
 */
const toOfficeLocation = (coordinates: LawyerCoordinates): string =>
  `SRID=4326;POINT(${coordinates.lng} ${coordinates.lat})`;

class SupabaseLawyerRepository implements LawyerRepository {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly profiles: ProfileRepository
  ) {}

  private mapRow(row: LawyerRow, overrides: Partial<LawyerRecord> = {}): LawyerRecord {
    return {
      id: row.id,
      profileId: row.profile_id,
      name: "",
      email: "",
      whatsapp: row.whatsapp,
      oabNumber: row.oab_number,
      oabState: row.oab_state,
      mainAreaId: "",
      secondaryAreaIds: [],
      officeCep: row.office_cep,
      officeNumber: row.office_number,
      status: row.status,
      officeLat: toCoord(row.office_lat),
      officeLng: toCoord(row.office_lng),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...overrides
    };
  }

  async list(): Promise<LawyerRecord[]> {
    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .select(LAWYER_COLUMNS)
      .order("created_at", { ascending: false });
    assertSupabaseOk(error, "lawyer_profiles.list");

    return ((data ?? []) as LawyerRow[]).map((row) => this.mapRow(row));
  }

  async getById(id: string): Promise<LawyerRecord | null> {
    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .select(LAWYER_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    assertSupabaseOk(error, "lawyer_profiles.getById");
    if (!data) return null;
    return this.mapRow(data as LawyerRow);
  }

  async create(input: LawyerCreate, coordinates?: LawyerCoordinates): Promise<LawyerRecord> {
    const profile = await this.profiles.createLawyerProfile(input);
    const insertPayload: Record<string, unknown> = {
      profile_id: profile.id,
      status: input.status,
      oab_number: input.oabNumber,
      oab_state: input.oabState.toUpperCase(),
      whatsapp: input.whatsapp,
      office_cep: input.officeCep.replace(/\D/g, ""),
      office_number: input.officeNumber
    };
    if (coordinates) {
      insertPayload.office_lat = coordinates.lat;
      insertPayload.office_lng = coordinates.lng;
      insertPayload.office_location = toOfficeLocation(coordinates);
    }

    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .insert(insertPayload)
      .select(LAWYER_COLUMNS)
      .single();
    assertSupabaseOk(error, "lawyer_profiles.create");
    if (!data) {
      throw new Error("lawyer_profiles.create: Supabase nao retornou registro criado.");
    }

    return this.mapRow(data as LawyerRow, {
      name: input.name,
      email: input.email,
      mainAreaId: input.mainAreaId,
      secondaryAreaIds: input.secondaryAreaIds
    });
  }

  async update(id: string, patch: LawyerPatch, coordinates?: LawyerCoordinates): Promise<LawyerRecord | null> {
    const updatePayload: Record<string, unknown> = {};
    if (patch.status) updatePayload.status = patch.status;
    if (patch.oabNumber) updatePayload.oab_number = patch.oabNumber;
    if (patch.oabState) updatePayload.oab_state = patch.oabState.toUpperCase();
    if (patch.whatsapp) updatePayload.whatsapp = patch.whatsapp;
    if (patch.officeCep) updatePayload.office_cep = patch.officeCep.replace(/\D/g, "");
    if (patch.officeNumber) updatePayload.office_number = patch.officeNumber;
    if (coordinates) {
      updatePayload.office_lat = coordinates.lat;
      updatePayload.office_lng = coordinates.lng;
      updatePayload.office_location = toOfficeLocation(coordinates);
    }

    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .update(updatePayload)
      .eq("id", id)
      .select(LAWYER_COLUMNS)
      .maybeSingle();
    assertSupabaseOk(error, "lawyer_profiles.update");
    if (!data) return null;

    return this.mapRow(data as LawyerRow, {
      name: patch.name ?? "",
      email: patch.email ?? "",
      mainAreaId: patch.mainAreaId ?? "",
      secondaryAreaIds: patch.secondaryAreaIds ?? []
    });
  }
}

type PublicLawyerProfileRow = {
  id: string;
  oab_number: string;
  oab_state: string;
  whatsapp: string;
  office_city: string | null;
  office_state: string | null;
  profiles: { name: string } | Array<{ name: string }>;
  lawyer_specialties: Array<{
    specialty_id: string;
    legal_specialties: { id: string; name: string } | Array<{ id: string; name: string }>;
  }>;
};

function firstRelation<T>(value: T | T[]): T {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation) {
    throw new Error("lawyer_profiles.getApprovedPublicById: relacao obrigatoria ausente.");
  }
  return relation;
}

class SupabasePublicLawyerProfileRepository implements PublicLawyerProfileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getApprovedById(id: string): Promise<PublicLawyerProfile | null> {
    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .select(
        "id, oab_number, oab_state, whatsapp, office_city, office_state, profiles!inner(name), lawyer_specialties(specialty_id, legal_specialties!inner(id, name))"
      )
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle();
    assertSupabaseOk(error, "lawyer_profiles.getApprovedPublicById");
    if (!data) return null;

    const row = data as unknown as PublicLawyerProfileRow;
    const profile = firstRelation(row.profiles);
    const areas = row.lawyer_specialties.map((specialty) => firstRelation(specialty.legal_specialties));
    return {
      id: row.id,
      name: profile.name,
      oabNumber: row.oab_number,
      oabState: row.oab_state,
      city: row.office_city,
      state: row.office_state,
      areaIds: areas.map((area) => area.id),
      areas,
      whatsapp: row.whatsapp,
      verified: true
    };
  }
}

class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(input: {
    actorProfileId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const { error } = await this.supabase.from("audit_logs").insert({
      actor_profile_id: input.actorProfileId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      metadata: input.metadata ?? {}
    });
    assertSupabaseOk(error, "audit_logs.record");
  }
}

type MatchNearestRow = {
  lawyer_profile_id: string;
  name: string;
  whatsapp: string;
  office_city: string | null;
  office_state: string | null;
  area_ids: string[] | null;
  distance_km: number | string;
};

class SupabaseMatchRepository implements MatchRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findNearest(input: NearestLawyerInput) {
    const { data, error } = await this.supabase.rpc("match_nearest_lawyer", {
      p_lat: input.lat,
      p_lng: input.lng,
      p_area_ids: input.areaIds,
      p_max_radius_km: input.maxRadiusKm
    });
    assertSupabaseOk(error, "match.findNearest");

    const row = (data as MatchNearestRow[] | null)?.[0];
    if (!row) return null;

    return {
      lawyer: {
        id: row.lawyer_profile_id,
        name: row.name,
        whatsapp: row.whatsapp,
        city: row.office_city,
        state: row.office_state,
        areaIds: row.area_ids ?? []
      },
      distanceKm: Number(row.distance_km)
    };
  }
}

class SupabaseMatchEventRepository implements MatchEventRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async record(input: MatchEventInput) {
    const { error } = await this.supabase.from("match_events").insert({
      client_profile_id: input.clientProfileId,
      lawyer_profile_id: input.lawyerProfileId,
      client_location: `SRID=4326;POINT(${input.lng} ${input.lat})`,
      accuracy_m: input.accuracyM,
      specialty_ids: input.specialtyIds,
      distance_km: input.distanceKm,
      algorithm_version: input.algorithmVersion
    });
    assertSupabaseOk(error, "match_events.record");
  }
}

export function createSupabaseRepositories(supabase: SupabaseClient): Repositories {
  const profiles = new SupabaseProfileRepository(supabase);
  return {
    profiles,
    legalSpecialties: new SupabaseLegalSpecialtyRepository(supabase),
    lawyers: new SupabaseLawyerRepository(supabase, profiles),
    publicLawyerProfiles: new SupabasePublicLawyerProfileRepository(supabase),
    auditLogs: new SupabaseAuditLogRepository(supabase),
    matches: new SupabaseMatchRepository(supabase),
    matchEvents: new SupabaseMatchEventRepository(supabase),
    mode: "supabase"
  };
}
