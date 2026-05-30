import type { LawyerCreate, LawyerPatch } from "../contracts/api.js";
import { legalAreas } from "../modules/areas/legalAreas.js";
import type {
  AuditLogRepository,
  LawyerCoordinates,
  LawyerRecord,
  LawyerRepository,
  LegalSpecialtyRepository,
  MatchEventRepository,
  MatchRepository,
  NearestLawyerInput,
  Profile,
  ProfileRepository,
  Repositories
} from "./types.js";

const profiles = new Map<string, Profile>();
const lawyers = new Map<string, LawyerRecord>();

profiles.set("test-admin-user", {
  id: "test-admin-user",
  role: "admin",
  name: "Admin Teste",
  email: "admin@example.test"
});
profiles.set("test-client-user", {
  id: "test-client-user",
  role: "client",
  name: "Cliente Teste",
  email: "client@example.test"
});

class MemoryProfileRepository implements ProfileRepository {
  async getById(id: string) {
    return profiles.get(id) ?? null;
  }

  async createLawyerProfile(input: Pick<LawyerCreate, "name" | "email" | "whatsapp">) {
    const profile: Profile = {
      id: crypto.randomUUID(),
      role: "lawyer",
      name: input.name,
      email: input.email,
      phone: input.whatsapp
    };
    profiles.set(profile.id, profile);
    return profile;
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
    status: "approved"
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
    status: "approved"
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
    status: "pending_review"
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

class MemoryMatchEventRepository implements MatchEventRepository {
  async record() {
    return;
  }
}

export function createMemoryRepositories(): Repositories {
  const profileRepository = new MemoryProfileRepository();
  return {
    profiles: profileRepository,
    legalSpecialties: new MemoryLegalSpecialtyRepository(),
    lawyers: new MemoryLawyerRepository(profileRepository),
    auditLogs: new MemoryAuditLogRepository(),
    matches: new MemoryMatchRepository(),
    matchEvents: new MemoryMatchEventRepository(),
    mode: "memory"
  };
}
