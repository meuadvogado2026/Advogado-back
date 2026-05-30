import type { FastifyInstance } from "fastify";
import type { LegalSpecialtyRepository } from "../../repositories/types.js";

export async function registerAreaRoutes(app: FastifyInstance, legalSpecialties: LegalSpecialtyRepository) {
  app.get("/areas", async () => ({ areas: await legalSpecialties.listActive() }));
}
