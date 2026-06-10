import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { geocodeCepSchema, lawyerCreateSchema, lawyerPatchSchema } from "../../contracts/api.js";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import { apiError } from "../../lib/httpError.js";
import { createSupabaseAdminClient } from "../../lib/supabase.js";
import type { LawyerOfficeLocation, Repositories } from "../../repositories/types.js";
import {
  GeocodingError,
  createGeocodingProvider,
  isOperationalOfficeGeocode,
  isReliableOfficeGeocode,
  isValidGeocodeCoordinate,
  type Coordinates
} from "../geocoding/geocodingService.js";

export function isMatchEligibleGeocoding(coordinates: Coordinates | null | undefined): boolean {
  return isReliableOfficeGeocode(coordinates);
}

const isValidCoordinate = isValidGeocodeCoordinate;

export async function registerAdminLawyerRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAdmin = createAuthPreHandler(env, repositories, ["admin"]);
  const geocoding = createGeocodingProvider(env);

  type ProvisionedLawyerAccess = {
    profileId: string;
    accessInvitedAt: string;
    delivery: "email" | "simulated";
    rollback?: () => Promise<void>;
  };

  async function provisionLawyerAccess(input: { email: string; name: string }): Promise<ProvisionedLawyerAccess | null> {
    const invitedAt = new Date().toISOString();
    if (repositories.mode === "memory") {
      return {
        profileId: crypto.randomUUID(),
        accessInvitedAt: invitedAt,
        delivery: "simulated"
      };
    }

    const supabase = createSupabaseAdminClient(env);
    if (!supabase) return null;

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(input.email, {
      data: {
        name: input.name,
        role: "lawyer"
      },
      redirectTo: env.LAWYER_INVITE_REDIRECT_URL
    });

    if (error || !data.user) {
      throw new Error("LAWYER_ACCESS_INVITE_FAILED");
    }

    return {
      profileId: data.user.id,
      accessInvitedAt: data.user.invited_at ?? invitedAt,
      delivery: "email",
      rollback: async () => {
        await supabase.auth.admin.deleteUser(data.user!.id);
      }
    };
  }

  function accessResponse(access: ProvisionedLawyerAccess | null) {
    if (!access) return { status: "not_configured", delivery: "none" as const };
    return {
      status: "invited" as const,
      delivery: access.delivery,
      invitedAt: access.accessInvitedAt
    };
  }

  /**
   * Resolve a coordenada de um CEP. Distingue falhas:
   * - invalid_cep/cep_not_found -> { kind: "invalid" } (rota responde 422)
   * - provider_unavailable      -> { kind: "unavailable" } (rota responde 502)
   * - address_not_geocoded      -> { kind: "ok", coordinates: null } (recuperavel)
   */
  async function resolveCoordinates(
    cep: string,
    officeNumber?: string
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
      const coordinates = await geocoding.geocodeAddress(address, { streetNumber: officeNumber });
      return { kind: "ok", address, coordinates: isOperationalOfficeGeocode(coordinates) ? coordinates : null };
    } catch (error) {
      if (error instanceof GeocodingError && error.reason === "address_not_geocoded") {
        return { kind: "ok", address, coordinates: null };
      }
      return { kind: "unavailable" };
    }
  }

  async function resolveAddress(
    cep: string
  ): Promise<
    | { kind: "ok"; address: Awaited<ReturnType<typeof geocoding.lookupCep>> }
    | { kind: "invalid" }
    | { kind: "unavailable" }
  > {
    try {
      return { kind: "ok", address: await geocoding.lookupCep(cep) };
    } catch (error) {
      if (error instanceof GeocodingError && (error.reason === "invalid_cep" || error.reason === "cep_not_found")) {
        return { kind: "invalid" };
      }
      return { kind: "unavailable" };
    }
  }

  function toManualCoordinates(input: { lat: number; lng: number }): Coordinates {
    return {
      lat: input.lat,
      lng: input.lng,
      provider: "manual",
      precision: "manual",
      confidence: "high"
    };
  }

  function toOfficeLocation(
    address: { city: string; state: string } | undefined,
    coordinates: Coordinates | null
  ): LawyerOfficeLocation {
    return {
      address: address ? { city: address.city, state: address.state } : undefined,
      coordinates: coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : undefined,
      clearCoordinates: !coordinates,
      geocode: coordinates
        ? {
            provider: coordinates.provider,
            precision: coordinates.precision,
            confidence: coordinates.confidence,
            geocodedAt: new Date().toISOString()
          }
        : undefined
    };
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
        coordinates = await geocoding.geocodeAddress(address, { streetNumber: parsed.data.officeNumber });
        if (!isOperationalOfficeGeocode(coordinates)) {
          coordinates = null;
          recoverable = true;
          note = "Endereco normalizado, mas a coordenada retornada e ampla demais para calcular distancia confiavel. Ajuste a base de atendimento.";
        } else if (!isMatchEligibleGeocoding(coordinates)) {
          recoverable = true;
          note = "Coordenada aproximada por bairro/CEP. Confirme a localizacao real antes de usar distancia no match.";
        }
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

    const serviceCity = await repositories.geographies.getCity(parsed.data.serviceCityId);
    const serviceState = await repositories.geographies.getState(parsed.data.serviceStateId);
    if (!serviceCity?.active || !serviceState?.active || serviceCity.stateId !== serviceState.id) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Estado e cidade de atendimento invalidos."));
    }

    const resolved = await resolveCoordinates(parsed.data.officeCep, parsed.data.officeNumber);
    if (resolved.kind === "invalid") {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido ou nao encontrado."));
    }
    if (resolved.kind === "unavailable") {
      return reply.code(502).send(apiError("UPSTREAM_ERROR", "Falha ao geocodificar CEP."));
    }

    const { address } = resolved;
    const coordinates = toManualCoordinates(parsed.data.officeManualLocation);
    const hasReliableCoordinate = isMatchEligibleGeocoding(coordinates);
    const officeLocation = toOfficeLocation(address, coordinates);
    let access: ProvisionedLawyerAccess | null;
    try {
      access = await provisionLawyerAccess({ email: parsed.data.email, name: parsed.data.name });
    } catch {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Nao foi possivel enviar convite de acesso para este e-mail."));
    }
    if (!access) {
      return reply.code(503).send(apiError("UPSTREAM_ERROR", "Convite de acesso indisponivel sem credencial server-side."));
    }

    let lawyer;
    try {
      const { officeManualLocation: _manual, serviceStateId: _state, ...lawyerInput } = parsed.data;
      lawyer = await repositories.lawyers.create(lawyerInput, officeLocation, {
        profileId: access.profileId,
        accessInvitedAt: access.accessInvitedAt,
        mustChangePassword: false
      });
    } catch (error) {
      await access.rollback?.();
      throw error;
    }

    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.lawyers.create",
      entityType: "lawyer_profile",
      entityId: lawyer.id,
      metadata: {
        persistence: repositories.mode,
        geocoded: Boolean(coordinates),
        geocodePrecision: coordinates?.precision ?? null,
        geocodeConfidence: coordinates?.confidence ?? null,
        matchEligible: hasReliableCoordinate,
        access: accessResponse(access)
      }
    });

    return reply.code(201).send({ lawyer, address, coordinates, access: accessResponse(access), persistence: repositories.mode });
  });

  app.post("/admin/lawyers/:id/access-invite", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await repositories.lawyers.getById(id);
    if (!existing) {
      return reply.code(404).send(apiError("NOT_FOUND", "Advogado nao encontrado."));
    }
    const profile = await repositories.profiles.getById(existing.profileId);
    if (!profile) {
      return reply.code(404).send(apiError("NOT_FOUND", "Perfil do advogado nao encontrado."));
    }
    if (profile.accessInvitedAt) {
      return reply.code(409).send(apiError("CONFLICT", "Advogado ja possui convite de acesso registrado."));
    }

    let access: ProvisionedLawyerAccess | null;
    try {
      access = await provisionLawyerAccess({ email: existing.email, name: existing.name });
    } catch {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Nao foi possivel enviar convite de acesso para este e-mail."));
    }
    if (!access) {
      return reply.code(503).send(apiError("UPSTREAM_ERROR", "Convite de acesso indisponivel sem credencial server-side."));
    }

    let lawyer;
    try {
      lawyer = await repositories.lawyers.activateAccess(id, {
        profileId: access.profileId,
        accessInvitedAt: access.accessInvitedAt
      });
    } catch (error) {
      await access.rollback?.();
      throw error;
    }
    if (!lawyer) {
      await access.rollback?.();
      return reply.code(404).send(apiError("NOT_FOUND", "Advogado nao encontrado."));
    }

    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.lawyers.access_invite",
      entityType: "lawyer_profile",
      entityId: lawyer.id,
      metadata: { persistence: repositories.mode, access: accessResponse(access) }
    });

    return reply.code(200).send({ lawyer, access: accessResponse(access), persistence: repositories.mode });
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
    const targetCityId = parsed.data.serviceCityId ?? existing.serviceCityId;
    if (!targetCityId) return reply.code(422).send(apiError("VALIDATION_ERROR", "Estado e cidade de atendimento sao obrigatorios."));
    const serviceCity = await repositories.geographies.getCity(targetCityId);
    const targetStateId = parsed.data.serviceStateId ?? serviceCity?.stateId;
    const serviceState = targetStateId ? await repositories.geographies.getState(targetStateId) : null;
    if (!serviceCity?.active || !serviceState?.active || serviceCity.stateId !== serviceState.id) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Estado e cidade de atendimento invalidos."));
    }

    // Quando o CEP muda, re-geocodifica para manter a coordenada do escritorio consistente.
    // Se o admin aprova um legado sem coordenada confiavel, tenta recuperar usando o CEP ja salvo.
    let officeLocation: LawyerOfficeLocation | undefined;
    let address: Awaited<ReturnType<typeof geocoding.lookupCep>> | undefined;
    const manualCoordinates = parsed.data.officeManualLocation ? toManualCoordinates(parsed.data.officeManualLocation) : null;
    const hasStoredReliableMatchLocation =
      isValidCoordinate(existing.officeLat, existing.officeLng) &&
      existing.officeLocationPresent === true &&
      existing.officeGeocodeConfidence === "high" &&
      (existing.officeGeocodePrecision === "street" || existing.officeGeocodePrecision === "manual");
    const shouldRecoverMissingCoordinate =
      (parsed.data.status ?? existing.status) === "approved" &&
      !manualCoordinates &&
      !hasStoredReliableMatchLocation &&
      Boolean(existing.officeCep);
    const cepToResolve = parsed.data.officeCep ?? (!manualCoordinates && shouldRecoverMissingCoordinate ? existing.officeCep : undefined);
    const officeNumberToResolve = parsed.data.officeNumber ?? existing.officeNumber;

    if (manualCoordinates) {
      const cepForAddress = parsed.data.officeCep;
      if (cepForAddress) {
        const resolved = await resolveAddress(cepForAddress);
        if (resolved.kind === "invalid") {
          return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido ou nao encontrado."));
        }
        if (resolved.kind === "unavailable") {
          return reply.code(502).send(apiError("UPSTREAM_ERROR", "Falha ao consultar CEP."));
        }
        address = resolved.address;
      }
      const addressForLocation = address
        ? { city: address.city, state: address.state }
        : existing.officeCity && existing.officeState
          ? { city: existing.officeCity, state: existing.officeState }
          : undefined;
      officeLocation = toOfficeLocation(addressForLocation, manualCoordinates);
    } else if (cepToResolve) {
      const resolved = await resolveCoordinates(cepToResolve, officeNumberToResolve);
      if (resolved.kind === "invalid") {
        return reply.code(422).send(apiError("VALIDATION_ERROR", "CEP invalido ou nao encontrado."));
      }
      if (resolved.kind === "unavailable") {
        return reply.code(502).send(apiError("UPSTREAM_ERROR", "Falha ao geocodificar CEP."));
      }
      address = resolved.address;
      officeLocation = toOfficeLocation({ city: resolved.address.city, state: resolved.address.state }, resolved.coordinates);
    }

    // Localizacao resultante apos o patch: a recem-geocodificada ou a ja persistida.
    const resultingLat = officeLocation?.coordinates?.lat ?? existing.officeLat;
    const resultingLng = officeLocation?.coordinates?.lng ?? existing.officeLng;
    const resultingHasReliableMatchLocation = officeLocation
      ? Boolean(
          officeLocation.geocode &&
            officeLocation.geocode.confidence === "high" &&
            (officeLocation.geocode.precision === "street" || officeLocation.geocode.precision === "manual")
        )
      : hasStoredReliableMatchLocation;
    const targetStatus = parsed.data.status ?? existing.status;

    // Criterio de aceite: aprovacao para match exige coordenada confiavel, nao centroide aproximado.
    if (targetStatus === "approved" && (!isValidCoordinate(resultingLat, resultingLng) || !resultingHasReliableMatchLocation)) {
      return reply
        .code(422)
        .send(apiError("VALIDATION_ERROR", "Advogado aprovado para match deve ter coordenada confiavel."));
    }

    const { serviceStateId: _serviceStateId, ...lawyerPatch } = parsed.data;
    const lawyer = await repositories.lawyers.update(id, lawyerPatch, officeLocation);
    if (!lawyer) {
      return reply.code(404).send(apiError("NOT_FOUND", "Advogado nao encontrado."));
    }

    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.lawyers.update",
      entityType: "lawyer_profile",
      entityId: lawyer.id,
      metadata: {
        persistence: repositories.mode,
        locationUpdate: officeLocation?.geocode?.precision ?? null,
        matchEligible: lawyer.officeLocationStatus === "validated"
      }
    });

    return { lawyer, address };
  });
}
