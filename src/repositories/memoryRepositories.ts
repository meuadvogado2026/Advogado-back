import type { AdminBenefitCreate, AdminBenefitPatch, CityCreate, CityPatch, LawyerCreate, LawyerPatch, StateCreate, StatePatch } from "../contracts/api.js";
import { legalAreas } from "../modules/areas/legalAreas.js";
import type {
  AuditLogRepository,
  BenefitRecord,
  BenefitRepository,
  CityRecord,
  GeographyRepository,
  LawyerDashboardRepository,
  LawyerMediaRepository,
  LawyerOfficeLocation,
  LawyerRecord,
  LawyerRepository,
  LegalSpecialtyRepository,
  MatchEventRepository,
  MatchRepository,
  NearestLawyerInput,
  PartnerLogoRecord,
  PartnerLogoRepository,
  Profile,
  ProfileRepository,
  PublicLawyerProfileRepository,
  PageInput,
  PageResult,
  StoredAdminImage,
  StoredLawyerImage,
  PrayerRequestRepository,
  Repositories
} from "./types.js";

const profiles = new Map<string, Profile>();
const lawyers = new Map<string, LawyerRecord>();
const states = new Map<string, import("./types.js").StateRecord>();
const cities = new Map<string, CityRecord>();
const DEFAULT_STATE_ID = "10000000-0000-4000-8000-000000000001";
const DEFAULT_CITY_ID = "20000000-0000-4000-8000-000000000001";
const DEFAULT_CITY_CENTER = { lat: -15.793889, lng: -47.882778 };
if (states.size === 0) {
  const now = new Date().toISOString();
  states.set(DEFAULT_STATE_ID, { id: DEFAULT_STATE_ID, code: "DF", name: "Distrito Federal", active: true, createdAt: now, updatedAt: now });
  cities.set(DEFAULT_CITY_ID, { id: DEFAULT_CITY_ID, stateId: DEFAULT_STATE_ID, stateCode: "DF", name: "Brasilia", active: true, center: DEFAULT_CITY_CENTER, createdAt: now, updatedAt: now });
}
const prayerRequests: Array<{
  id: string;
  clientProfileId: string | null;
  message: string;
  anonymous: boolean;
  status: "received" | "read";
  createdAt: string;
  readAt?: string | null;
}> = [];
const partnerLogos: PartnerLogoRecord[] = [];
const benefits: BenefitRecord[] = [];

const seedCreatedAt = "2026-06-03T00:00:00.000Z";
benefits.push({
  id: "verified-profile",
  title: "Perfil verificado",
  description: "Presenca profissional no app com dados revisados pelo admin.",
  badge: "MVP",
  redemptionUrl: null,
  active: true,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});

function pageItems<T>(items: T[], input: PageInput): PageResult<T> {
  const start = (input.page - 1) * input.pageSize;
  return {
    items: items.slice(start, start + input.pageSize),
    total: items.length
  };
}

