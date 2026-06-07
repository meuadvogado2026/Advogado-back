import type { SupabaseClient } from "@supabase/supabase-js";
import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import type {
  AuditLogRepository,
  AdminPrayerRequestRecord,
  AdminUserRecord,
  LawyerCoordinates,
  LawyerDashboard,
  LawyerDashboardRepository,
  LawyerMediaRepository,
  LawyerOfficeLocation,
  LawyerRecord,
  LawyerRepository,
  LegalSpecialty,
  LegalSpecialtyRepository,
  MatchEventInput,
  MatchEventRepository,
  MatchRepository,
  NearestLawyerInput,
  PartnerLogoRecord,
  PartnerLogoRepository,
  Profile,
  ProfileRepository,
  PublicLawyerProfile,
  PublicLawyerProfileRepository,
  PrayerRequestRepository,
  Repositories,
  StoredAdminImage,
  StoredLawyerImage
} from "./types.js";

function assertSupabaseOk(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

const PROFILE_COLUMNS =
  "id, role, name, email, phone, avatar_url, cover_url, blocked_at, must_change_password, access_invited_at, first_login_completed_at, created_at, updated_at";

type ProfileRow = {
  id: string;
  role: Profile["role"];
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  blocked_at: string | null;
  must_change_password: boolean | null;
  access_invited_at: string | null;
  first_login_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    coverUrl: row.cover_url,
    blockedAt: row.blocked_at,
    mustChangePassword: row.must_change_password ?? false,
    accessInvitedAt: row.access_invited_at,
    firstLoginCompletedAt: row.first_login_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getById(id: string): Promise<Profile | null> {
    const { data, error } = await this.supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    assertSupabaseOk(error, "profiles.getById");
    if (!data) return null;
    return mapProfile(data as ProfileRow);
  }

  async listAdminUsers(): Promise<AdminUserRecord[]> {
    const { data: profilesData, error: profilesError } = await this.supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .order("created_at", { ascending: false });
    assertSupabaseOk(profilesError, "profiles.listAdminUsers");

    const { data: lawyersData, error: lawyersError } = await this.supabase
      .from("lawyer_profiles")
      .select("id, profile_id, status");
    assertSupabaseOk(lawyersError, "lawyer_profiles.listForUsers");

    const lawyerByProfileId = new Map(
      ((lawyersData ?? []) as Array<{ id: string; profile_id: string; status: LawyerRecord["status"] }>).map((lawyer) => [
        lawyer.profile_id,
        lawyer
      ])
    );

    return ((profilesData ?? []) as ProfileRow[]).map((profile) => {
      const lawyer = lawyerByProfileId.get(profile.id);
      return {
        id: profile.id,
        role: profile.role,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        avatarUrl: profile.avatar_url,
        coverUrl: profile.cover_url,
        blockedAt: profile.blocked_at,
        mustChangePassword: profile.must_change_password ?? false,
        accessInvitedAt: profile.access_invited_at,
        firstLoginCompletedAt: profile.first_login_completed_at,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
        lawyerProfileId: lawyer?.id ?? null,
        lawyerStatus: lawyer?.status ?? null
      };
    });
  }

  async createClientProfile(input: { id: string; name: string; email: string }): Promise<Profile> {
    const { data, error } = await this.supabase
      .from("profiles")
      .insert({
        id: input.id,
        role: "client",
        name: input.name,
        email: input.email,
        phone: null,
        blocked_at: null,
        must_change_password: false,
        access_invited_at: null,
        first_login_completed_at: null
      })
      .select(PROFILE_COLUMNS)
      .single();
    assertSupabaseOk(error, "profiles.createClientProfile");
    return mapProfile(data as ProfileRow);
  }

  async createLawyerProfile(
    input: Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">,
    access: { profileId?: string; accessInvitedAt?: string | null; mustChangePassword?: boolean } = {}
  ): Promise<Profile> {
    const { data, error } = await this.supabase
      .from("profiles")
      .insert({
        ...(access.profileId ? { id: access.profileId } : {}),
        role: "lawyer",
        name: input.name,
        email: input.email,
        phone: input.whatsapp,
        avatar_url: input.avatarUrl ?? null,
        cover_url: input.coverUrl ?? null,
        blocked_at: null,
        must_change_password: access.mustChangePassword ?? false,
        access_invited_at: "accessInvitedAt" in access ? access.accessInvitedAt ?? null : null,
        first_login_completed_at: null
      })
      .select(PROFILE_COLUMNS)
      .single();
    assertSupabaseOk(error, "profiles.createLawyerProfile");
    return mapProfile(data as ProfileRow);
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

  async updateLawyerProfile(
    profileId: string,
    input: Partial<Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">>
  ): Promise<void> {
    const payload: Record<string, string | null> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.email !== undefined) payload.email = input.email;
    if (input.whatsapp !== undefined) payload.phone = input.whatsapp;
    if (input.avatarUrl !== undefined) payload.avatar_url = input.avatarUrl ?? null;
    if (input.coverUrl !== undefined) payload.cover_url = input.coverUrl ?? null;
    if (Object.keys(payload).length === 0) return;

    const { error } = await this.supabase
      .from("profiles")
      .update(payload)
      .eq("id", profileId);
    assertSupabaseOk(error, "profiles.updateLawyerProfile");
  }

  async updateBlocked(profileId: string, blocked: boolean): Promise<AdminUserRecord | null> {
    const { error } = await this.supabase
      .from("profiles")
      .update({ blocked_at: blocked ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", profileId);
    assertSupabaseOk(error, "profiles.updateBlocked");

    const users = await this.listAdminUsers();
    return users.find((user) => user.id === profileId) ?? null;
  }

  async markFirstLoginCompleted(profileId: string): Promise<Profile | null> {
    const existing = await this.getById(profileId);
    if (!existing || existing.firstLoginCompletedAt) return existing;

    const { data, error } = await this.supabase
      .from("profiles")
      .update({ first_login_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", profileId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    assertSupabaseOk(error, "profiles.markFirstLoginCompleted");
    return data ? mapProfile(data as ProfileRow) : null;
  }

  async markPasswordChanged(profileId: string): Promise<Profile | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("profiles")
      .update({ must_change_password: false, first_login_completed_at: now, updated_at: now })
      .eq("id", profileId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    assertSupabaseOk(error, "profiles.markPasswordChanged");
    return data ? mapProfile(data as ProfileRow) : null;
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
  "id, profile_id, status, oab_number, oab_state, whatsapp, mini_bio, full_bio, instagram_url, linkedin_url, facebook_url, website_url, office_cep, office_number, office_city, office_state, office_lat, office_lng, office_location, office_geocode_provider, office_geocode_precision, office_geocode_confidence, office_geocoded_at, created_at, updated_at";

type LawyerRow = {
  id: string;
  profile_id: string;
  status: LawyerRecord["status"];
  oab_number: string;
  oab_state: string;
  whatsapp: string;
  mini_bio: string | null;
  full_bio: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
  office_cep: string;
  office_number: string;
  office_city: string | null;
  office_state: string | null;
  office_lat: number | string | null;
  office_lng: number | string | null;
  office_location: unknown | null;
  office_geocode_provider: LawyerRecord["officeGeocodeProvider"];
  office_geocode_precision: LawyerRecord["officeGeocodePrecision"];
  office_geocode_confidence: LawyerRecord["officeGeocodeConfidence"];
  office_geocoded_at: string | null;
  created_at: string;
  updated_at: string;
};

type LawyerProfileSummary = {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  cover_url: string | null;
  must_change_password: boolean | null;
  access_invited_at: string | null;
  first_login_completed_at: string | null;
};

type LawyerSpecialtyRow = {
  lawyer_profile_id: string;
  specialty_id: string;
  is_main: boolean;
};

const toCoord = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

function officeLocationStatus(row: LawyerRow): LawyerRecord["officeLocationStatus"] {
  const lat = toCoord(row.office_lat);
  const lng = toCoord(row.office_lng);
  const hasCoordinate =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    row.office_location !== null;
  if (!hasCoordinate) return "pending";
  if (
    row.office_geocode_confidence === "high" &&
    (row.office_geocode_precision === "street" || row.office_geocode_precision === "manual")
  ) {
    return "validated";
  }
  return "needs_confirmation";
}

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
      instagramUrl: row.instagram_url,
      linkedinUrl: row.linkedin_url,
      facebookUrl: row.facebook_url,
      websiteUrl: row.website_url,
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
      officeLocationPresent: row.office_location !== null,
      officeGeocodeProvider: row.office_geocode_provider,
      officeGeocodePrecision: row.office_geocode_precision,
      officeGeocodeConfidence: row.office_geocode_confidence,
      officeGeocodedAt: row.office_geocoded_at,
      officeLocationStatus: officeLocationStatus(row),
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
      .select("id, name, email, avatar_url, cover_url, must_change_password, access_invited_at, first_login_completed_at")
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
        mustChangePassword: profile?.must_change_password ?? false,
        accessInvitedAt: profile?.access_invited_at ?? null,
        firstLoginCompletedAt: profile?.first_login_completed_at ?? null,
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

  async create(
    input: LawyerCreate,
    location?: LawyerOfficeLocation,
    access?: { profileId?: string; accessInvitedAt?: string | null; mustChangePassword?: boolean }
  ): Promise<LawyerRecord> {
    const profile = await this.profiles.createLawyerProfile(input, access);
    const insertPayload: Record<string, unknown> = {
      profile_id: profile.id,
      status: input.status,
      oab_number: input.oabNumber,
      oab_state: input.oabState.toUpperCase(),
      whatsapp: input.whatsapp,
      mini_bio: input.miniBio ?? null,
      full_bio: input.fullBio ?? null,
      instagram_url: input.instagramUrl ?? null,
      linkedin_url: input.linkedinUrl ?? null,
      facebook_url: input.facebookUrl ?? null,
      website_url: input.websiteUrl ?? null,
      office_cep: input.officeCep.replace(/\D/g, ""),
      office_number: input.officeNumber
    };
    if (location?.address) {
      insertPayload.office_city = location.address.city;
      insertPayload.office_state = location.address.state;
    }
    if (location?.coordinates) {
      insertPayload.office_lat = location.coordinates.lat;
      insertPayload.office_lng = location.coordinates.lng;
      insertPayload.office_location = toOfficeLocation(location.coordinates);
    }
    if (location?.geocode) {
      insertPayload.office_geocode_provider = location.geocode.provider;
      insertPayload.office_geocode_precision = location.geocode.precision;
      insertPayload.office_geocode_confidence = location.geocode.confidence;
      insertPayload.office_geocoded_at = location.geocode.geocodedAt ?? new Date().toISOString();
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
      mustChangePassword: profile.mustChangePassword ?? false,
      accessInvitedAt: profile.accessInvitedAt ?? null,
      firstLoginCompletedAt: profile.firstLoginCompletedAt ?? null,
      mainAreaId: input.mainAreaId,
      secondaryAreaIds: input.secondaryAreaIds
    });
  }

  async activateAccess(lawyerId: string, access: { profileId: string; accessInvitedAt?: string | null }): Promise<LawyerRecord | null> {
    const existing = await this.getById(lawyerId);
    if (!existing) return null;
    if (existing.profileId === access.profileId) return existing;

    const { error } = await this.supabase.rpc("activate_lawyer_profile_access", {
      old_profile_id: existing.profileId,
      new_profile_id: access.profileId,
      invited_at: access.accessInvitedAt ?? new Date().toISOString()
    });
    assertSupabaseOk(error, "lawyer_profiles.activateAccess");

    return this.getById(lawyerId);
  }

  async update(id: string, patch: LawyerPatch, location?: LawyerOfficeLocation): Promise<LawyerRecord | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updatePayload: Record<string, unknown> = {};
    if (patch.status) updatePayload.status = patch.status;
    if (patch.oabNumber) updatePayload.oab_number = patch.oabNumber;
    if (patch.oabState) updatePayload.oab_state = patch.oabState.toUpperCase();
    if (patch.whatsapp) updatePayload.whatsapp = patch.whatsapp;
    if (patch.miniBio !== undefined) updatePayload.mini_bio = patch.miniBio;
    if (patch.fullBio !== undefined) updatePayload.full_bio = patch.fullBio;
    if (patch.instagramUrl !== undefined) updatePayload.instagram_url = patch.instagramUrl;
    if (patch.linkedinUrl !== undefined) updatePayload.linkedin_url = patch.linkedinUrl;
    if (patch.facebookUrl !== undefined) updatePayload.facebook_url = patch.facebookUrl;
    if (patch.websiteUrl !== undefined) updatePayload.website_url = patch.websiteUrl;
    if (patch.officeCep) updatePayload.office_cep = patch.officeCep.replace(/\D/g, "");
    if (patch.officeNumber) updatePayload.office_number = patch.officeNumber;
    if (location?.address) {
      updatePayload.office_city = location.address.city;
      updatePayload.office_state = location.address.state;
    }
    if (location?.coordinates) {
      updatePayload.office_lat = location.coordinates.lat;
      updatePayload.office_lng = location.coordinates.lng;
      updatePayload.office_location = toOfficeLocation(location.coordinates);
    } else if (location?.clearCoordinates) {
      updatePayload.office_lat = null;
      updatePayload.office_lng = null;
      updatePayload.office_location = null;
      updatePayload.office_geocode_provider = null;
      updatePayload.office_geocode_precision = null;
      updatePayload.office_geocode_confidence = null;
      updatePayload.office_geocoded_at = null;
    }
    if (location?.geocode) {
      updatePayload.office_geocode_provider = location.geocode.provider;
      updatePayload.office_geocode_precision = location.geocode.precision;
      updatePayload.office_geocode_confidence = location.geocode.confidence;
      updatePayload.office_geocoded_at = location.geocode.geocodedAt ?? new Date().toISOString();
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
    await this.profiles.updateLawyerProfile(existing.profileId, patch);

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
  instagram_url: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
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
        "id, oab_number, oab_state, whatsapp, mini_bio, full_bio, instagram_url, linkedin_url, facebook_url, website_url, office_city, office_state, profiles!inner(name, avatar_url, cover_url), lawyer_specialties(specialty_id, legal_specialties!inner(id, name))"
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
      instagramUrl: row.instagram_url,
      linkedinUrl: row.linkedin_url,
      facebookUrl: row.facebook_url,
      websiteUrl: row.website_url,
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

    const { data: lawyerData, error: lawyerError } = await this.supabase
      .from("lawyer_profiles")
      .select("profile_id")
      .eq("id", row.lawyer_profile_id)
      .maybeSingle();
    assertSupabaseOk(lawyerError, "match.findNearestProfileId");
    const profileId = (lawyerData as { profile_id?: string } | null)?.profile_id;

    const { data: profileData, error: profileError } = profileId
      ? await this.supabase
          .from("profiles")
          .select("avatar_url, cover_url")
          .eq("id", profileId)
          .maybeSingle()
      : { data: null, error: null };
    assertSupabaseOk(profileError, "match.findNearestVisuals");
    const profile = profileData as { avatar_url: string | null; cover_url: string | null } | null;

    return {
      lawyer: {
        id: row.lawyer_profile_id,
        name: row.name,
        whatsapp: row.whatsapp,
        city: row.office_city,
        state: row.office_state,
        areaIds: row.area_ids ?? [],
        avatarUrl: profile?.avatar_url ?? null,
        coverUrl: profile?.cover_url ?? null
      },
      distanceKm: Number(row.distance_km),
      distanceReliable: true
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
      .select("id, status, created_at, read_at")
      .single();
    assertSupabaseOk(error, "prayer_requests.create");
    const row = data as { id: string; status: "received"; created_at: string; read_at: string | null };
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      readAt: row.read_at
    };
  }

  private async hydrateRows(rows: Array<{
    id: string;
    client_profile_id: string | null;
    message: string;
    anonymous: boolean;
    status: "received" | "read";
    created_at: string;
    read_at: string | null;
  }>) {
    const clientIds = [...new Set(rows.map((row) => row.client_profile_id).filter((id): id is string => Boolean(id)))];
    const clientById = new Map<string, { id: string; name: string; email: string }>();

    if (clientIds.length > 0) {
      const { data: clientsData, error: clientsError } = await this.supabase
        .from("profiles")
        .select("id, name, email")
        .in("id", clientIds);
      assertSupabaseOk(clientsError, "profiles.listPrayerClients");
      for (const client of (clientsData ?? []) as Array<{ id: string; name: string; email: string }>) {
        clientById.set(client.id, client);
      }
    }

    return rows.map((row) => ({
      id: row.id,
      message: row.message,
      anonymous: row.anonymous,
      status: row.status,
      createdAt: row.created_at,
      readAt: row.read_at,
      client: row.anonymous || !row.client_profile_id ? null : clientById.get(row.client_profile_id) ?? null
    }));
  }

  async listAdmin(): Promise<AdminPrayerRequestRecord[]> {
    const { data, error } = await this.supabase
      .from("prayer_requests")
      .select("id, client_profile_id, message, anonymous, status, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(100);
    assertSupabaseOk(error, "prayer_requests.listAdmin");

    const rows = (data ?? []) as Array<{
      id: string;
      client_profile_id: string | null;
      message: string;
      anonymous: boolean;
      status: "received" | "read";
      created_at: string;
      read_at: string | null;
    }>;
    return this.hydrateRows(rows);
  }

  async updateStatus(id: string, status: "received" | "read"): Promise<AdminPrayerRequestRecord | null> {
    const { data, error } = await this.supabase
      .from("prayer_requests")
      .update({
        status,
        read_at: status === "read" ? new Date().toISOString() : null
      })
      .eq("id", id)
      .select("id, client_profile_id, message, anonymous, status, created_at, read_at")
      .maybeSingle();
    assertSupabaseOk(error, "prayer_requests.updateStatus");
    if (!data) return null;

    const [request] = await this.hydrateRows([data as {
      id: string;
      client_profile_id: string | null;
      message: string;
      anonymous: boolean;
      status: "received" | "read";
      created_at: string;
      read_at: string | null;
    }]);
    return request ?? null;
  }
}

class SupabaseLawyerMediaRepository implements LawyerMediaRepository {
  private readonly bucket = "lawyer-media";

  constructor(private readonly supabase: SupabaseClient) {}

  async uploadImage(input: Parameters<LawyerMediaRepository["uploadImage"]>[0]): Promise<StoredLawyerImage> {
    const extensionByMime = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    } as const;
    const buffer = Buffer.from(input.base64Data, "base64");
    const path = `lawyers/${input.kind}/${crypto.randomUUID()}.${extensionByMime[input.mimeType]}`;

    const bucket = await this.supabase.storage.getBucket(this.bucket);
    if (bucket.error) {
      const created = await this.supabase.storage.createBucket(this.bucket, {
        public: true,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        fileSizeLimit: 2_000_000
      });
      assertSupabaseOk(created.error, "storage.createLawyerMediaBucket");
    }

    const { error } = await this.supabase.storage.from(this.bucket).upload(path, buffer, {
      contentType: input.mimeType,
      upsert: false
    });
    assertSupabaseOk(error, "storage.uploadLawyerImage");

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path);
    return {
      url: data.publicUrl,
      path,
      contentType: input.mimeType
    };
  }
}

class SupabasePartnerLogoRepository implements PartnerLogoRepository {
  private readonly bucket = "partner-media";

  constructor(private readonly supabase: SupabaseClient) {}

  private mapRow(row: {
    id: string;
    name: string;
    logo_url: string;
    website_url: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
  }): PartnerLogoRecord {
    return {
      id: row.id,
      name: row.name,
      logoUrl: row.logo_url,
      websiteUrl: row.website_url,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async listAdmin(): Promise<PartnerLogoRecord[]> {
    const { data, error } = await this.supabase
      .from("partner_logos")
      .select("id, name, logo_url, website_url, active, created_at, updated_at")
      .order("created_at", { ascending: false });
    assertSupabaseOk(error, "partner_logos.listAdmin");
    return ((data ?? []) as Parameters<SupabasePartnerLogoRepository["mapRow"]>[0][]).map((row) => this.mapRow(row));
  }

  async listPublic(): Promise<PartnerLogoRecord[]> {
    const { data, error } = await this.supabase
      .from("partner_logos")
      .select("id, name, logo_url, website_url, active, created_at, updated_at")
      .eq("active", true)
      .order("created_at", { ascending: false });
    assertSupabaseOk(error, "partner_logos.listPublic");
    return ((data ?? []) as Parameters<SupabasePartnerLogoRepository["mapRow"]>[0][]).map((row) => this.mapRow(row));
  }

  async create(input: Parameters<PartnerLogoRepository["create"]>[0]): Promise<PartnerLogoRecord> {
    const { data, error } = await this.supabase
      .from("partner_logos")
      .insert({
        name: input.name,
        logo_url: input.logoUrl,
        website_url: input.websiteUrl ?? null,
        active: input.active
      })
      .select("id, name, logo_url, website_url, active, created_at, updated_at")
      .single();
    assertSupabaseOk(error, "partner_logos.create");
    return this.mapRow(data as Parameters<SupabasePartnerLogoRepository["mapRow"]>[0]);
  }

  async uploadLogo(input: Parameters<PartnerLogoRepository["uploadLogo"]>[0]): Promise<StoredAdminImage> {
    const extensionByMime = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    } as const;
    const buffer = Buffer.from(input.base64Data, "base64");
    const path = `partners/logos/${crypto.randomUUID()}.${extensionByMime[input.mimeType]}`;

    const bucket = await this.supabase.storage.getBucket(this.bucket);
    if (bucket.error) {
      const created = await this.supabase.storage.createBucket(this.bucket, {
        public: true,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
        fileSizeLimit: 2_000_000
      });
      assertSupabaseOk(created.error, "storage.createPartnerMediaBucket");
    }

    const { error } = await this.supabase.storage.from(this.bucket).upload(path, buffer, {
      contentType: input.mimeType,
      upsert: false
    });
    assertSupabaseOk(error, "storage.uploadPartnerLogo");

    const { data } = this.supabase.storage.from(this.bucket).getPublicUrl(path);
    return {
      url: data.publicUrl,
      path,
      contentType: input.mimeType
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
    lawyerMedia: new SupabaseLawyerMediaRepository(supabase),
    partnerLogos: new SupabasePartnerLogoRepository(supabase),
    auditLogs: new SupabaseAuditLogRepository(supabase),
    matches: new SupabaseMatchRepository(supabase),
    matchEvents: new SupabaseMatchEventRepository(supabase),
    mode: "supabase"
  };
}
