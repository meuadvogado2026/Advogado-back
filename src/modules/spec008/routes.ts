import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { prayerRequestSchema } from "../../contracts/api.js";
import { apiError } from "../../lib/httpError.js";
import type { Repositories } from "../../repositories/types.js";

export async function registerSpec008Routes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireLawyer = createAuthPreHandler(env, repositories, ["lawyer"]);
  const requirePrayerRequester = createAuthPreHandler(env, repositories, ["client", "lawyer"]);

  app.get("/lawyer/me/dashboard", { preHandler: requireLawyer }, async (request, reply) => {
    const dashboard = await repositories.lawyerDashboards.getByProfileId(request.currentUser!.id);
    if (!dashboard) {
      return reply.code(404).send(apiError("NOT_FOUND", "Dashboard do advogado nao disponivel."));
    }

    return reply.code(200).send(dashboard);
  });

  app.post(
    "/prayer-requests",
    {
      preHandler: requirePrayerRequester,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const parsed = prayerRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(422)
          .send(apiError("VALIDATION_ERROR", "Pedido de oracao invalido.", parsed.error.issues));
      }

      const created = await repositories.prayerRequests.create({
        ...parsed.data,
        clientProfileId: request.currentUser!.id
      });

      return reply.code(201).send({
        request: created
      });
    }
  );
}
