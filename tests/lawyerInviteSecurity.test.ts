import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
const mocks = vi.hoisted(() => ({ createUser: vi.fn(), deleteUser: vi.fn(), getUserById: vi.fn(), generateLink: vi.fn(), send: vi.fn() }));
vi.mock("../src/lib/supabase.js", () => ({ createSupabaseAdminClient: () => ({ auth: { admin: mocks } }) }));
vi.mock("../src/modules/auth/authMailer.js", () => ({ createAuthMailer: () => ({ send: mocks.send }) }));
const ADMIN = { authorization: "Bearer test-admin-token" };
const input = { name: "Dr. Teste Auth024", email: "controlled@example.test", whatsapp: "11999999999", oabNumber: "888888", oabState: "SP", mainAreaId: "civil", secondaryAreaIds: [], officeCep: "01001000", officeNumber: "1", officeManualLocation: { lat: -23.55052, lng: -46.633308 }, status: "draft", serviceStateId: "10000000-0000-4000-8000-000000000001", serviceCityId: "20000000-0000-4000-8000-000000000001" };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMAIL_PROVEDOR = "resend"; process.env.RESEND_API_KEY = "re_test_only";
  mocks.createUser.mockResolvedValue({ data: { user: { id: "created-test-only" } }, error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.getUserById.mockResolvedValue({ data: { user: { id: "created-test-only", email: input.email } }, error: null });
  mocks.generateLink.mockResolvedValue({ data: { user: { id: "created-test-only" }, properties: { hashed_token: "a".repeat(64) } }, error: null });
  mocks.send.mockResolvedValue({ status: "accepted", messageId: "mail-test-only" });
});
async function fixture() {
  const repositories = createMemoryRepositories(); repositories.mode = "supabase";
  const app = await buildApp(repositories);
  return { app, repositories };
}
describe("lawyer invitation consistency", () => {
  it("persists first-access lock before email and preserves the saved identity on delivery failure", async () => {
    const { app, repositories } = await fixture();
    mocks.send.mockRejectedValue(new Error("provider offline"));
    const response = await app.inject({ method: "POST", url: "/v1/admin/lawyers", headers: ADMIN, payload: input });
    expect(response.statusCode).toBe(201);
    expect(response.json().access).toMatchObject({ status: "failed", delivery: "failed" });
    const saved = await repositories.profiles.getById("created-test-only");
    expect(saved?.mustChangePassword).toBe(true);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.createUser.mock.calls[0]![0]).not.toHaveProperty("password");
    await app.close();
  });
  it("compensates only the Auth identity created by this attempt if persistence fails", async () => {
    const { app, repositories } = await fixture();
    vi.spyOn(repositories.lawyers, "create").mockRejectedValueOnce(new Error("persistence offline"));
    expect((await app.inject({ method: "POST", url: "/v1/admin/lawyers", headers: ADMIN, payload: input })).statusCode).toBe(500);
    expect(mocks.deleteUser).toHaveBeenCalledWith("created-test-only");
    expect(mocks.send).not.toHaveBeenCalled();
    await app.close();
  });
  it("never deletes/adopts a preexisting Auth identity when creation fails", async () => {
    mocks.createUser.mockResolvedValue({ data: {}, error: { code: "email_exists" } });
    const { app } = await fixture();
    expect((await app.inject({ method: "POST", url: "/v1/admin/lawyers", headers: ADMIN, payload: input })).statusCode).toBe(422);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    await app.close();
  });
  it("resends existing invitations without creating/remapping identity and enforces cooldown", async () => {
    const { app, repositories } = await fixture();
    const existing = await repositories.lawyers.create(input as never, undefined, { profileId: "created-test-only", accessInvitedAt: "2026-11-01T00:00:00Z", mustChangePassword: true });
    const response = await app.inject({ method: "POST", url: `/v1/admin/lawyers/${existing.id}/access-invite`, headers: ADMIN });
    expect(response.statusCode).toBe(200);
    expect(response.json().lawyer.profileId).toBe(existing.profileId);
    expect(response.json().access.providerStatus).toBe("accepted");
    expect((await repositories.profiles.getById(existing.profileId))?.mustChangePassword).toBe(true);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect((await app.inject({ method: "POST", url: `/v1/admin/lawyers/${existing.id}/access-invite`, headers: ADMIN })).statusCode).toBe(429);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it("does not send to a different identity/email or expose a link to the admin", async () => {
    const { app, repositories } = await fixture();
    const existing = await repositories.lawyers.create(input as never, undefined, { profileId: "created-test-only" });
    mocks.getUserById.mockResolvedValue({ data: { user: { id: existing.profileId, email: "other@example.test" } }, error: null });
    const response = await app.inject({ method: "POST", url: `/v1/admin/lawyers/${existing.id}/access-invite`, headers: ADMIN });
    expect(response.statusCode).toBe(503);
    expect(mocks.generateLink).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(response.body).not.toContain("token");
    expect((await app.inject({ method: "POST", url: `/v1/admin/lawyers/${existing.id}/access-invite`, headers: { authorization: "Bearer test-client-token" } })).statusCode).toBe(403);
    await app.close();
  });
});