function normalizeSearch(value: string) {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function officeLocationStatus(input: {
  officeLat?: number | null;
  officeLng?: number | null;
  officeLocationPresent?: boolean;
  officeGeocodePrecision?: LawyerRecord["officeGeocodePrecision"];
  officeGeocodeConfidence?: LawyerRecord["officeGeocodeConfidence"];
}): LawyerRecord["officeLocationStatus"] {
  const hasCoordinate =
    typeof input.officeLat === "number" &&
    typeof input.officeLng === "number" &&
    Number.isFinite(input.officeLat) &&
    Number.isFinite(input.officeLng) &&
    input.officeLocationPresent === true;
  if (!hasCoordinate) return "pending";
  if (
    input.officeGeocodeConfidence === "high" &&
    (input.officeGeocodePrecision === "street" || input.officeGeocodePrecision === "manual")
  ) {
    return "validated";
  }
  return "needs_confirmation";
}

profiles.set("test-admin-user", {
  id: "test-admin-user",
  role: "admin",
  name: "Admin Teste",
  email: "admin@example.test",
  blockedAt: null,
  mustChangePassword: false,
  accessInvitedAt: null,
  firstLoginCompletedAt: seedCreatedAt,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});
profiles.set("test-client-user", {
  id: "test-client-user",
  role: "client",
  name: "Cliente Teste",
  email: "client@example.test",
  blockedAt: null,
  mustChangePassword: false,
  accessInvitedAt: null,
  firstLoginCompletedAt: seedCreatedAt,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});
profiles.set("test-lawyer-user", {
  id: "test-lawyer-user",
  role: "lawyer",
  name: "Dra. Teste",
  email: "lawyer@example.test",
  avatarUrl: "https://example.test/lawyer-avatar.jpg",
  coverUrl: null,
  blockedAt: null,
  mustChangePassword: false,
  accessInvitedAt: seedCreatedAt,
  firstLoginCompletedAt: seedCreatedAt,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});

profiles.set("fixture-lawyer-sp-profile", {
  id: "fixture-lawyer-sp-profile",
  role: "lawyer",
  name: "Dra. Ana Geo",
  email: "fixture-lawyer-sp@example.test",
  phone: "11988887777",
  avatarUrl: "https://example.test/ana-avatar.jpg",
  coverUrl: "https://example.test/ana-cover.jpg",
  blockedAt: null,
  mustChangePassword: false,
  accessInvitedAt: seedCreatedAt,
  firstLoginCompletedAt: seedCreatedAt,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});

profiles.set("fixture-lawyer-rj-profile", {
  id: "fixture-lawyer-rj-profile",
  role: "lawyer",
  name: "Dr. Bruno Costa",
  email: "fixture-lawyer-rj@example.test",
  phone: "21977776666",
  blockedAt: null,
  mustChangePassword: false,
  accessInvitedAt: seedCreatedAt,
  firstLoginCompletedAt: seedCreatedAt,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});

profiles.set("fixture-lawyer-pending-profile", {
  id: "fixture-lawyer-pending-profile",
  role: "lawyer",
  name: "Dr. Pendente",
  email: "fixture-lawyer-pending@example.test",
  phone: "11000000000",
  blockedAt: null,
  mustChangePassword: false,
  accessInvitedAt: seedCreatedAt,
  firstLoginCompletedAt: seedCreatedAt,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});

function toAdminUser(profile: Profile) {
  const lawyer = Array.from(lawyers.values()).find((candidate) => candidate.profileId === profile.id);
  return {
    id: profile.id,
    role: profile.role,
    name: profile.name,
    email: profile.email,
    phone: profile.phone ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    coverUrl: profile.coverUrl ?? null,
    blockedAt: profile.blockedAt ?? null,
    mustChangePassword: profile.mustChangePassword ?? false,
    accessInvitedAt: profile.accessInvitedAt ?? null,
    firstLoginCompletedAt: profile.firstLoginCompletedAt ?? null,
    createdAt: profile.createdAt ?? seedCreatedAt,
    updatedAt: profile.updatedAt ?? seedCreatedAt,
    lawyerProfileId: lawyer?.id ?? null,
    lawyerStatus: lawyer?.status ?? null
  };
}

class MemoryProfileRepository implements ProfileRepository {
  async getById(id: string) {
    return profiles.get(id) ?? null;
  }

  async listAdminUsers() {
    return Array.from(profiles.values())
      .map(toAdminUser)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAdminUsersPage(input: PageInput) {
    const search = normalizeSearch(input.search ?? "");
    const users = (await this.listAdminUsers()).filter((user) => {
      if (!search) return true;
      return [user.name, user.email, user.phone, user.role]
        .filter(Boolean)
        .some((value) => normalizeSearch(String(value)).includes(search));
    });
    return pageItems(users, input);
  }

  async createClientProfile(input: { id: string; name: string; email: string }) {
    const now = new Date().toISOString();
    const profile: Profile = {
      id: input.id,
      role: "client",
      name: input.name,
      email: input.email,
      blockedAt: null,
      mustChangePassword: false,
      accessInvitedAt: null,
      firstLoginCompletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    profiles.set(profile.id, profile);
    return profile;
  }

  async createLawyerProfile(
    input: Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">,
    access: { profileId?: string; accessInvitedAt?: string | null; mustChangePassword?: boolean } = {}
  ) {
    const now = new Date().toISOString();
    const profile: Profile = {
      id: access.profileId ?? crypto.randomUUID(),
      role: "lawyer",
      name: input.name,
      email: input.email,
      phone: input.whatsapp,
      avatarUrl: input.avatarUrl ?? null,
      coverUrl: input.coverUrl ?? null,
      blockedAt: null,
      mustChangePassword: access.mustChangePassword ?? false,
      accessInvitedAt: "accessInvitedAt" in access ? access.accessInvitedAt ?? null : null,
      firstLoginCompletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    profiles.set(profile.id, profile);
    return profile;
  }

  async updateVisualFields(profileId: string, input: Pick<Profile, "avatarUrl" | "coverUrl">) {
    const existing = profiles.get(profileId);
    if (!existing) return;
    profiles.set(profileId, {
      ...existing,
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl ?? null } : {}),
      ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl ?? null } : {}),
      updatedAt: new Date().toISOString()
    });
  }

  async updateLawyerProfile(
    profileId: string,
    input: Partial<Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">>
  ) {
    const existing = profiles.get(profileId);
    if (!existing) return;
    profiles.set(profileId, {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.whatsapp !== undefined ? { phone: input.whatsapp } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl ?? null } : {}),
      ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl ?? null } : {}),
      updatedAt: new Date().toISOString()
    });
  }

  async updateBlocked(profileId: string, blocked: boolean) {
    const existing = profiles.get(profileId);
    if (!existing) return null;
    const updated = {
      ...existing,
      blockedAt: blocked ? existing.blockedAt ?? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    };
    profiles.set(profileId, updated);
    return toAdminUser(updated);
  }

  async markFirstLoginCompleted(profileId: string) {
    const existing = profiles.get(profileId);
    if (!existing) return null;
    if (existing.firstLoginCompletedAt) return existing;
    const updated = {
      ...existing,
      firstLoginCompletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    profiles.set(profileId, updated);
    return updated;
  }

  async markPasswordChanged(profileId: string) {
    const existing = profiles.get(profileId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated = {
      ...existing,
      mustChangePassword: false,
      firstLoginCompletedAt: existing.firstLoginCompletedAt ?? now,
      updatedAt: now
    };
    profiles.set(profileId, updated);
    return updated;
  }
}

class MemoryLegalSpecialtyRepository implements LegalSpecialtyRepository {
  async listActive() {
    return legalAreas.map((area) => ({ ...area, active: true }));
  }
}

const normalizeGeoName = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function isEligibleForCityCatalog(lawyer: LawyerRecord, areaIds: string[] = []) {
  return (
    lawyer.status === "approved" &&
    lawyer.availableForMatches !== false &&
    Boolean(lawyer.serviceCityId) &&
    profiles.get(lawyer.profileId)?.blockedAt == null &&
    lawyer.officeLocationStatus === "validated" &&
    (areaIds.length === 0 || [lawyer.mainAreaId, ...lawyer.secondaryAreaIds].some((area) => areaIds.includes(area)))
  );
}

class MemoryGeographyRepository implements GeographyRepository {
  async listStates(activeOnly = false) {
    return Array.from(states.values()).filter((state) => !activeOnly || state.active).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listStatesWithAvailableLawyers(areaIds: string[] = []) {
    const eligibleCityIds = new Set(
      Array.from(lawyers.values())
        .filter((lawyer) => isEligibleForCityCatalog(lawyer, areaIds))
        .map((lawyer) => lawyer.serviceCityId)
        .filter((cityId): cityId is string => Boolean(cityId))
    );
    const eligibleStateIds = new Set(
      Array.from(cities.values())
        .filter((city) => city.active && eligibleCityIds.has(city.id))
        .map((city) => city.stateId)
    );
    return Array.from(states.values())
      .filter((state) => state.active && eligibleStateIds.has(state.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async getState(id: string) { return states.get(id) ?? null; }
  async createState(input: StateCreate) {
    const existing = Array.from(states.values()).find((state) => state.code === input.code);
    if (existing?.active) throw new Error("GEO_DUPLICATE");
    if (existing) {
      const reactivated = { ...existing, name: input.name, active: true, updatedAt: new Date().toISOString() };
      states.set(existing.id, reactivated);
      return reactivated;
    }
    const now = new Date().toISOString();
    const state = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    states.set(state.id, state);
    return state;
  }
  async updateState(id: string, patch: StatePatch) {
    const current = states.get(id);
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    states.set(id, updated);
    return updated;
  }
  async deleteState(id: string) {
    if (!states.has(id)) return "not_found" as const;
    const stateCities = Array.from(cities.values()).filter((city) => city.stateId === id);
    if (stateCities.some((city) => city.active)) return "linked" as const;
    if (stateCities.some((city) => Array.from(lawyers.values()).some((lawyer) => lawyer.serviceCityId === city.id))) return "linked" as const;
    for (const city of stateCities) cities.delete(city.id);
    states.delete(id);
    return "deleted" as const;
  }
  async listCities(stateId?: string, activeOnly = false) {
    return Array.from(cities.values()).filter((city) => (!stateId || city.stateId === stateId) && (!activeOnly || city.active)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listCitiesWithAvailableLawyers(stateId: string, areaIds: string[] = []) {
    const eligibleCityIds = new Set(
      Array.from(lawyers.values())
        .filter((lawyer) => isEligibleForCityCatalog(lawyer, areaIds))
        .map((lawyer) => lawyer.serviceCityId)
        .filter((cityId): cityId is string => Boolean(cityId))
    );
    return Array.from(cities.values())
      .filter((city) => city.stateId === stateId && city.active && states.get(city.stateId)?.active && eligibleCityIds.has(city.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async getCity(id: string) { return cities.get(id) ?? null; }
  async createCity(input: CityCreate) {
    const state = states.get(input.stateId);
    if (!state) throw new Error("GEO_STATE_NOT_FOUND");
    const existing = Array.from(cities.values()).find((city) => city.stateId === input.stateId && normalizeGeoName(city.name) === normalizeGeoName(input.name));
    if (existing?.active) throw new Error("GEO_DUPLICATE");
    if (existing) {
      const reactivated: CityRecord = { ...existing, name: input.name, active: true, updatedAt: new Date().toISOString() };
      cities.set(existing.id, reactivated);
      return reactivated;
    }
    const now = new Date().toISOString();
    const city: CityRecord = { id: crypto.randomUUID(), stateId: state.id, stateCode: state.code, name: input.name, active: input.active, center: input.center ?? DEFAULT_CITY_CENTER, createdAt: now, updatedAt: now };
    cities.set(city.id, city);
    return city;
  }
  async updateCity(id: string, patch: CityPatch) {
    const current = cities.get(id);
    if (!current) return null;
    const state = states.get(patch.stateId ?? current.stateId);
    if (!state) throw new Error("GEO_STATE_NOT_FOUND");
    const updated: CityRecord = { ...current, ...patch, stateId: state.id, stateCode: state.code, center: patch.center ?? current.center, updatedAt: new Date().toISOString() };
    cities.set(id, updated);
    return updated;
  }
  async deleteCity(id: string) {
    if (!cities.has(id)) return "not_found" as const;
    if (Array.from(lawyers.values()).some((lawyer) => lawyer.serviceCityId === id)) return "linked" as const;
    cities.delete(id);
    return "deleted" as const;
  }
}

class MemoryLawyerRepository implements LawyerRepository {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async list() {
    return Array.from(lawyers.values());
  }

  async listPage(input: PageInput) {
    const search = normalizeSearch(input.search ?? "");
    const items = (await this.list()).filter((lawyer) => {
      const statusMatches = !input.status || lawyer.status === input.status;
      if (!statusMatches) return false;
      if (!search) return true;
      return [lawyer.name, lawyer.email, lawyer.oabNumber, lawyer.oabState, lawyer.officeCity, lawyer.officeState]
        .filter(Boolean)
        .some((value) => normalizeSearch(String(value)).includes(search));
    });
    return pageItems(items, input);
  }

  async getById(id: string) {
    return lawyers.get(id) ?? null;
  }

  async create(
    input: LawyerCreate,
    location?: LawyerOfficeLocation,
    access?: { profileId?: string; accessInvitedAt?: string | null; mustChangePassword?: boolean }
  ) {
    const profile = await this.profileRepository.createLawyerProfile(input, access);
    const now = new Date().toISOString();
    const lawyer: LawyerRecord = {
      id: crypto.randomUUID(),
      profileId: profile.id,
      ...input,
      serviceCityId: input.serviceCityId ?? null,
      availableForMatches: input.availableForMatches ?? true,
      officeCity: location?.address?.city ?? null,
      officeState: location?.address?.state ?? null,
      officeLat: location?.coordinates?.lat ?? null,
      officeLng: location?.coordinates?.lng ?? null,
      officeLocationPresent: Boolean(location?.coordinates),
      officeGeocodeProvider: location?.geocode?.provider ?? null,
      officeGeocodePrecision: location?.geocode?.precision ?? null,
      officeGeocodeConfidence: location?.geocode?.confidence ?? null,
      officeGeocodedAt: location?.geocode?.geocodedAt ?? null,
      mustChangePassword: profile.mustChangePassword ?? false,
      accessInvitedAt: profile.accessInvitedAt ?? null,
      firstLoginCompletedAt: profile.firstLoginCompletedAt ?? null,
      createdAt: now,
      updatedAt: now
    };
    lawyer.officeLocationStatus = officeLocationStatus(lawyer);
    lawyers.set(lawyer.id, lawyer);
    return lawyer;
  }

  async activateAccess(lawyerId: string, access: { profileId: string; accessInvitedAt?: string | null }) {
    const existing = lawyers.get(lawyerId);
    if (!existing) return null;
    const profile = await this.profileRepository.getById(existing.profileId);
    if (!profile) return null;

    const now = new Date().toISOString();
    const updatedProfile: Profile = {
      ...profile,
      id: access.profileId,
      mustChangePassword: false,
      accessInvitedAt: access.accessInvitedAt ?? now,
      firstLoginCompletedAt: null,
      updatedAt: now
    };
    profiles.delete(existing.profileId);
    profiles.set(updatedProfile.id, updatedProfile);

    const updated: LawyerRecord = {
      ...existing,
      profileId: updatedProfile.id,
      mustChangePassword: updatedProfile.mustChangePassword ?? false,
      accessInvitedAt: updatedProfile.accessInvitedAt ?? null,
      firstLoginCompletedAt: updatedProfile.firstLoginCompletedAt ?? null,
      updatedAt: now
    };
    lawyers.set(lawyerId, updated);
    return updated;
  }

  async update(id: string, patch: LawyerPatch, location?: LawyerOfficeLocation) {
    const existing = lawyers.get(id);
    if (!existing) return null;
    await this.profileRepository.updateLawyerProfile(existing.profileId, patch);
    const { officeManualLocation: _officeManualLocation, ...storedPatch } = patch;

    const updated: LawyerRecord = {
      ...existing,
      ...storedPatch,
      ...(location?.address ? { officeCity: location.address.city, officeState: location.address.state } : {}),
      ...(location?.coordinates ? { officeLat: location.coordinates.lat, officeLng: location.coordinates.lng } : {}),
      ...(location?.coordinates ? { officeLocationPresent: true } : {}),
      ...(location?.coordinates
        ? {
            officeGeocodeProvider: location.geocode?.provider ?? null,
            officeGeocodePrecision: location.geocode?.precision ?? null,
            officeGeocodeConfidence: location.geocode?.confidence ?? null,
            officeGeocodedAt: location.geocode?.geocodedAt ?? null
          }
        : {}),
      ...(location?.clearCoordinates
        ? {
            officeLat: null,
            officeLng: null,
            officeLocationPresent: false,
            officeGeocodeProvider: null,
            officeGeocodePrecision: null,
            officeGeocodeConfidence: null,
            officeGeocodedAt: null
          }
        : {}),
      updatedAt: new Date().toISOString()
    };
    updated.officeLocationStatus = officeLocationStatus(updated);
    lawyers.set(id, updated);
    return updated;
  }
}

class MemoryAuditLogRepository implements AuditLogRepository {
  async record() {
    return;
  }
}

type MatchFixture = {
  id: string;
  profileId: string;
  name: string;
  whatsapp: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  areaIds: string[];
  status: LawyerRecord["status"];
  oabNumber: string;
  oabState: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  miniBio?: string | null;
  fullBio?: string | null;
  instagramUrl?: string | null;
  linkedinUrl?: string | null;
  facebookUrl?: string | null;
  websiteUrl?: string | null;
  officeGeocodePrecision: LawyerRecord["officeGeocodePrecision"];
  officeGeocodeConfidence: LawyerRecord["officeGeocodeConfidence"];
};

/**
 * Advogados de teste com coordenadas fixas. Espelham o seed manual aplicado no
 * Supabase (`src/db/seeds/001_match_fixtures.sql`) para que memory e supabase
 * tenham comportamento de match equivalente.
 */
const matchFixtures: MatchFixture[] = [
  {
    id: "fixture-lawyer-sp",
    profileId: "fixture-lawyer-sp-profile",
    name: "Dra. Ana Geo",
    whatsapp: "11988887777",
    city: "Sao Paulo",
    state: "SP",
    lat: -23.561414,
    lng: -46.655881,
    areaIds: ["civil", "consumidor"],
    status: "approved",
    oabNumber: "654321",
    oabState: "SP",
    avatarUrl: "https://example.test/ana-avatar.jpg",
    coverUrl: "https://example.test/ana-cover.jpg",
    miniBio: "Atuacao consultiva em direito civil.",
    fullBio: "Perfil profissional aprovado para testes de contrato publico seguro.",
    instagramUrl: "https://instagram.com/draanageo",
    linkedinUrl: "https://www.linkedin.com/in/draanageo",
    facebookUrl: "https://www.facebook.com/draanageo",
    websiteUrl: "https://example.test/draanageo",
    officeGeocodePrecision: "manual",
    officeGeocodeConfidence: "high"
  },
  {
    id: "fixture-lawyer-rj",
    profileId: "fixture-lawyer-rj-profile",
    name: "Dr. Bruno Costa",
    whatsapp: "21977776666",
    city: "Rio de Janeiro",
    state: "RJ",
    lat: -22.906847,
    lng: -43.172896,
    areaIds: ["trabalhista"],
    status: "approved",
    oabNumber: "112233",
    oabState: "RJ",
    officeGeocodePrecision: "manual",
    officeGeocodeConfidence: "high"
  },
  {
    // Mesmo perfil/area do SP, porem nao aprovado: nunca deve aparecer no match.
    id: "fixture-lawyer-pending",
    profileId: "fixture-lawyer-pending-profile",
    name: "Dr. Pendente",
    whatsapp: "11000000000",
    city: "Sao Paulo",
    state: "SP",
    lat: -23.55052,
    lng: -46.633308,
    areaIds: ["civil"],
    status: "pending_review",
    oabNumber: "000000",
    oabState: "SP",
    officeGeocodePrecision: "manual",
    officeGeocodeConfidence: "high"
  }
];

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

const roundKm = (value: number) => Math.round(value * 10) / 10;

class MemoryMatchRepository implements MatchRepository {
  async findNearest(input: NearestLawyerInput) {
    const candidate = matchFixtures
      .filter((fixture) => fixture.status === "approved")
      .filter((fixture) => profiles.get(fixture.profileId)?.blockedAt == null)
      .filter(
        (fixture) =>
          fixture.officeGeocodeConfidence === "high" &&
          (fixture.officeGeocodePrecision === "street" || fixture.officeGeocodePrecision === "manual")
      )
      .filter((fixture) => fixture.areaIds.some((area) => input.areaIds.includes(area)))
      .map((fixture) => ({
        fixture,
        distanceKm: roundKm(haversineKm(input.lat, input.lng, fixture.lat, fixture.lng))
      }))
      .filter((entry) => entry.distanceKm <= input.maxRadiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    if (!candidate) return null;

    return {
      lawyer: {
        id: candidate.fixture.id,
        name: candidate.fixture.name,
        whatsapp: candidate.fixture.whatsapp,
        city: candidate.fixture.city,
        state: candidate.fixture.state,
        areaIds: candidate.fixture.areaIds,
        avatarUrl: candidate.fixture.avatarUrl ?? null,
        coverUrl: candidate.fixture.coverUrl ?? null
      },
      distanceKm: candidate.distanceKm,
      distanceReliable: true
    };
  }

  async findByCity(input: { stateId: string; cityId: string; areaIds: string[]; page: number; pageSize: 5 }) {
    const city = cities.get(input.cityId);
    if (!city || city.stateId !== input.stateId || !city.active || !states.get(input.stateId)?.active) return { lawyers: [], total: 0 };
    const candidates = Array.from(lawyers.values())
      .filter((lawyer) => lawyer.status === "approved" && lawyer.availableForMatches !== false && lawyer.serviceCityId === input.cityId)
      .filter((lawyer) => profiles.get(lawyer.profileId)?.blockedAt == null)
      .filter((lawyer) => lawyer.officeLocationStatus === "validated")
      .filter((lawyer) => [lawyer.mainAreaId, ...lawyer.secondaryAreaIds].some((area) => input.areaIds.includes(area)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((lawyer) => ({ lawyer }));
    const start = (input.page - 1) * input.pageSize;
    return {
      total: candidates.length,
      lawyers: candidates.slice(start, start + input.pageSize).map(({ lawyer }) => ({
        id: lawyer.id,
        name: lawyer.name,
        whatsapp: lawyer.whatsapp,
        city: city.name,
        state: city.stateCode,
        areaIds: [lawyer.mainAreaId, ...lawyer.secondaryAreaIds],
        avatarUrl: lawyer.avatarUrl ?? null,
        coverUrl: lawyer.coverUrl ?? null
      }))
    };
  }
}

class MemoryPublicLawyerProfileRepository implements PublicLawyerProfileRepository {
  async getApprovedById(id: string) {
    const fixture = matchFixtures.find((candidate) => candidate.id === id && candidate.status === "approved");
    if (!fixture) return null;
    if (profiles.get(fixture.profileId)?.blockedAt) return null;

    return {
      id: fixture.id,
      name: fixture.name,
      oabNumber: fixture.oabNumber,
      oabState: fixture.oabState,
      city: fixture.city,
      state: fixture.state,
      areaIds: fixture.areaIds,
      areas: fixture.areaIds.map((areaId) => ({
        id: areaId,
        name: legalAreas.find((area) => area.id === areaId)?.name ?? areaId
      })),
      whatsapp: fixture.whatsapp,
      verified: true as const,
      avatarUrl: fixture.avatarUrl ?? null,
      coverUrl: fixture.coverUrl ?? null,
      miniBio: fixture.miniBio ?? null,
      fullBio: fixture.fullBio ?? null,
      instagramUrl: fixture.instagramUrl ?? null,
      linkedinUrl: fixture.linkedinUrl ?? null,
      facebookUrl: fixture.facebookUrl ?? null,
      websiteUrl: fixture.websiteUrl ?? null,
      yearsExperience: null,
      planLabel: null,
      emergencyAvailable: false
    };
  }
}

class MemoryMatchEventRepository implements MatchEventRepository {
  async record() {
    return;
  }
}

class MemoryLawyerDashboardRepository implements LawyerDashboardRepository {
  constructor(private readonly benefitRepository: BenefitRepository) {}

  async getByProfileId(profileId: string) {
    const profile = profiles.get(profileId);
    if (!profile || profile.role !== "lawyer") return null;

    return {
      lawyer: {
        id: "fixture-lawyer-dashboard",
        name: profile.name,
        oabNumber: "123456",
        oabState: "SP",
        avatarUrl: profile.avatarUrl ?? null,
        coverUrl: profile.coverUrl ?? null,
        planLabel: "MVP interno",
        verified: true
      },
      metrics: {
        profileViews: 0,
        whatsappClicks: 0,
        contacts: 0
      },
      benefits: (await this.benefitRepository.listActive()).map((benefit) => ({
        id: benefit.id,
        title: benefit.title,
        description: benefit.description,
        ...(benefit.badge ? { badge: benefit.badge } : {}),
        redemptionUrl: benefit.redemptionUrl ?? null
      }))
    };
  }
}

class MemoryPrayerRequestRepository implements PrayerRequestRepository {
  async create(input: Parameters<PrayerRequestRepository["create"]>[0]) {
    const request = {
      id: crypto.randomUUID(),
      clientProfileId: input.anonymous ? null : input.clientProfileId,
      message: input.message,
      anonymous: input.anonymous,
      status: "received" as const,
      createdAt: new Date().toISOString(),
      readAt: null
    };
    prayerRequests.push(request);
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      readAt: request.readAt ?? null
    };
  }

  private toAdminRecord(request: (typeof prayerRequests)[number]) {
    const client = request.clientProfileId ? profiles.get(request.clientProfileId) : null;
    return {
      id: request.id,
      message: request.message,
      anonymous: request.anonymous,
      status: request.status,
      createdAt: request.createdAt,
      readAt: request.readAt ?? null,
      client:
        client && !request.anonymous
          ? { id: client.id, name: client.name, email: client.email }
          : null
    };
  }

  async listAdmin() {
    return [...prayerRequests]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((request) => this.toAdminRecord(request));
  }

  async listAdminPage(input: PageInput) {
    const items = (await this.listAdmin()).filter((request) => !input.status || request.status === input.status);
    return pageItems(items, input);
  }

  async updateStatus(id: string, status: "received" | "read") {
    const index = prayerRequests.findIndex((request) => request.id === id);
    if (index === -1) return null;
    const existing = prayerRequests[index]!;
    const updated = {
      ...existing,
      status,
      readAt: status === "read" ? existing.readAt ?? new Date().toISOString() : null
    };
    prayerRequests[index] = updated;
    return this.toAdminRecord(updated);
  }
}

class MemoryLawyerMediaRepository implements LawyerMediaRepository {
  async uploadImage(input: Parameters<LawyerMediaRepository["uploadImage"]>[0]): Promise<StoredLawyerImage> {
    const extensionByMime = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    } as const;
    const path = `lawyers/${input.kind}/${crypto.randomUUID()}.${extensionByMime[input.mimeType]}`;
    return {
      path,
      contentType: input.mimeType,
      url: `https://storage.example.test/${path}`
    };
  }
}

class MemoryPartnerLogoRepository implements PartnerLogoRepository {
  async listAdmin() {
    return [...partnerLogos].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAdminPage(input: PageInput) {
    return pageItems(await this.listAdmin(), input);
  }

  async listPublic() {
    return (await this.listAdmin()).filter((partner) => partner.active);
  }

  async create(input: Parameters<PartnerLogoRepository["create"]>[0]) {
    const now = new Date().toISOString();
    const partner: PartnerLogoRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      logoUrl: input.logoUrl,
      websiteUrl: input.websiteUrl ?? null,
      active: input.active,
      createdAt: now,
      updatedAt: now
    };
    partnerLogos.unshift(partner);
    return partner;
  }

  async uploadLogo(input: Parameters<PartnerLogoRepository["uploadLogo"]>[0]): Promise<StoredAdminImage> {
    const extensionByMime = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    } as const;
    const path = `partners/logos/${crypto.randomUUID()}.${extensionByMime[input.mimeType]}`;
    return {
      path,
      contentType: input.mimeType,
      url: `https://storage.example.test/${path}`
    };
  }
}

class MemoryBenefitRepository implements BenefitRepository {
  async listAdmin() {
    return [...benefits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAdminPage(input: PageInput) {
    return pageItems(await this.listAdmin(), input);
  }

  async listActive() {
    return (await this.listAdmin()).filter((benefit) => benefit.active);
  }

  async create(input: AdminBenefitCreate) {
    const now = new Date().toISOString();
    const benefit: BenefitRecord = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description,
      badge: input.badge ?? null,
      redemptionUrl: input.redemptionUrl ?? null,
      active: input.active,
      createdAt: now,
      updatedAt: now
    };
    benefits.unshift(benefit);
    return benefit;
  }

  async update(id: string, patch: AdminBenefitPatch) {
    const index = benefits.findIndex((benefit) => benefit.id === id);
    if (index === -1) return null;
    const current = benefits[index]!;
    const updated: BenefitRecord = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.badge !== undefined ? { badge: patch.badge ?? null } : {}),
      ...(patch.redemptionUrl !== undefined ? { redemptionUrl: patch.redemptionUrl ?? null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedAt: new Date().toISOString()
    };
    benefits[index] = updated;
    return updated;
  }

  async delete(id: string) {
    const index = benefits.findIndex((benefit) => benefit.id === id);
    if (index === -1) return false;
    benefits.splice(index, 1);
    return true;
  }
}

export function createMemoryRepositories(): Repositories {
  const profileRepository = new MemoryProfileRepository();
  const benefitRepository = new MemoryBenefitRepository();
  return {
    profiles: profileRepository,
    legalSpecialties: new MemoryLegalSpecialtyRepository(),
    geographies: new MemoryGeographyRepository(),
    lawyers: new MemoryLawyerRepository(profileRepository),
    publicLawyerProfiles: new MemoryPublicLawyerProfileRepository(),
    lawyerDashboards: new MemoryLawyerDashboardRepository(benefitRepository),
    prayerRequests: new MemoryPrayerRequestRepository(),
    lawyerMedia: new MemoryLawyerMediaRepository(),
    partnerLogos: new MemoryPartnerLogoRepository(),
    benefits: benefitRepository,
    auditLogs: new MemoryAuditLogRepository(),
    matches: new MemoryMatchRepository(),
    matchEvents: new MemoryMatchEventRepository(),
    mode: "memory"
  };
}
