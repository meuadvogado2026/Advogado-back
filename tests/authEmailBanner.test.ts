import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createAuthMailer } from "../src/modules/auth/authMailer.js";

describe("approved transactional email banner", () => {
  it("embeds the approved compact PNG with matching CID and keeps the action accessible without images", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "banner-fixture" }), { status: 200 }));
    const mailer = createAuthMailer(loadEnv({ NODE_ENV: "test", EMAIL_PROVEDOR: "resend", RESEND_API_KEY: "re_test_only" }), fetcher);
    await mailer.send("fixture@example.test", "a".repeat(64));
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body.attachments).toHaveLength(1);
    const attachment = body.attachments[0];
    expect(attachment.content_type).toBe("image/png");
    const png = Buffer.from(attachment.content, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(240);
    expect(png.length).toBeLessThan(250000);
    expect(createHash("sha256").update(png).digest("hex")).toBe("cfd08f98c176baacca9c47da447b2132dba248b7bf618224e335693e744995dc");
    expect(body.html).toContain(`src="cid:${attachment.content_id}"`);
    expect(body.html).toContain('alt="Advogado 2.0 — Conectando pessoas. Aproximando soluções."');
    expect(body.html).toContain('width="600"');
    expect(body.html).toContain("height:auto");
    expect(body.html).toContain("Definir nova senha</a>");
    expect(body.html).toContain("#token_hash=");
    expect(body.html).not.toMatch(/src="https?:|src="data:/);
    expect(body.text).toContain("Advogado 2.0");
    expect(body.text).toContain("#token_hash=");
    expect(body.text).not.toContain("cid:");
    expect(body.html.indexOf('<img ')).toBeLessThan(body.html.indexOf('Definir nova senha</a>'));
  });
});
