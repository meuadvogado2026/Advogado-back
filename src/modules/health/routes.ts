import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "advogado-20-back",
    release: "privacy-20261114",
    authRelease: "secure-links-20261115-r3",
    timestamp: new Date().toISOString()
  }));
}
