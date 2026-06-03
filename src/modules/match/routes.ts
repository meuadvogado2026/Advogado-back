import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { matchRequestSchema } from "../../contracts/api.js";
import { apiError } from "../../lib/httpError.js";
import type { Repositories } from "../../repositories/types.js";

const ALGORITHM_VERSION = "geo-nearest-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSupabaseAreaId(value: string) {
  return UUID_PATTERN.test(value);
}

export async function registerMatchRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireClient = createAuthPreHandler(env, repositories, ["client", "admin"]);

  app.post("/match", { preHandler: requireClient }, async (request, reply) => {
    const parsed = matchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Payload de match invalido.", parsed.error.issues));
    }

    const { lat, lng, accuracyM, areaIds } = parsed.data;
    if (repositories.mode === "supabase" && areaIds.some((areaId) => !isSupabaseAreaId(areaId))) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Payload de match invalido."));
    }

    const nearest = await repositories.matches.findNearest({
      lat,
      lng,
      areaIds,
      maxRadiusKm: env.MATCH_MAX_RADIUS_KM
    });

    // Evento de match: coordenada vai para o banco (auditoria/produto), nunca para logs.
    await repositories.matchEvents.record({
      clientProfileId: request.currentUser?.id,
      lawyerProfileId: nearest?.lawyer.id,
      lat,
      lng,
      accuracyM,
      specialtyIds: areaIds,
      distanceKm: nearest?.distanceKm,
      algorithmVersion: ALGORITHM_VERSION
    });

    if (!nearest) {
      return reply.code(200).send({ status: "empty", lawyer: null, algorithmVersion: ALGORITHM_VERSION });
    }

    return reply.code(200).send({
      status: "matched",
      lawyer: nearest.lawyer,
      distanceKm: nearest.distanceKm,
      algorithmVersion: ALGORITHM_VERSION
    });
  });
}
