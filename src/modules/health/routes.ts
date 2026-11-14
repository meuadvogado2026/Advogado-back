import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "advogado-20-back",
    release: "privacy-20261114",
    timestamp: new Date().toISOString()
  }));
}
