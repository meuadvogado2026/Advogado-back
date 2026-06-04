import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";

const ADMIN = { authorization: "Bearer test-admin-token" };
const CLIENT = { authorization: "Bearer test-client-token" };
const LAWYER = { authorization: "Bearer test-lawyer-token" };

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
    expect(response.json()).toMatchObject({ status: "ok", service: "meu-advogado-20-back" });
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
    expect(typeof body.distanceKm).toBe("number");
    // Nao deve vazar PII interna (CEP/endereco completo).
    expect(body.lawyer.officeCep).toBeUndefined();
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

  it("rejects lawyer role on client lawyer profile", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/lawyers/fixture-lawyer-sp",
      headers: { authorization: "Bearer test-lawyer-token" }
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
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
        email: "insecure-url@example.test",
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        avatarUrl: "http://example.test/avatar.jpg",
        status: "draft"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().lawyer.avatarUrl).toBeNull();
  });

  it("keeps areas public", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/areas" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().areas.length).toBeGreaterThan(0);
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
        email: "admin@example.test",
        role: "admin"
      }
    });
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
        email: "smoke-lawyer@example.test",
        whatsapp: "11999999999",
        oabNumber: "123456",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: ["consumidor"],
        officeCep: "01001-000",
        officeNumber: "100",
        status: "draft"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(response.json().persistence).toBe("memory");
    expect(response.json().lawyer.profileId).toBeTruthy();
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
        email,
        whatsapp: "11999998888",
        oabNumber: "456789",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: ["consumidor"],
        officeCep: "01001-000",
        officeNumber: "101",
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

  it("persists the geocoded coordinate when creating a lawyer", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Coordenada Persistida",
        email: "persist-coord@example.test",
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
        status: "approved"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    const body = response.json();
    // Coordenada geocodificada deve ser persistida no registro do advogado.
    expect(typeof body.lawyer.officeLat).toBe("number");
    expect(typeof body.lawyer.officeLng).toBe("number");
    expect(typeof body.coordinates.lat).toBe("number");
  });

  it("blocks approving a lawyer that has no valid coordinate", async () => {
    // Semeia um advogado draft sem coordenada direto no repo em memoria
    // (mesmo Map global usado pela app), sem passar pelo geocoding.
    const repos = createMemoryRepositories();
    const draft = await repos.lawyers.create(draftWithoutCoordinate({ email: "block-approve@example.test" }));
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
      payload: { status: "approved", officeCep: "01001-000" }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lawyer.status).toBe("approved");
    expect(typeof body.lawyer.officeLat).toBe("number");
    expect(typeof body.lawyer.officeLng).toBe("number");
  });

  it("persists admin lawyer status changes in the subsequent list", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/lawyers",
      headers: ADMIN,
      payload: {
        name: "Dra. Status Persistente",
        email: `status-persistente-${Date.now()}@example.test`,
        whatsapp: "11955554444",
        oabNumber: "778899",
        oabState: "SP",
        mainAreaId: "civil",
        secondaryAreaIds: [],
        officeCep: "01001-000",
        officeNumber: "200",
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

  it("rejects lawyer role on prayer requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/prayer-requests",
      headers: LAWYER,
      payload: { message: "Pedido com tamanho suficiente para teste.", anonymous: true }
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
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
});
