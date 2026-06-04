import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { apiError } from "../../lib/httpError.js";
import type { Repositories } from "../../repositories/types.js";

export async function registerLawyerProfileRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireProfileViewer = createAuthPreHandler(env, repositories, ["client", "admin", "lawyer"]);

  app.get("/lawyers/:id", { preHandler: requireProfileViewer }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const lawyer = await repositories.publicLawyerProfiles.getApprovedById(id);
    if (!lawyer) {
      return reply.code(404).send(apiError("NOT_FOUND", "Perfil profissional nao disponivel."));
    }

    return reply.code(200).send({ lawyer });
  });
}
