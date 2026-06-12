import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
import { createRepositories } from "../src/repositories/index.js";

const ADMIN = { authorization: "Bearer test-admin-token" };
const CLIENT = { authorization: "Bearer test-client-token" };
const LAWYER = { authorization: "Bearer test-lawyer-token" };
const SERVICE_STATE_ID = "10000000-0000-4000-8000-000000000001";
const SERVICE_CITY_ID = "20000000-0000-4000-8000-000000000001";

// Cadastro minimo de advogado sem coordenada (geocoding nao executado).
const draftWithoutCoordinate = (overrides: Record<string, unknown> = {}) => ({
  name: "Dr. Sem Coordenada",
  email: "no-coord@example.test",
  whatsapp: "11900000000",
  oabNumber: "999000",
  oabState: "SP",
  mainAreaId: "civil",
  secondaryAreaIds: [],
  officeCep: "01001000",
  officeNumber: "1",
  status: "draft" as const,
  ...overrides
});

describe("foundation API", () => {
  it("responds to healthcheck", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "advogado-20-back" });
  });

  it("always allows the published Vercel admin origin even when CORS_ORIGINS is overridden", async () => {
    const previousCorsOrigins = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = "http://localhost:5173";
    const app = await buildApp();
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/areas",
      headers: {
        origin: "https://advogado20admin.vercel.app",
        "access-control-request-method": "GET"
      }
    });
    await app.close();
    if (previousCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = previousCorsOrigins;
    }

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://advogado20admin.vercel.app");
  });

  it("requires auth on match", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/v1/match", payload: { lat: 200 } });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("validates match payload after auth", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/match",
      headers: { authorization: "Bearer test-client-token" },
      payload: { lat: 200 }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a matched lawyer for a nearby compatible area", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/match",
      headers: { authorization: "Bearer test-client-token" },
      payload: { lat: -23.55052, lng: -46.633308, accuracyM: 30, areaIds: ["civil"] }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("matched");
    expect(body.algorithmVersion).toBe("geo-nearest-v1");
    expect(body.lawyer.whatsapp).toBeTruthy();
    expect(body.lawyer.avatarUrl).toBe("https://example.test/ana-avatar.jpg");
    expect(body.lawyer.coverUrl).toBe("https://example.test/ana-cover.jpg");
    expect(typeof body.distanceKm).toBe("number");
    expect(body.distanceReliable).toBe(true);
    // Nao deve vazar PII interna (CEP/endereco completo).
    expect(body.lawyer.officeCep).toBeUndefined();
  });

  it("does not expose numeric distance when a repository marks it as unreliable", async () => {
    const repos = createMemoryRepositories();
    repos.matches.findNearest = async () => ({
      lawyer: {
        id: "lawyer-approx",
        name: "Dr. Aproximado",
        whatsapp: "11900000000",
        city: "Brasilia",
        state: "DF",
        areaIds: ["civil"]
      },
      distanceKm: 4.096,
      distanceReliable: false,
      distanceNotice: "Localizacao do advogado em confirmacao."
    });
    const app = await buildApp(repos);
    const response = await app.inject({
      method: "POST",
      url: "/v1/match",
      headers: CLIENT,
      payload: { lat: -15.87, lng: -48.07, accuracyM: 100, areaIds: ["civil"] }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("matched");
    expect(body.distanceKm).toBeUndefined();
    expect(body.distanceReliable).toBe(false);
    expect(body.distanceNotice).toContain("confirmacao");
  });

  it("does not expose a blocked lawyer through match or public profile", async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.updateBlocked("fixture-lawyer-sp-profile", true);
    const app = await buildApp(repos);
    try {
      const match = await app.inject({
        method: "POST",
        url: "/v1/match",
        headers: CLIENT,
        payload: { lat: -23.55052, lng: -46.633308, accuracyM: 30, areaIds: ["civil"] }
      });
      const profile = await app.inject({
        method: "GET",
        url: "/v1/lawyers/fixture-lawyer-sp",
        headers: CLIENT
      });

      expect(match.statusCode).toBe(200);
      expect(match.json()).toMatchObject({ status: "empty", lawyer: null });
      expect(profile.statusCode).toBe(404);
      expect(profile.json().error.code).toBe("NOT_FOUND");
    } finally {
      await repos.profiles.updateBlocked("fixture-lawyer-sp-profile", false);
      await app.close();
    }
  });

  it("keeps match response available when event recording fails", async () => {
    const repos = createMemoryRepositories();
    repos.matchEvents.record = async () => {
      throw new Error("event persistence unavailable");
    };
    const app = await buildApp(repos);
    const response = await app.inject({
      method: "POST",
      url: "/v1/match",
      headers: CLIENT,
      payload: { lat: -23.55052, lng: -46.633308, accuracyM: 30, areaIds: ["civil"] }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "matched",
      lawyer: { whatsapp: expect.any(String) },
      algorithmVersion: "geo-nearest-v1"
    });
  });

  it("returns empty when no lawyer serves the area", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/match",
      headers: { authorization: "Bearer test-client-token" },
      payload: { lat: -23.55052, lng: -46.633308, accuracyM: 30, areaIds: ["criminal"] }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("empty");
    expect(response.json().lawyer).toBeNull();
  });

  it("returns empty when the nearest lawyer is beyond the max radius", async () => {
    const app = await buildApp();
    // Manaus -> advogado civil mais proximo fica em Sao Paulo (~2700km > 200km).
    const response = await app.inject({
      method: "POST",
      url: "/v1/match",
      headers: { authorization: "Bearer test-client-token" },
      payload: { lat: -3.119028, lng: -60.021731, accuracyM: 30, areaIds: ["civil"] }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("empty");
  });

  it("requires auth on client lawyer profile", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/lawyers/fixture-lawyer-sp" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("allows lawyer role to read a public lawyer profile with the same allowlist", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/lawyers/fixture-lawyer-sp",
      headers: { authorization: "Bearer test-lawyer-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().lawyer).toMatchObject({
      id: "fixture-lawyer-sp",
      verified: true,
      whatsapp: "11988887777"
    });
    expect(response.json().lawyer.officeCep).toBeUndefined();
    expect(response.json().lawyer.email).toBeUndefined();
  });

  it("returns safe 404 when client lawyer profile is unavailable", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/lawyers/fixture-lawyer-pending",
      headers: { authorization: "Bearer test-client-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("returns approved client lawyer profile with public allowlist", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/lawyers/fixture-lawyer-sp",
      headers: { authorization: "Bearer test-client-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      lawyer: {
        id: "fixture-lawyer-sp",
        name: "Dra. Ana Geo",
        oabNumber: "654321",
        oabState: "SP",
        city: "Sao Paulo",
        state: "SP",
        areaIds: ["civil", "consumidor"],
        areas: [
          { id: "civil", name: "Direito Civil" },
          { id: "consumidor", name: "Direito do Consumidor" }
        ],
        whatsapp: "11988887777",
        verified: true,
        avatarUrl: "https://example.test/ana-avatar.jpg",
        coverUrl: "https://example.test/ana-cover.jpg",
        miniBio: "Atuacao consultiva em direito civil.",
        fullBio: "Perfil profissional aprovado para testes de contrato publico seguro.",
        instagramUrl: "https://instagram.com/draanageo",
        linkedinUrl: "https://www.linkedin.com/in/draanageo",
        facebookUrl: "https://www.facebook.com/draanageo",
        websiteUrl: "https://example.test/draanageo",
        yearsExperience: null,
        planLabel: null,
        emergencyAvailable: false
      }
    });
    expect(response.json().lawyer.officeCep).toBeUndefined();
    expect(response.json().lawyer.email).toBeUndefined();
    expect(response.json().lawyer.officeLat).toBeUndefined();
  });

  it("normalizes insecure image URLs on admin lawyer create", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Url Insegura",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email: "insecure-url@example.test",
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        avatarUrl: "http://example.test/avatar.jpg",
        instagramUrl: "http://instagram.com/inseguro",
        status: "draft"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().lawyer.avatarUrl).toBeNull();
    expect(response.json().lawyer.instagramUrl).toBeNull();
  });

  it("keeps areas public", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/areas" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().areas).toHaveLength(8);
    expect(response.json().areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "empresarial", name: "Direito Empresarial" }),
        expect.objectContaining({ id: "tributario", name: "Direito Tributário" })
      ])
    );
  });

  it("requires auth on profile session endpoint", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/me" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("returns the authenticated user role without sensitive fields", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: ADMIN
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: "test-admin-user",
        name: "Admin Teste",
        email: "admin@example.test",
        role: "admin",
        mustChangePassword: false,
        firstLoginCompletedAt: "2026-06-03T00:00:00.000Z"
      }
    });
    expect(response.json().user.token).toBeUndefined();
  });

  it("changes the authenticated password without returning sensitive fields", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/change-password",
      headers: LAWYER,
      payload: { newPassword: "nova-senha-segura-123" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      id: "test-lawyer-user",
      name: "Dra. Teste",
      role: "lawyer",
      mustChangePassword: false
    });
    expect(response.json().user.password).toBeUndefined();
    expect(response.json().user.token).toBeUndefined();
  });

  it("creates a client user profile through the public signup boundary", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup-client",
      payload: {
        name: "Cliente Novo",
        email: `cliente-novo-${Date.now()}@example.test`,
        password: "senha-segura-123"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      user: {
        email: expect.stringContaining("@example.test"),
        role: "client"
      },
      persistence: "memory"
    });
    expect(response.json().user.password).toBeUndefined();
    expect(response.json().user.token).toBeUndefined();
  });

  it("fails production repository setup instead of falling back to memory when Supabase is not configured", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      SUPABASE_URL: "https://qpemxkiowiiklztgumqy.supabase.co"
    });

    expect(() => createRepositories(env)).toThrow("Supabase service role obrigatoria");
  });

  it("keeps database security and match performance guards versioned", () => {
    const hardeningSql = readFileSync("src/db/migrations/0009_match_security_hardening.sql", "utf8");

    expect(hardeningSql).toMatch(/revoke execute on function public\.activate_lawyer_profile_access/i);
    expect(hardeningSql).toMatch(/from public/i);
    expect(hardeningSql).toMatch(/from anon/i);
    expect(hardeningSql).toMatch(/from authenticated/i);
    expect(hardeningSql).toMatch(/grant execute on function public\.activate_lawyer_profile_access/i);
    expect(hardeningSql).toMatch(/to service_role/i);
    expect(hardeningSql).toMatch(/p\.blocked_at\s+is\s+null/i);
    expect(hardeningSql).toMatch(/st_dwithin/i);
  });

  it("keeps admin filter performance diagnostics read-only and redacted", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const benchmark = readFileSync("scripts/admin-filter-performance.ts", "utf8");
    const explainSql = readFileSync("scripts/sql/admin-filter-explain.sql", "utf8");

    expect(packageJson).toMatch(/"admin-filter:perf":\s*"tsx scripts\/admin-filter-performance\.ts"/);
    expect(benchmark).toMatch(/ADMIN_FILTER_PERF_BASE_URL/);
    expect(benchmark).toMatch(/url\.protocol !== "https:"/);
    expect(benchmark).toMatch(/token:\s*"REDACTED"/);
    expect(benchmark).toMatch(/destructive:\s*false/);
    expect(benchmark).not.toMatch(/console\.log\([^)]*access_token/);
    expect(explainSql).toMatch(/begin read only/i);
    expect(explainSql).toMatch(/explain \(analyze, buffers, format text\)/i);
    expect(explainSql).toMatch(/rollback/i);
    expect(explainSql).not.toMatch(/\b(insert|update|delete|truncate|drop)\b/i);
  });

  it("validates public client signup payload", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup-client",
      payload: {
        name: "A",
        email: "email-invalido",
        password: "curta"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("requires auth on admin routes", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/admin/lawyers" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects non-admin roles on admin routes", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/lawyers",
      headers: { authorization: "Bearer test-client-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("validates protected admin payload after auth", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: { authorization: "Bearer test-admin-token" },
      payload: { name: "A" }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("allows admin token to create a lawyer through repository boundary", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: { authorization: "Bearer test-admin-token" },
      payload: {
        name: "Dra. Smoke Test",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email: "smoke-lawyer@example.test",
        whatsapp: "11999999999",
        oabNumber: "123456",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: ["consumidor"],
        officeCep: "01001-000",
        officeNumber: "100",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        status: "draft"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().persistence).toBe("memory");
    expect(response.json().lawyer.profileId).toBeTruthy();
    expect(response.json().access).toMatchObject({ status: "invited", delivery: "simulated" });
    expect(response.json().access.password).toBeUndefined();
    expect(response.json().access.token).toBeUndefined();
  });

  it("activates access for a legacy lawyer without returning invite secrets", async () => {
    const repos = createMemoryRepositories();
    const legacy = await repos.lawyers.create({
      name: "Dra. Legado Acesso",
      email: `legacy-access-${Date.now()}@example.test`,
      whatsapp: "11911112222",
      oabNumber: "111222",
      oabState: "SP",
      mainAreaId: "civil",
      secondaryAreaIds: [],
      officeCep: "01001000",
      officeNumber: "10",
      status: "draft"
    });
    const legacyProfile = await repos.profiles.getById(legacy.profileId);
    expect(legacyProfile?.accessInvitedAt).toBeNull();

    const app = await buildApp(repos);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/lawyers/${legacy.id}/access-invite`,
      headers: ADMIN
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().lawyer.profileId).not.toBe(legacy.profileId);
    expect(response.json().access).toMatchObject({ status: "invited", delivery: "simulated" });
    expect(JSON.stringify(response.json())).not.toContain("password");
    expect(JSON.stringify(response.json())).not.toContain("token");
  });

  it("lists admin lawyers with operational identity and area fields", async () => {
    const app = await buildApp();
    const email = `list-admin-lawyer-${Date.now()}@example.test`;
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Lista Admin",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email,
        whatsapp: "11999998888",
        oabNumber: "456789",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: ["consumidor"],
        officeCep: "01001-000",
        officeNumber: "101",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        status: "draft"
      }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/lawyers", headers: ADMIN });
    await app.close();

    expect(create.statusCode).toBe(201);
    expect(list.statusCode).toBe(200);
    const createdId = create.json().lawyer.id;
    const lawyer = list.json().lawyers.find((item: { id: string }) => item.id === createdId);
    expect(lawyer).toMatchObject({
      name: "Dra. Lista Admin",
      email,
      oabNumber: "456789",
      oabState: "SP",
      mainAreaId: "civil",
      secondaryAreaIds: ["consumidor"],
      status: "draft"
    });
  });

  it("paginates admin lawyers when page query is provided", async () => {
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/admin/lawyers?page=1&pageSize=1", headers: ADMIN });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().lawyers.length).toBeLessThanOrEqual(1);
    expect(list.json().pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(list.json().lawyers.length);
  });

  it("filters paginated admin lawyers by search and status", async () => {
    const app = await buildApp();
    const email = `filtered-lawyer-${Date.now()}@example.test`;
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Filtro Servidor",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email,
        whatsapp: "11999997777",
        oabNumber: "998877",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "103",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        status: "draft"
      }
    });
    const list = await app.inject({
      method: "GET",
      url: "/v1/admin/lawyers?page=1&pageSize=5&status=draft&search=998877",
      headers: ADMIN
    });
    await app.close();

    expect(create.statusCode).toBe(201);
    expect(list.statusCode).toBe(200);
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(1);
    expect(list.json().lawyers.every((lawyer: { status: string; oabNumber: string }) => lawyer.status === "draft" && lawyer.oabNumber.includes("998877"))).toBe(true);
  });

  it("persists the geocoded coordinate when creating a lawyer", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Coordenada Persistida",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email: "persist-coord@example.test",
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        status: "approved"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    const body = response.json();
    // Coordenada geocodificada deve ser persistida no registro do advogado.
    expect(body.lawyer.officeCity).toBeTruthy();
    expect(body.lawyer.officeState).toBeTruthy();
    expect(typeof body.lawyer.officeLat).toBe("number");
    expect(typeof body.lawyer.officeLng).toBe("number");
    expect(typeof body.coordinates.lat).toBe("number");
    expect(body.lawyer.officeGeocodeProvider).toBe("manual");
    expect(body.lawyer.officeGeocodePrecision).toBe("manual");
    expect(body.lawyer.officeGeocodeConfidence).toBe("high");
    expect(body.lawyer.officeLocationStatus).toBe("validated");
  });

  it("requires a final confirmed coordinate when creating any lawyer", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Sem Pin Confirmado",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email: "sem-pin@example.test",
        whatsapp: "11955554444",
        oabNumber: "778800",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        status: "draft"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("lets admin confirm a lawyer office location manually before approval", async () => {
    const repos = createMemoryRepositories();
    const draft = await repos.lawyers.create(draftWithoutCoordinate({ email: "manual-location@example.test" }));

    const app = await buildApp(repos);
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${draft.id}`,
      headers: ADMIN,
      payload: {
        status: "approved",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        officeManualLocation: { lat: -23.55052, lng: -46.633308 }
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lawyer.status).toBe("approved");
    expect(body.lawyer.officeGeocodeProvider).toBe("manual");
    expect(body.lawyer.officeGeocodePrecision).toBe("manual");
    expect(body.lawyer.officeGeocodeConfidence).toBe("high");
    expect(body.lawyer.officeLocationStatus).toBe("validated");
  });

  it("blocks approving a lawyer when the stored CEP cannot recover a valid coordinate", async () => {
    // Semeia um advogado draft sem coordenada direto no repo em memoria
    // (mesmo Map global usado pela app), sem passar pelo geocoding.
    const repos = createMemoryRepositories();
    const draft = await repos.lawyers.create(draftWithoutCoordinate({ email: "block-approve@example.test", officeCep: "123" }));
    expect(draft.officeLat ?? null).toBeNull();

    const app = await buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${draft.id}`,
      headers: ADMIN,
      payload: { status: "approved" }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("approves a lawyer when re-geocoding the CEP yields a valid coordinate", async () => {
    const repos = createMemoryRepositories();
    const draft = await repos.lawyers.create(draftWithoutCoordinate({ email: "approve-with-geocode@example.test" }));

    const app = await buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${draft.id}`,
      headers: ADMIN,
      payload: { status: "approved", serviceStateId: SERVICE_STATE_ID, serviceCityId: SERVICE_CITY_ID, officeCep: "01001-000" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lawyer.status).toBe("approved");
    expect(body.lawyer.officeCity).toBeTruthy();
    expect(body.lawyer.officeState).toBeTruthy();
    expect(typeof body.lawyer.officeLat).toBe("number");
    expect(typeof body.lawyer.officeLng).toBe("number");
  });

  it("recovers missing coordinates from the stored CEP when approving a legacy lawyer", async () => {
    const repos = createMemoryRepositories();
    const draft = await repos.lawyers.create(draftWithoutCoordinate({ email: "approve-legacy-cep@example.test" }));

    const app = await buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${draft.id}`,
      headers: ADMIN,
      payload: { status: "approved", serviceStateId: SERVICE_STATE_ID, serviceCityId: SERVICE_CITY_ID }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lawyer.status).toBe("approved");
    expect(body.lawyer.officeCity).toBeTruthy();
    expect(body.lawyer.officeState).toBeTruthy();
    expect(typeof body.lawyer.officeLat).toBe("number");
    expect(typeof body.lawyer.officeLng).toBe("number");
  });

  it("recovers the PostGIS match location when a legacy lawyer has coordinates but no geography", async () => {
    const repos = createMemoryRepositories();
    const draft = await repos.lawyers.create(
      draftWithoutCoordinate({ email: "approve-legacy-geography@example.test" })
    );
    const originalGetById = repos.lawyers.getById.bind(repos.lawyers);
    repos.lawyers.getById = async (id: string) => {
      const lawyer = await originalGetById(id);
      if (id !== draft.id || !lawyer) return lawyer;
      return {
        ...lawyer,
        officeLat: -23.55052,
        officeLng: -46.633308,
        officeLocationPresent: false
      };
    };

    const app = await buildApp(repos);
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${draft.id}`,
      headers: ADMIN,
      payload: { status: "approved", serviceStateId: SERVICE_STATE_ID, serviceCityId: SERVICE_CITY_ID }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lawyer.status).toBe("approved");
    expect(body.lawyer.officeLocationPresent).toBe(true);
  });

  it("lets admin edit lawyer operational data and persist location from CEP", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Editavel",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email: `editavel-${Date.now()}@example.test`,
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        status: "draft"
      }
    });
    const createdId = create.json().lawyer.id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${createdId}`,
      headers: ADMIN,
      payload: {
        name: "Dra. Editavel Atualizada",
        email: create.json().lawyer.email,
        whatsapp: "11944443333",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "trabalhista",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "300",
        miniBio: "Perfil editado pelo admin.",
        instagramUrl: "https://instagram.com/editado",
        linkedinUrl: "https://www.linkedin.com/in/editado",
        status: "pending_review"
      }
    });
    await app.close();

    expect(create.statusCode).toBe(201);
    expect(patch.statusCode).toBe(200);
    expect(patch.json().lawyer).toMatchObject({
      whatsapp: "11944443333",
      officeNumber: "300",
      officeCity: expect.any(String),
      officeState: expect.any(String),
      mainAreaId: "trabalhista",
      miniBio: "Perfil editado pelo admin.",
      instagramUrl: "https://instagram.com/editado",
      linkedinUrl: "https://www.linkedin.com/in/editado"
    });
  });

  it("persists admin lawyer status changes in the subsequent list", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Status Persistente",
        serviceStateId: SERVICE_STATE_ID,
        serviceCityId: SERVICE_CITY_ID,
        email: `status-persistente-${Date.now()}@example.test`,
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        officeManualLocation: { lat: -23.55052, lng: -46.633308 },
        status: "draft"
      }
    });
    const createdId = create.json().lawyer.id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/lawyers/${createdId}`,
      headers: ADMIN,
      payload: { status: "suspended" }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/lawyers", headers: ADMIN });
    await app.close();

    expect(create.statusCode).toBe(201);
    expect(patch.statusCode).toBe(200);
    expect(patch.json().lawyer.status).toBe("suspended");
    expect(list.json().lawyers.find((item: { id: string }) => item.id === createdId).status).toBe("suspended");
  });

  it("requires auth on admin geocode", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/geocode/cep",
      payload: { cep: "01001-000" }
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects non-admin roles on admin geocode", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/geocode/cep",
      headers: { authorization: "Bearer test-client-token" },
      payload: { cep: "01001-000" }
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("validates cep format on admin geocode", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/geocode/cep",
      headers: { authorization: "Bearer test-admin-token" },
      payload: { cep: "123" }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns normalized address and coordinates for a valid cep", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/geocode/cep",
      headers: { authorization: "Bearer test-admin-token" },
      payload: { cep: "01001-000" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.address.city).toBeTruthy();
    expect(body.address.state).toBeTruthy();
    expect(body.coordinates.provider).toBe("stub");
    expect(typeof body.coordinates.lat).toBe("number");
    expect(body.coordinates.confidence).toBeTruthy();
  });

  it("requires auth on lawyer dashboard", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/lawyer/me/dashboard" });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects client role on lawyer dashboard", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/lawyer/me/dashboard",
      headers: CLIENT
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("returns a safe lawyer dashboard for lawyer role", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/lawyer/me/dashboard",
      headers: LAWYER
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lawyer).toMatchObject({
      name: "Dra. Teste",
      planLabel: "MVP interno",
      verified: true
    });
    expect(body.metrics).toEqual({ profileViews: 0, whatsappClicks: 0, contacts: 0 });
    expect(body.benefits.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("officeCep");
    expect(JSON.stringify(body)).not.toContain("client_location");
  });

  it("requires auth on prayer requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      payload: { message: "Pedido com tamanho suficiente para teste.", anonymous: true }
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("allows lawyer role on prayer requests without echoing the message", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: LAWYER,
      payload: { message: "Pedido com tamanho suficiente para teste.", anonymous: true }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().request.status).toBe("received");
    expect(JSON.stringify(response.json())).not.toContain("Pedido com tamanho");
    expect(JSON.stringify(response.json())).not.toContain("clientProfileId");
  });

  it("validates prayer request message size", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "curto", anonymous: true }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("creates an anonymous prayer request without echoing the message", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "Pedido reservado com tamanho suficiente para passar na validacao.", anonymous: true }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.request.status).toBe("received");
    expect(body.request.id).toBeTruthy();
    expect(body.request.createdAt).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("Pedido reservado");
    expect(JSON.stringify(body)).not.toContain("clientProfileId");
  });

  it("lets admin list prayer requests with message content", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "Pedido administrativo com tamanho suficiente para leitura.", anonymous: false }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/prayer-requests", headers: ADMIN });
    await app.close();

    expect(create.statusCode).toBe(201);
    expect(list.statusCode).toBe(200);
    expect(list.json().requests[0]).toMatchObject({
      message: "Pedido administrativo com tamanho suficiente para leitura.",
      anonymous: false,
      status: "received",
      client: { email: "client@example.test" }
    });
  });

  it("paginates admin prayer requests when page query is provided", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "Pedido paginado numero um com tamanho suficiente.", anonymous: true }
    });
    await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "Pedido paginado numero dois com tamanho suficiente.", anonymous: true }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/prayer-requests?page=1&pageSize=1", headers: ADMIN });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().requests).toHaveLength(1);
    expect(list.json().pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("filters paginated admin prayer requests by status", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "Pedido filtrado para leitura com tamanho suficiente.", anonymous: true }
    });
    const created = await app.inject({ method: "GET", url: "/v1/admin/prayer-requests?page=1&pageSize=1", headers: ADMIN });
    const requestId = created.json().requests[0].id;
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/prayer-requests/${requestId}`,
      headers: ADMIN,
      payload: { status: "read" }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/prayer-requests?page=1&pageSize=10&status=read", headers: ADMIN });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(1);
    expect(list.json().requests.every((request: { status: string }) => request.status === "read")).toBe(true);
  });

  it("lets admin mark a prayer request as read", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: CLIENT,
      payload: { message: "Pedido para leitura administrativa com tamanho suficiente.", anonymous: true }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/prayer-requests", headers: ADMIN });
    const requestId = list.json().requests[0].id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/prayer-requests/${requestId}`,
      headers: ADMIN,
      payload: { status: "read" }
    });
    await app.close();

    expect(patch.statusCode).toBe(200);
    expect(patch.json().request.status).toBe("read");
    expect(patch.json().request.readAt).toBeTruthy();
  });

  it("lets admin list and block registered users", async () => {
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/admin/users", headers: ADMIN });
    const client = list.json().users.find((user: { id: string }) => user.id === "test-client-user");
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/users/${client.id}`,
      headers: ADMIN,
      payload: { blocked: true }
    });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(client.email).toBe("client@example.test");
    expect(patch.statusCode).toBe(200);
    expect(patch.json().user.blockedAt).toBeTruthy();
  });

  it("paginates admin users when page query is provided", async () => {
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/admin/users?page=1&pageSize=2", headers: ADMIN });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().users).toHaveLength(2);
    expect(list.json().pagination).toMatchObject({ page: 1, pageSize: 2 });
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("filters paginated admin users by search", async () => {
    const app = await buildApp();
    const list = await app.inject({ method: "GET", url: "/v1/admin/users?page=1&pageSize=10&search=client%40example.test", headers: ADMIN });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(1);
    expect(list.json().users.every((user: { email: string }) => user.email.includes("client@example.test"))).toBe(true);
  });

  it("prevents admin from blocking the current admin session", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/admin/users/test-admin-user",
      headers: ADMIN,
      payload: { blocked: true }
    });
    await app.close();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("uploads lawyer media through the backend boundary", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyer-media",
      headers: ADMIN,
      payload: {
        kind: "avatar",
        fileName: "perfil.png",
        mimeType: "image/png",
        base64Data: Buffer.from("fake image bytes").toString("base64")
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().image).toMatchObject({
      contentType: "image/png"
    });
    expect(response.json().image.url).toContain("https://storage.example.test/lawyers/avatar/");
  });

  it("lets admin upload and create partner logos for future public rendering", async () => {
    const app = await buildApp();
    const upload = await app.inject({
      method: "POST",
      url: "/v1/admin/partner-logo-media",
      headers: ADMIN,
      payload: {
        kind: "partnerLogo",
        fileName: "parceiro.png",
        mimeType: "image/png",
        base64Data: Buffer.from("fake partner logo").toString("base64")
      }
    });
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/partner-logos",
      headers: ADMIN,
      payload: {
        name: "Parceiro Teste",
        logoUrl: upload.json().image.url,
        websiteUrl: "https://partner.example.test",
        active: true
      }
    });
    const adminList = await app.inject({ method: "GET", url: "/v1/admin/partner-logos", headers: ADMIN });
    const publicList = await app.inject({ method: "GET", url: "/v1/partner-logos" });
    await app.close();

    expect(upload.statusCode).toBe(201);
    expect(upload.json().image.url).toContain("https://storage.example.test/partners/logos/");
    expect(create.statusCode).toBe(201);
    expect(create.json().partner).toMatchObject({ name: "Parceiro Teste", active: true });
    expect(adminList.json().partners[0].logoUrl).toBe(upload.json().image.url);
    expect(publicList.json().partners[0]).toMatchObject({ name: "Parceiro Teste", logoUrl: upload.json().image.url });
  });

  it("paginates admin partner logos when page query is provided", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/admin/partner-logos",
      headers: ADMIN,
      payload: { name: "Parceiro Pagina 1", logoUrl: "https://partner.example.test/1.png", active: true }
    });
    await app.inject({
      method: "POST",
      url: "/v1/admin/partner-logos",
      headers: ADMIN,
      payload: { name: "Parceiro Pagina 2", logoUrl: "https://partner.example.test/2.png", active: true }
    });
    const list = await app.inject({ method: "GET", url: "/v1/admin/partner-logos?page=1&pageSize=1", headers: ADMIN });
    await app.close();

    expect(list.statusCode).toBe(200);
    expect(list.json().partners).toHaveLength(1);
    expect(list.json().pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(list.json().pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("manages states and cities with duplicate and linked-delete protection", async () => {
    const repos = createMemoryRepositories();
    const app = await buildApp(repos);
    const state = await app.inject({ method: "POST", url: "/v1/admin/states", headers: ADMIN, payload: { code: "SP", name: "Sao Paulo", active: true } });
    const stateId = state.json().state.id;
    const cityPayload = { stateId, name: "Campinas", active: true };
    const city = await app.inject({ method: "POST", url: "/v1/admin/cities", headers: ADMIN, payload: cityPayload });
    const duplicate = await app.inject({ method: "POST", url: "/v1/admin/cities", headers: ADMIN, payload: cityPayload });
    const deleteLinkedState = await app.inject({ method: "DELETE", url: `/v1/admin/states/${stateId}`, headers: ADMIN });
    await app.inject({ method: "PATCH", url: `/v1/admin/cities/${city.json().city.id}`, headers: ADMIN, payload: { active: false } });
    const deleteInactiveCityState = await app.inject({ method: "DELETE", url: `/v1/admin/states/${stateId}`, headers: ADMIN });
    const publicCities = await app.inject({ method: "GET", url: `/v1/states/${stateId}/cities` });
    await app.close();

    expect(state.statusCode).toBe(201);
    expect(city.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(deleteLinkedState.statusCode).toBe(409);
    expect(deleteInactiveCityState.statusCode).toBe(204);
    expect(publicCities.statusCode).toBe(404);
  });

  it("hides inactive geography records and reactivates them when recreated", async () => {
    const repos = createMemoryRepositories();
    const app = await buildApp(repos);
    const state = await app.inject({
      method: "POST",
      url: "/v1/admin/states",
      headers: ADMIN,
      payload: { code: "GO", name: "Goias", active: true }
    });
    const stateId = state.json().state.id;
    const city = await app.inject({
      method: "POST",
      url: "/v1/admin/cities",
      headers: ADMIN,
      payload: { stateId, name: "Goiania", active: true }
    });
    const cityId = city.json().city.id;

    await app.inject({ method: "PATCH", url: `/v1/admin/cities/${cityId}`, headers: ADMIN, payload: { active: false } });
    const citiesWhileInactive = await app.inject({ method: "GET", url: `/v1/admin/cities?stateId=${stateId}`, headers: ADMIN });
    const reactivatedCity = await app.inject({
      method: "POST",
      url: "/v1/admin/cities",
      headers: ADMIN,
      payload: { stateId, name: "Goiânia", active: true }
    });

    await app.inject({ method: "PATCH", url: `/v1/admin/states/${stateId}`, headers: ADMIN, payload: { active: false } });
    const statesWhileInactive = await app.inject({ method: "GET", url: "/v1/admin/states", headers: ADMIN });
    const reactivatedState = await app.inject({
      method: "POST",
      url: "/v1/admin/states",
      headers: ADMIN,
      payload: { code: "GO", name: "Goiás", active: true }
    });
    const duplicateActiveState = await app.inject({
      method: "POST",
      url: "/v1/admin/states",
      headers: ADMIN,
      payload: { code: "GO", name: "Goiás", active: true }
    });
    await app.close();

    expect(citiesWhileInactive.json().cities).toEqual([]);
    expect(reactivatedCity.statusCode).toBe(201);
    expect(reactivatedCity.json().city).toMatchObject({ id: cityId, name: "Goiânia", active: true });
    expect(statesWhileInactive.json().states).not.toContainEqual(expect.objectContaining({ id: stateId }));
    expect(reactivatedState.statusCode).toBe(201);
    expect(reactivatedState.json().state).toMatchObject({ id: stateId, name: "Goiás", active: true });
    expect(duplicateActiveState.statusCode).toBe(409);
  });

  it("lists public states and cities only when they have eligible lawyers for the selected area", async () => {
    const repos = createMemoryRepositories();
    const emptyState = await repos.geographies.createState({ code: "MT", name: "Mato Grosso", active: true });
    await repos.geographies.createCity({ stateId: emptyState.id, name: "Cuiaba", active: true });
    const emptyCity = await repos.geographies.createCity({
      stateId: SERVICE_STATE_ID,
      name: `Cidade Sem Advogado ${Date.now()}`,
      active: true
    });
    const laborCity = await repos.geographies.createCity({
      stateId: SERVICE_STATE_ID,
      name: `Cidade Trabalhista ${Date.now()}`,
      active: true
    });

    await repos.lawyers.create(
      { ...draftWithoutCoordinate({ name: "Dra. Civil Cidade", email: `civil-${Date.now()}@example.test`, status: "approved" }), serviceCityId: SERVICE_CITY_ID, availableForMatches: true },
      {
        address: { city: "Brasilia", state: "DF" },
        coordinates: { lat: -15.8, lng: -47.9 },
        geocode: { provider: "manual", precision: "manual", confidence: "high" }
      }
    );
    await repos.lawyers.create(
      { ...draftWithoutCoordinate({ name: "Dra. Trabalhista Cidade", email: `trab-${Date.now()}@example.test`, mainAreaId: "trabalhista", status: "approved" }), serviceCityId: laborCity.id, availableForMatches: true },
      {
        address: { city: "Brasilia", state: "DF" },
        coordinates: { lat: -15.81, lng: -47.91 },
        geocode: { provider: "manual", precision: "manual", confidence: "high" }
      }
    );

    const app = await buildApp(repos);
    const states = await app.inject({ method: "GET", url: "/v1/states?areaIds=civil" });
    const cities = await app.inject({ method: "GET", url: `/v1/states/${SERVICE_STATE_ID}/cities?areaIds=civil` });
    await app.close();

    expect(states.statusCode).toBe(200);
    expect(states.json().states).toEqual([
      expect.objectContaining({ id: SERVICE_STATE_ID, code: "DF" })
    ]);
    expect(states.json().states).not.toContainEqual(expect.objectContaining({ id: emptyState.id }));
    expect(cities.statusCode).toBe(200);
    expect(cities.json().cities).toEqual([
      expect.objectContaining({ id: SERVICE_CITY_ID, name: "Brasilia" })
    ]);
    expect(cities.json().cities).not.toContainEqual(expect.objectContaining({ id: emptyCity.id }));
    expect(cities.json().cities).not.toContainEqual(expect.objectContaining({ id: laborCity.id }));
  });

  it("returns paginated city matches without client coordinates or fallback", async () => {
    const repos = createMemoryRepositories();
    const city = await repos.geographies.createCity({
      stateId: SERVICE_STATE_ID,
      name: `Cidade Match ${Date.now()}`,
      active: true
    });
    await repos.lawyers.create(
      { ...draftWithoutCoordinate({ name: "Dra. Cidade", email: "cidade@example.test", status: "approved" }), serviceCityId: city.id, availableForMatches: true },
      {
        address: { city: "Brasilia", state: "DF" },
        coordinates: { lat: -15.8, lng: -47.9 },
        geocode: { provider: "manual", precision: "manual", confidence: "high" }
      }
    );
    const app = await buildApp(repos);
    const response = await app.inject({
      method: "POST",
      url: "/v1/match/by-city",
      headers: CLIENT,
      payload: { stateId: SERVICE_STATE_ID, cityId: city.id, areaIds: ["civil"], page: 1, pageSize: 5 }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "matched",
      lawyers: [{ name: "Dra. Cidade", state: "DF" }],
      pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      algorithmVersion: "city-list-v1"
    });
    expect(response.json().lawyers[0]).not.toHaveProperty("officeCep");
    expect(response.json().lawyers[0]).not.toHaveProperty("lat");
  });
});
