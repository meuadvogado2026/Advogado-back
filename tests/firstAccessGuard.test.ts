import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { loadEnv } from "../src/config/env.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
import { createAuthPreHandler } from "../src/auth/authMiddleware.js";
vi.mock("../src/lib/supabase.js", () => ({ createSupabaseAdminClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "pending-access-test-only" } }, error: null }) } }) }));

describe("first access server guard", () => {
  it("does not release business routes or mark first access before password definition", async () => {
    const repositories = createMemoryRepositories();
    await repositories.profiles.createLawyerProfile({ name: "Teste Guard", email: "guard@example.test", whatsapp: "11999999999" }, { profileId: "pending-access-test-only", mustChangePassword: true });
    const app = Fastify();
    const guard = createAuthPreHandler(loadEnv({ NODE_ENV: "production" }), repositories);
    for (const url of ["/v1/me", "/v1/auth/change-password", "/v1/lawyer/dashboard"]) app.get(url, { preHandler: guard }, async () => ({ status: "allowed" }));
    const headers = { authorization: "Bearer verified-test-only" };
    expect((await app.inject({ method: "GET", url: "/v1/lawyer/dashboard", headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/auth/change-password", headers })).statusCode).toBe(200);
    expect((await repositories.profiles.getById("pending-access-test-only"))?.firstLoginCompletedAt).toBeNull();
    await repositories.profiles.markPasswordChanged("pending-access-test-only");
    expect((await app.inject({ method: "GET", url: "/v1/lawyer/dashboard", headers })).statusCode).toBe(200);
    await app.close();
  });
});
