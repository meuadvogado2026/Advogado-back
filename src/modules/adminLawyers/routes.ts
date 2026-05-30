import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { geocodeCepSchema, lawyerCreateSchema, lawyerPatchSchema } from "../../contracts/api.js";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import { apiError } from "../../lib/httpError.js";
import type { LawyerCoordinates, Repositories } from "../../repositories/types.js";
import { GeocodingError, createGeocodingProvider, type Coordinates } from "../geocoding/geocodingService.js";

/** Coordenada elegivel para match: finita e dentro dos limites geograficos. */
function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export async function registerAdminLawyerRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAdmin = createAuthPreHandler(env, repositories, ["admin"]);
  const geocoding = createGeocodingProvider(env);

  /**
   * Resolve a coordenada de um CEP. Distingue falhas:
   * - invalid_cep/cep_not_found -> { kind: "invalid" } (rota responde 422)
   * - provider_unavailable      -> { kind: "unavailable" } (rota responde 502)
   * - address_not_geocoded      -> { kind: "ok", coordinates: null } (recuperavel)
   */
  async function resolveCoordinates(
    cep: string
  ): Promise<
    | { kind: "ok"; address: Awaited<ReturnType<typeof geocoding.lookupCep>>; coordinates: Coordinates | null }
    | { kind: "invalid" }
    | { kind: "unavailable" }
  > {
    let address: Awaited<ReturnType<typeof geocoding.lookupCep>>;
    try {
      address = await geocoding.lookupCep(cep);
    } catch (error) {
      if (error instanceof GeocodingError && (error.reason === "invalid_cep" || error.reason === "cep_not_found")) {
        return { kind: "invalid" };
      }
      return { kind: "unavailable" };
    }

    try {
      const coordinates = await geocoding.geocodeAddress(address);
      return { kind: "ok", address, coordinates };
    } catch (error) {
      if (error instanceof GeocodingError && error.reason === "address_not_geocoded") {
        return { kind: "ok", address, coordinates: null };
      }
      return { kind: "unavailable" };
    }
  }

  app.post("/admin/geocode/cep", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = geocodeCepSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido.", parsed.error.issues));
    }

    try {
      const address = await geocoding.lookupCep(parsed.data.cep);

      let coordinates = null;
      let recoverable = false;
      let note: string | undefined;
      try {
        coordinates = await geocoding.geocodeAddress(address);
      } catch (error) {
        // CEP normalizado, mas coordenada indisponivel: estado recuperavel (sem coordenada falsa).
        if (error instanceof GeocodingError && error.reason === "address_not_geocoded") {
          recoverable = true;
          note = "Endereco normalizado, mas a coordenada nao pode ser resolvida agora. Tente novamente.";
        } else {
          throw error;
        }
      }

      // Auditoria sem CEP cru nem token: apenas cidade/estado e metadados do provider.
      await repositories.auditLogs.record({
        actorProfileId: request.currentUser?.id,
        action: "admin.geocode.cep",
        entityType: "cep_lookup",
        metadata: {
          provider: coordinates?.provider ?? "none",
          city: address.city,
          state: address.state,
          geocoded: Boolean(coordinates),
          persistence: repositories.mode
        }
      });

      return reply.code(200).send({ address, coordinates, recoverable, note, persistence: repositories.mode });
    } catch (error) {
      if (error instanceof GeocodingError) {
        if (error.reason === "invalid_cep" || error.reason === "cep_not_found") {
          return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido ou nao encontrado."));
        }
        if (error.reason === "provider_unavailable") {
          return reply
            .code(503)
            .send(apiError("UPSTREAM_ERROR", "Servico de geocoding indisponivel. Tente novamente."));
        }
      }

      // Resposta generica segura: nunca expoe CEP, endereco ou stack trace.
      return reply.code(502).send(apiError("UPSTREAM_ERROR", "Falha ao geocodificar CEP."));
    }
  });

  app.get("/admin/lawyers", { preHandler: requireAdmin }, async () => ({
    lawyers: await repositories.lawyers.list(),
    page: 1,
    pageSize: 25,
    persistence: repositories.mode
  }));

  app.post("/admin/lawyers", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = lawyerCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Cadastro de advogado invalido.", parsed.error.issues));
    }

    const resolved = await resolveCoordinates(parsed.data.officeCep);
    if (resolved.kind === "invalid") {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido ou nao encontrado."));
    }
    if (resolved.kind === "unavailable") {
      return reply.code(502).send(apiError("UPSTREAM_ERROR", "Falha ao geocodificar CEP."));
    }

    const { address, coordinates } = resolved;
    const hasValidCoordinate = coordinates !== null && isValidCoordinate(coordinates.lat, coordinates.lng);

    // Criterio de aceite (spec 002): advogado aprovado para match deve ter coordenada valida.
    if (parsed.data.status === "approved" && !hasValidCoordinate) {
      return reply
        .code(422)
        .send(apiError("VALIDATION_ERROR", "Advogado aprovado para match deve ter coordenada valida."));
    }

    const officeCoordinates: LawyerCoordinates | undefined = hasValidCoordinate
      ? { lat: coordinates!.lat, lng: coordinates!.lng }
      : undefined;
    const lawyer = await repositories.lawyers.create(parsed.data, officeCoordinates);
    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.lawyers.create",
      entityType: "lawyer_profile",
      entityId: lawyer.id,
      metadata: { persistence: repositories.mode, geocoded: hasValidCoordinate }
    });

    return reply.code(201).send({ lawyer, address, coordinates, persistence: repositories.mode });
  });

  app.patch("/admin/lawyers/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = lawyerPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Atualizacao de advogado invalida.", parsed.error.issues));
    }

    const existing = await repositories.lawyers.getById(id);
    if (!existing) {
      return reply.code(404).send(apiError("NOT_FOUND", "Advogado nao encontrado."));
    }

    // Quando o CEP muda, re-geocodifica para manter a coordenada do escritorio consistente.
    let officeCoordinates: LawyerCoordinates | undefined;
    let address: Awaited<ReturnType<typeof geocoding.lookupCep>> | undefined;
    if (parsed.data.officeCep) {
      const resolved = await resolveCoordinates(parsed.data.officeCep);
      if (resolved.kind === "invalid") {
        return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido ou nao encontrado."));
      }
      if (resolved.kind === "unavailable") {
        return reply.code(502).send(apiError("UPSTREAM_ERROR", "Falha ao geocodificar CEP."));
      }
      address = resolved.address;
      if (resolved.coordinates !== null && isValidCoordinate(resolved.coordinates.lat, resolved.coordinates.lng)) {
        officeCoordinates = { lat: resolved.coordinates.lat, lng: resolved.coordinates.lng };
      }
    }

    // Coordenada resultante apos o patch: a recem-geocodificada ou a ja persistida.
    const resultingLat = officeCoordinates?.lat ?? existing.officeLat;
    const resultingLng = officeCoordinates?.lng ?? existing.officeLng;
    const targetStatus = parsed.data.status ?? existing.status;

    // Criterio de aceite (spec 002): nao permitir aprovar sem coordenada valida.
    if (targetStatus === "approved" && !isValidCoordinate(resultingLat, resultingLng)) {
      return reply
        .code(422)
        .send(apiError("VALIDATION_ERROR", "Advogado aprovado para match deve ter coordenada valida."));
    }

    const lawyer = await repositories.lawyers.update(id, parsed.data, officeCoordinates);
    if (!lawyer) {
      return reply.code(404).send(apiError("NOT_FOUND", "Advogado nao encontrado."));
    }

    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.lawyers.update",
      entityType: "lawyer_profile",
      entityId: lawyer.id,
      metadata: { persistence: repositories.mode, regeocoded: Boolean(officeCoordinates) }
    });

    return { lawyer, address };
  });
}
