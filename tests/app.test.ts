import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";

const ADMIN = { authorization: "Bearer test-admin-token" };

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

  it("keeps areas public", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/areas" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().areas.length).toBeGreaterThan(0);
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
});
