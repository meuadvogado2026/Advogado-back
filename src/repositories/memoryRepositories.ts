import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import { legalAreas } from "../modules/areas/legalAreas.js";
import type {
  AuditLogRepository,
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
  StoredAdminImage,
  StoredLawyerImage,
  PrayerRequestRepository,
  Repositories
} from "./types.js";

const profiles = new Map<string, Profile>();
const lawyers = new Map<string, LawyerRecord>();
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

const seedCreatedAt = "2026-06-03T00:00:00.000Z";

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

class MemoryLawyerRepository implements LawyerRepository {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async list() {
    return Array.from(lawyers.values());
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
}

class MemoryPublicLawyerProfileRepository implements PublicLawyerProfileRepository {
  async getApprovedById(id: string) {
    const fixture = matchFixtures.find((candidate) => candidate.id === id && candidate.status === "approved");
    if (!fixture) return null;

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
      benefits: [
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
      ]
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

export function createMemoryRepositories(): Repositories {
  const profileRepository = new MemoryProfileRepository();
  return {
    profiles: profileRepository,
    legalSpecialties: new MemoryLegalSpecialtyRepository(),
    lawyers: new MemoryLawyerRepository(profileRepository),
    publicLawyerProfiles: new MemoryPublicLawyerProfileRepository(),
    lawyerDashboards: new MemoryLawyerDashboardRepository(),
    prayerRequests: new MemoryPrayerRequestRepository(),
    lawyerMedia: new MemoryLawyerMediaRepository(),
    partnerLogos: new MemoryPartnerLogoRepository(),
    auditLogs: new MemoryAuditLogRepository(),
    matches: new MemoryMatchRepository(),
    matchEvents: new MemoryMatchEventRepository(),
    mode: "memory"
  };
}
