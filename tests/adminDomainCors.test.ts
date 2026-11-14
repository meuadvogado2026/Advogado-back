import { describe, it, expect } from "vitest";
import { buildApp } from "../src/app.js";
import { resolveCorsOrigins } from "../src/config/env.js";

describe("admin professional domain CORS", () => {
  it("retains both admin origins with a legacy env override", () => {
    expect(resolveCorsOrigins("http://localhost:5173")).toEqual(expect.arrayContaining(["https://admin.advogado20.com.br", "https://advogado20admin.vercel.app"]));
  });
  it.each(["https://admin.advogado20.com.br", "https://advogado20admin.vercel.app"])("allows authenticated preflight for %s", async origin => {
    const app = await buildApp();
    try {
      const response = await app.inject({method: "OPTIONS", url: "/v1/me", headers: {origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization"}});
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-headers"]).toContain("authorization");
    } finally {await app.close();}
  });
  it("does not allow a lookalike origin", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({method: "OPTIONS", url: "/v1/me", headers: {origin: "https://admin.advogado20.com.br.attacker.test", "access-control-request-method": "GET"}});
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {await app.close();}
  });
});
