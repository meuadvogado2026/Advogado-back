import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { authRequestIp, createAuthLimiter } from "../src/modules/auth/passwordRoutes.js";
import { createAuthMailer } from "../src/modules/auth/authMailer.js";

afterEach(() => vi.unstubAllGlobals());
describe("secure password recovery", () => {
  it("gives successive recovery attempts distinct subjects and visible request references", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: "mail-test-only" }), { status: 200 }));
    const mailer = createAuthMailer(loadEnv({ NODE_ENV: "test", EMAIL_PROVEDOR: "resend", RESEND_API_KEY: "re_test_key" }), fetcher);
    await mailer.send("controlled@example.test", "a".repeat(56));
    await mailer.send("controlled@example.test", "b".repeat(56));
    const first = JSON.parse(fetcher.mock.calls[0]![1]!.body);
    const second = JSON.parse(fetcher.mock.calls[1]![1]!.body);
    expect(first.subject).not.toEqual(second.subject);
    expect(first.text).toContain("Solicitação:");
    expect(first.html).toContain("Solicitação:");
    expect(first.text).toContain("Use somente a solicitação mais recente.");
    expect(first.subject).not.toContain("a".repeat(56));
  });
  it("trusts DO client IP only by explicit production config and never trusts X-Forwarded-For", () => {
    const request = { ip: "127.0.0.1", headers: { "do-connecting-ip": "198.51.100.20", "x-forwarded-for": "203.0.113.5" } };
    expect(authRequestIp(request, loadEnv({ NODE_ENV: "production" }))).toBe("127.0.0.1");
    expect(authRequestIp(request, loadEnv({ NODE_ENV: "production", AUTH_IP_SOURCE: "digitalocean" }))).toBe("198.51.100.20");
    expect(authRequestIp({ ...request, headers: { "do-connecting-ip": "198.51.100.20,203.0.113.5" } }, loadEnv({ NODE_ENV: "production", AUTH_IP_SOURCE: "digitalocean" }))).toBe("127.0.0.1");
    expect(authRequestIp(request, loadEnv({ NODE_ENV: "test", AUTH_IP_SOURCE: "digitalocean" }))).toBe("127.0.0.1");
  });
  it("applies per-identifier cooldown/window uniformly and permits a new attempt after expiry", () => {
    let time = 0; const allow = createAuthLimiter(() => time);
    expect(allow("email:controlled@example.test", 3, 60_000)).toBe(true);
    expect(allow("email:controlled@example.test", 3, 60_000)).toBe(false);
    time = 60_000; expect(allow("email:controlled@example.test", 3, 60_000)).toBe(true);
    time = 120_000; expect(allow("email:controlled@example.test", 3, 60_000)).toBe(true);
    time = 180_000; expect(allow("email:controlled@example.test", 3, 60_000)).toBe(false);
    time = 900_001; expect(allow("email:controlled@example.test", 3, 60_000)).toBe(true);
  });
  it("returns the same generic result for any valid email without exposing tokens", async () => {
    const app = await buildApp();
    const known = await app.inject({ method: "POST", url: "/v1/auth/password-recovery", payload: { email: "client@example.test" } });
    const absent = await app.inject({ method: "POST", url: "/v1/auth/password-recovery", payload: { email: "absent@example.test" } });
    expect(known.statusCode).toBe(202);
    expect(absent.statusCode).toBe(202);
    expect(known.json()).toEqual(absent.json());
    expect(known.headers["cache-control"]).toBe("no-store");
    const invalid = await app.inject({ method: "POST", url: "/v1/auth/password-recovery", payload: { email: "invalid" } });
    expect(invalid.statusCode).toBe(422);
    await app.close();
  });
  it("rejects arbitrary identity, missing proof and mismatched passwords", async () => {
    const app = await buildApp();
    for (const payload of [{ newPassword: "long-password" }, { tokenHash: "f".repeat(64), type: "recovery", newPassword: "long-password", confirmPassword: "different-password" }, { tokenHash: "f".repeat(64), type: "invite", userId: "victim", newPassword: "long-password", confirmPassword: "long-password" }]) {
      expect((await app.inject({ method: "POST", url: "/v1/auth/password-reset", payload })).statusCode).toBe(422);
    }
    expect((await app.inject({ method: "POST", url: "/v1/auth/password-reset", payload: { tokenHash: "f".repeat(64), type: "recovery", newPassword: "long-password", confirmPassword: "long-password" } })).statusCode).toBe(401);
    await app.close();
  });
  it("bounds IP abuse even when addresses differ", async () => {
    const app = await buildApp();
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: "POST", url: "/v1/auth/password-recovery", payload: { email: `test${i}@example.test` } })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/v1/auth/password-recovery", payload: { email: "other@example.test" } })).statusCode).toBe(429);
    await app.close();
  });
  it("retries transient Resend failure with the same idempotency key and fixed destination URL", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: "mail-1" }), { status: 200 }));
    const mailer = createAuthMailer(loadEnv({ NODE_ENV: "test", EMAIL_PROVEDOR: "resend", RESEND_API_KEY: "re_test_key" }), fetcher);
    expect(await mailer.send("controlled@example.test", "a".repeat(64))).toEqual({ status: "accepted", messageId: "mail-1" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![1]!.headers["Idempotency-Key"]).toBe(fetcher.mock.calls[1]![1]!.headers["Idempotency-Key"]);
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body);
    expect(body.text).toContain("https://admin.advogado20.com.br/redefinir-senha#token_hash=");
    expect(body.text).not.toContain("access_token");
  });
  it("never considers provider errors accepted", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    const mailer = createAuthMailer(loadEnv({ NODE_ENV: "test", EMAIL_PROVEDOR: "resend", RESEND_API_KEY: "re_test_key" }), fetcher);
    await expect(mailer.send("controlled@example.test", "a".repeat(64))).rejects.toThrow("AUTH_EMAIL_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
