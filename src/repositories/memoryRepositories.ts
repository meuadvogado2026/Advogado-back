import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import { legalAreas } from "../modules/areas/legalAreas.js";
import type {
  AuditLogRepository,
  LawyerCoordinates,
  LawyerDashboardRepository,
  LawyerMediaRepository,
  LawyerRecord,
  LawyerRepository,
  LegalSpecialtyRepository,
  MatchEventRepository,
  MatchRepository,
  NearestLawyerInput,
  Profile,
  ProfileRepository,
  PublicLawyerProfileRepository,
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
  status: "received";
  createdAt: string;
}> = [];

const seedCreatedAt = "2026-06-03T00:00:00.000Z";

profiles.set("test-admin-user", {
  id: "test-admin-user",
  role: "admin",
  name: "Admin Teste",
  email: "admin@example.test",
  blockedAt: null,
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt
});
profiles.set("test-client-user", {
  id: "test-client-user",
  role: "client",
  name: "Cliente Teste",
  email: "client@example.test",
  blockedAt: null,
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
      createdAt: now,
      updatedAt: now
    };
    profiles.set(profile.id, profile);
    return profile;
  }

  async createLawyerProfile(input: Pick<LawyerCreate, "name" | "email" | "whatsapp" | "avatarUrl" | "coverUrl">) {
    const now = new Date().toISOString();
    const profile: Profile = {
      id: crypto.randomUUID(),
      role: "lawyer",
      name: input.name,
      email: input.email,
      phone: input.whatsapp,
      avatarUrl: input.avatarUrl ?? null,
      coverUrl: input.coverUrl ?? null,
      blockedAt: null,
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

  async create(input: LawyerCreate, coordinates?: LawyerCoordinates) {
    const profile = await this.profileRepository.createLawyerProfile(input);
    const now = new Date().toISOString();
    const lawyer: LawyerRecord = {
      id: crypto.randomUUID(),
      profileId: profile.id,
      ...input,
      officeLat: coordinates?.lat ?? null,
      officeLng: coordinates?.lng ?? null,
      createdAt: now,
      updatedAt: now
    };
    lawyers.set(lawyer.id, lawyer);
    return lawyer;
  }

  async update(id: string, patch: LawyerPatch, coordinates?: LawyerCoordinates) {
    const existing = lawyers.get(id);
    if (!existing) return null;

    const updated: LawyerRecord = {
      ...existing,
      ...patch,
      ...(coordinates ? { officeLat: coordinates.lat, officeLng: coordinates.lng } : {}),
      updatedAt: new Date().toISOString()
    };
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
    fullBio: "Perfil profissional aprovado para testes de contrato publico seguro."
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
    oabState: "RJ"
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
    oabState: "SP"
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
        areaIds: candidate.fixture.areaIds
      },
      distanceKm: candidate.distanceKm
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
      createdAt: new Date().toISOString()
    };
    prayerRequests.push(request);
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt
    };
  }

  async listAdmin() {
    return [...prayerRequests]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((request) => {
        const client = request.clientProfileId ? profiles.get(request.clientProfileId) : null;
        return {
          id: request.id,
          message: request.message,
          anonymous: request.anonymous,
          status: request.status,
          createdAt: request.createdAt,
          client:
            client && !request.anonymous
              ? { id: client.id, name: client.name, email: client.email }
              : null
        };
      });
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
    auditLogs: new MemoryAuditLogRepository(),
    matches: new MemoryMatchRepository(),
    matchEvents: new MemoryMatchEventRepository(),
    mode: "memory"
  };
}
