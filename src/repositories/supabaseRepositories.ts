import type { SupabaseClient } from "@supabase/supabase-js";
import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import type {
  AuditLogRepository,
  LawyerCoordinates,
  LawyerDashboard,
  LawyerDashboardRepository,
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
  PrayerRequestRepository,
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
      .select("id, role, name, email, phone, avatar_url, cover_url")
      .eq("id", id)
      .maybeSingle();
    assertSupabaseOk(error, "profiles.getById");
    if (!data) return null;
    const row = data as {
      id: string;
      role: Profile["role"];
      name: string;
      email: string;
      phone: string | null;
      avatar_url: string | null;
      cover_url: string | null;
    };
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      email: row.email,
      phone: row.phone,
      avatarUrl: row.avatar_url,
      coverUrl: row.cover_url
    };
  }

  async createLawyerProfile(input: Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">): Promise<Profile> {
    const { data, error } = await this.supabase
      .from("profiles")
      .insert({
        role: "lawyer",
        name: input.name,
        email: input.email,
        phone: input.whatsapp,
        avatar_url: input.avatarUrl ?? null,
        cover_url: input.coverUrl ?? null
      })
      .select("id, role, name, email, phone, avatar_url, cover_url")
      .single();
    assertSupabaseOk(error, "profiles.createLawyerProfile");
    const row = data as {
      id: string;
      role: Profile["role"];
      name: string;
      email: string;
      phone: string | null;
      avatar_url: string | null;
      cover_url: string | null;
    };
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      email: row.email,
      phone: row.phone,
      avatarUrl: row.avatar_url,
      coverUrl: row.cover_url
    };
  }

  async updateVisualFields(profileId: string, input: Pick<Profile, "avatarUrl" | "coverUrl">): Promise<void> {
    const payload: Record<string, string | null> = {};
    if (input.avatarUrl !== undefined) payload.avatar_url = input.avatarUrl ?? null;
    if (input.coverUrl !== undefined) payload.cover_url = input.coverUrl ?? null;
    if (Object.keys(payload).length === 0) return;

    const { error } = await this.supabase
      .from("profiles")
      .update(payload)
      .eq("id", profileId);
    assertSupabaseOk(error, "profiles.updateVisualFields");
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
  "id, profile_id, status, oab_number, oab_state, whatsapp, mini_bio, full_bio, office_cep, office_number, office_city, office_state, office_lat, office_lng, created_at, updated_at";

type LawyerRow = {
  id: string;
  profile_id: string;
  status: LawyerRecord["status"];
  oab_number: string;
  oab_state: string;
  whatsapp: string;
  mini_bio: string | null;
  full_bio: string | null;
  office_cep: string;
  office_number: string;
  office_city: string | null;
  office_state: string | null;
  office_lat: number | string | null;
  office_lng: number | string | null;
  created_at: string;
  updated_at: string;
};

type LawyerProfileSummary = {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  cover_url: string | null;
};

type LawyerSpecialtyRow = {
  lawyer_profile_id: string;
  specialty_id: string;
  is_main: boolean;
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
      miniBio: row.mini_bio,
      fullBio: row.full_bio,
      oabNumber: row.oab_number,
      oabState: row.oab_state,
      mainAreaId: "",
      secondaryAreaIds: [],
      officeCep: row.office_cep,
      officeNumber: row.office_number,
      officeCity: row.office_city,
      officeState: row.office_state,
      status: row.status,
      officeLat: toCoord(row.office_lat),
      officeLng: toCoord(row.office_lng),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...overrides
    };
  }

  private async hydrateRows(rows: LawyerRow[]): Promise<LawyerRecord[]> {
    if (rows.length === 0) return [];

    const profileIds = [...new Set(rows.map((row) => row.profile_id))];
    const lawyerIds = rows.map((row) => row.id);

    const { data: profilesData, error: profilesError } = await this.supabase
      .from("profiles")
      .select("id, name, email, avatar_url, cover_url")
      .in("id", profileIds);
    assertSupabaseOk(profilesError, "profiles.listLawyerSummaries");

    const { data: specialtiesData, error: specialtiesError } = await this.supabase
      .from("lawyer_specialties")
      .select("lawyer_profile_id, specialty_id, is_main")
      .in("lawyer_profile_id", lawyerIds);
    assertSupabaseOk(specialtiesError, "lawyer_specialties.listForLawyers");

    const profileById = new Map(
      ((profilesData ?? []) as LawyerProfileSummary[]).map((profile) => [profile.id, profile])
    );
    const specialtiesByLawyer = new Map<string, LawyerSpecialtyRow[]>();
    for (const specialty of (specialtiesData ?? []) as LawyerSpecialtyRow[]) {
      const current = specialtiesByLawyer.get(specialty.lawyer_profile_id) ?? [];
      current.push(specialty);
      specialtiesByLawyer.set(specialty.lawyer_profile_id, current);
    }

    return rows.map((row) => {
      const profile = profileById.get(row.profile_id);
      const specialties = specialtiesByLawyer.get(row.id) ?? [];
      const mainArea = specialties.find((specialty) => specialty.is_main) ?? specialties[0];
      return this.mapRow(row, {
        name: profile?.name ?? "",
        email: profile?.email ?? "",
        avatarUrl: profile?.avatar_url ?? null,
        coverUrl: profile?.cover_url ?? null,
        mainAreaId: mainArea?.specialty_id ?? "",
        secondaryAreaIds: specialties
          .filter((specialty) => specialty.specialty_id !== mainArea?.specialty_id)
          .map((specialty) => specialty.specialty_id)
      });
    });
  }

  async list(): Promise<LawyerRecord[]> {
    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .select(LAWYER_COLUMNS)
      .order("created_at", { ascending: false });
    assertSupabaseOk(error, "lawyer_profiles.list");

    return this.hydrateRows((data ?? []) as LawyerRow[]);
  }

  async getById(id: string): Promise<LawyerRecord | null> {
    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .select(LAWYER_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    assertSupabaseOk(error, "lawyer_profiles.getById");
    if (!data) return null;
    const [lawyer] = await this.hydrateRows([data as LawyerRow]);
    return lawyer ?? null;
  }

  async create(input: LawyerCreate, coordinates?: LawyerCoordinates): Promise<LawyerRecord> {
    const profile = await this.profiles.createLawyerProfile(input);
    const insertPayload: Record<string, unknown> = {
      profile_id: profile.id,
      status: input.status,
      oab_number: input.oabNumber,
      oab_state: input.oabState.toUpperCase(),
      whatsapp: input.whatsapp,
      mini_bio: input.miniBio ?? null,
      full_bio: input.fullBio ?? null,
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

    const specialtyRows = [
      { lawyer_profile_id: (data as LawyerRow).id, specialty_id: input.mainAreaId, is_main: true },
      ...input.secondaryAreaIds.map((specialtyId) => ({
        lawyer_profile_id: (data as LawyerRow).id,
        specialty_id: specialtyId,
        is_main: false
      }))
    ];
    if (specialtyRows.length > 0) {
      const { error: specialtiesError } = await this.supabase
        .from("lawyer_specialties")
        .upsert(specialtyRows, { onConflict: "lawyer_profile_id,specialty_id" });
      assertSupabaseOk(specialtiesError, "lawyer_specialties.createForLawyer");
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
    if (patch.miniBio !== undefined) updatePayload.mini_bio = patch.miniBio;
    if (patch.fullBio !== undefined) updatePayload.full_bio = patch.fullBio;
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
    if (patch.mainAreaId || patch.secondaryAreaIds) {
      const nextAreaIds = [patch.mainAreaId, ...(patch.secondaryAreaIds ?? [])].filter(
        (areaId): areaId is string => Boolean(areaId)
      );
      if (nextAreaIds.length > 0) {
        const { error: deleteError } = await this.supabase
          .from("lawyer_specialties")
          .delete()
          .eq("lawyer_profile_id", id);
        assertSupabaseOk(deleteError, "lawyer_specialties.replace.delete");

        const { error: insertError } = await this.supabase
          .from("lawyer_specialties")
          .insert(
            nextAreaIds.map((specialtyId, index) => ({
              lawyer_profile_id: id,
              specialty_id: specialtyId,
              is_main: index === 0
            }))
          );
        assertSupabaseOk(insertError, "lawyer_specialties.replace.insert");
      }
    }
    if (patch.avatarUrl !== undefined || patch.coverUrl !== undefined) {
      await this.profiles.updateVisualFields((data as LawyerRow).profile_id, {
        avatarUrl: patch.avatarUrl,
        coverUrl: patch.coverUrl
      });
    }

    const [lawyer] = await this.hydrateRows([data as LawyerRow]);
    return lawyer ?? null;
  }
}

type PublicLawyerProfileRow = {
  id: string;
  oab_number: string;
  oab_state: string;
  whatsapp: string;
  mini_bio: string | null;
  full_bio: string | null;
  office_city: string | null;
  office_state: string | null;
  profiles: { name: string; avatar_url: string | null; cover_url: string | null } | Array<{ name: string; avatar_url: string | null; cover_url: string | null }>;
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
        "id, oab_number, oab_state, whatsapp, mini_bio, full_bio, office_city, office_state, profiles!inner(name, avatar_url, cover_url), lawyer_specialties(specialty_id, legal_specialties!inner(id, name))"
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
      verified: true,
      avatarUrl: profile.avatar_url,
      coverUrl: profile.cover_url,
      miniBio: row.mini_bio,
      fullBio: row.full_bio,
      yearsExperience: null,
      planLabel: null,
      emergencyAvailable: false
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

type LawyerDashboardRow = {
  id: string;
  oab_number: string;
  oab_state: string;
  profiles: { name: string; avatar_url: string | null; cover_url: string | null } | Array<{ name: string; avatar_url: string | null; cover_url: string | null }>;
};

const staticLawyerBenefits: LawyerDashboard["benefits"] = [
  {
    id: "verified-profile",
    title: "Perfil verificado",
    description: "Presenca profissional no app com dados revisados pelo admin.",
    badge: "MVP"
  },
  {
    id: "external-whatsapp",
    title: "Contato externo seguro",
    description: "Atendimento segue pelo WhatsApp, sem chat interno no MVP."
  }
];

class SupabaseLawyerDashboardRepository implements LawyerDashboardRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getByProfileId(profileId: string): Promise<LawyerDashboard | null> {
    const { data, error } = await this.supabase
      .from("lawyer_profiles")
      .select("id, oab_number, oab_state, profiles!inner(name, avatar_url, cover_url)")
      .eq("profile_id", profileId)
      .in("status", ["approved", "pending_review", "draft"])
      .limit(1)
      .maybeSingle();
    assertSupabaseOk(error, "lawyer_profiles.getDashboardByProfileId");
    if (!data) return null;

    const row = data as unknown as LawyerDashboardRow;
    const profile = firstRelation(row.profiles);
    return {
      lawyer: {
        id: row.id,
        name: profile.name,
        oabNumber: row.oab_number,
        oabState: row.oab_state,
        avatarUrl: profile.avatar_url,
        coverUrl: profile.cover_url,
        planLabel: "MVP interno",
        verified: true
      },
      metrics: {
        profileViews: 0,
        whatsappClicks: 0,
        contacts: 0
      },
      benefits: staticLawyerBenefits
    };
  }
}

class SupabasePrayerRequestRepository implements PrayerRequestRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: Parameters<PrayerRequestRepository["create"]>[0]) {
    const { data, error } = await this.supabase
      .from("prayer_requests")
      .insert({
        client_profile_id: input.anonymous ? null : input.clientProfileId,
        message: input.message,
        anonymous: input.anonymous,
        status: "received"
      })
      .select("id, status, created_at")
      .single();
    assertSupabaseOk(error, "prayer_requests.create");
    const row = data as { id: string; status: "received"; created_at: string };
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at
    };
  }
}

export function createSupabaseRepositories(supabase: SupabaseClient): Repositories {
  const profiles = new SupabaseProfileRepository(supabase);
  return {
    profiles,
    legalSpecialties: new SupabaseLegalSpecialtyRepository(supabase),
    lawyers: new SupabaseLawyerRepository(supabase, profiles),
    publicLawyerProfiles: new SupabasePublicLawyerProfileRepository(supabase),
    lawyerDashboards: new SupabaseLawyerDashboardRepository(supabase),
    prayerRequests: new SupabasePrayerRequestRepository(supabase),
    auditLogs: new SupabaseAuditLogRepository(supabase),
    matches: new SupabaseMatchRepository(supabase),
    matchEvents: new SupabaseMatchEventRepository(supabase),
    mode: "supabase"
  };
}
