import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { lawyerEventSchema } from "../../contracts/api.js";
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

  app.post(
    "/lawyers/:id/events",
    {
      preHandler: requireProfileViewer,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = lawyerEventSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(422)
          .send(apiError("VALIDATION_ERROR", "Evento de insight invalido.", parsed.error.issues));
      }

      const publicProfile = await repositories.publicLawyerProfiles.getApprovedById(id);
      const lawyerRecord = publicProfile ? null : await repositories.lawyers.getById(id);
      if (!publicProfile && (!lawyerRecord || lawyerRecord.status !== "approved")) {
        return reply.code(404).send(apiError("NOT_FOUND", "Perfil profissional nao disponivel."));
      }

      const day = new Date().toISOString().slice(0, 10);
      const dedupeKey =
        parsed.data.dedupeKey ??
        (parsed.data.eventType === "profile_view"
          ? `${parsed.data.eventType}:${request.currentUser!.id}:${id}:${day}`
          : undefined);

      const result = await repositories.lawyerEvents.record({
        lawyerProfileId: id,
        actorProfileId: request.currentUser!.id,
        eventType: parsed.data.eventType,
        source: parsed.data.source,
        dedupeKey
      });

      return reply.code(result.recorded ? 201 : 200).send(result);
    }
  );
}
