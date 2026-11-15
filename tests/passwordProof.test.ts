import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { loadEnv } from "../src/config/env.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
import { registerPasswordRoutes } from "../src/modules/auth/passwordRoutes.js";
const mock = vi.hoisted(() => ({ verifyOtp: vi.fn(), updateUserById: vi.fn(), signOut: vi.fn() }));
vi.mock("../src/lib/supabase.js", () => ({ createSupabaseAdminClient: () => ({ auth: { verifyOtp: mock.verifyOtp, admin: { updateUserById: mock.updateUserById, signOut: mock.signOut } } }) }));
const payload = { tokenHash: "a".repeat(64), type: "recovery", newPassword: "test-only-password", confirmPassword: "test-only-password" };
async function fixture() {
  const repositories = createMemoryRepositories();
  await repositories.profiles.updateBlocked("test-client-user", false);
  repositories.mode = "supabase";
  const mark = vi.spyOn(repositories.profiles, "markPasswordChanged");
  const app = Fastify();
  await registerPasswordRoutes(app, loadEnv({ NODE_ENV: "production" }), repositories);
  return { app, mark, repositories };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.verifyOtp.mockResolvedValue({ data: { user: { id: "test-client-user" }, session: { access_token: "proof-session-test-only" } }, error: null });
  mock.updateUserById.mockResolvedValue({ error: null });
  mock.signOut.mockResolvedValue({ error: null });
});
describe("official proof authority", () => {
  it("reports upstream network failure safely without changing a password", async () => {
    mock.verifyOtp.mockRejectedValue(new Error("upstream connection failed"));
    const { app } = await fixture();
    const response = await app.inject({ method: "POST", url: "/auth/password-reset", payload });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("upstream connection failed");
    expect(mock.updateUserById).not.toHaveBeenCalled();
    await app.close();
  });
  it.each(["test-client-user", "test-lawyer-user", "test-admin-user"])("changes only verified %s and revokes refresh sessions without exposing them", async id => {
    mock.verifyOtp.mockResolvedValue({ data: { user: { id }, session: { access_token: "proof-session-test-only" } }, error: null });
    const { app, mark, repositories } = await fixture();
    const before = await repositories.profiles.getById(id);
    const response = await app.inject({ method: "POST", url: "/auth/password-reset", payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "password_updated" });
    expect(mock.updateUserById).toHaveBeenCalledWith(id, { password: payload.newPassword });
    expect(mark).toHaveBeenCalledWith(id);
    const after = await repositories.profiles.getById(id);
    expect(after?.role).toBe(before?.role);
    expect(after?.id).toBe(before?.id);
    expect(mock.signOut).toHaveBeenCalledWith("proof-session-test-only", "global");
    await app.close();
  });
  it("rejects expired/tampered/used proof based on provider validation before any write", async () => {
    mock.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "otp_expired" } });
    const { app, mark } = await fixture();
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload })).statusCode).toBe(401);
    expect(mock.updateUserById).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
    await app.close();
  });
  it("rejects replay after successful completion and never updates twice", async () => {
    mock.verifyOtp.mockResolvedValueOnce({ data: { user: { id: "test-client-user" }, session: { access_token: "proof-session-test-only" } }, error: null }).mockResolvedValueOnce({ data: {}, error: { code: "otp_expired" } });
    const { app } = await fixture();
    expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload })).statusCode).toBe(401);
    expect(mock.updateUserById).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it("does not consume proof for GET, wrong flow or mismatched confirmation", async () => {
    const { app } = await fixture();
    expect((await app.inject({ method: "GET", url: "/auth/password-reset" })).statusCode).toBe(404);
    for (const extra of [{ type: "invite" }, { confirmPassword: "mismatch" }, { userId: "victim" }]) expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload: { ...payload, ...extra } })).statusCode).toBe(422);
    expect(mock.verifyOtp).not.toHaveBeenCalled();
    await app.close();
  });
  it("refuses blocked identities and still revokes the temporary session", async () => {
    const { app, repositories } = await fixture();
    await repositories.profiles.updateBlocked("test-client-user", true);
    expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload })).statusCode).toBe(401);
    expect(mock.updateUserById).not.toHaveBeenCalled();
    expect(mock.signOut).toHaveBeenCalled();
    await app.close();
  });
  it("leaves first-access locked if the provider refuses the password", async () => {
    mock.updateUserById.mockResolvedValue({ error: { code: "weak_password" } });
    const { app, mark } = await fixture();
    expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload })).statusCode).toBe(422);
    expect(mark).not.toHaveBeenCalled();
    expect(mock.signOut).toHaveBeenCalled();
    await app.close();
  });
  it("reports reconciliation instead of success if the domain update fails after password change", async () => {
    const { app, mark } = await fixture();
    mark.mockRejectedValue(new Error("database unavailable"));
    expect((await app.inject({ method: "POST", url: "/auth/password-reset", payload })).statusCode).toBe(503);
    expect(mock.signOut).toHaveBeenCalled();
    await app.close();
  });
});
