import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { cityCreateSchema, cityPatchSchema, stateCreateSchema, statePatchSchema } from "../../contracts/api.js";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import { apiError } from "../../lib/httpError.js";
import type { Repositories } from "../../repositories/types.js";

function geographyError(error: unknown, reply: any) {
  if (error instanceof Error && error.message === "GEO_DUPLICATE") {
    return reply.code(409).send(apiError("CONFLICT", "Estado ou cidade ja cadastrado."));
  }
  if (error instanceof Error && error.message === "GEO_STATE_NOT_FOUND") {
    return reply.code(422).send(apiError("VALIDATION_ERROR", "Estado invalido."));
  }
  throw error;
}

function paginated<T>(items: T[], query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(query.pageSize ?? "20", 10) || 20));
  const total = items.length;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  };
}

export async function registerGeographyRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAdmin = createAuthPreHandler(env, repositories, ["admin"]);
  const audit = (request: any, action: string, entityType: "state" | "city", entityId?: string) =>
    repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action,
      entityType,
      entityId
    });

  app.get("/states", async () => ({ states: await repositories.geographies.listStates(true) }));
  app.get("/states/:stateId/cities", async (request, reply) => {
    const { stateId } = request.params as { stateId: string };
    const state = await repositories.geographies.getState(stateId);
    if (!state?.active) return reply.code(404).send(apiError("NOT_FOUND", "Estado nao encontrado."));
    return { cities: await repositories.geographies.listCities(stateId, true) };
  });

  app.get("/admin/states", { preHandler: requireAdmin }, async (request) => {
    const result = paginated(await repositories.geographies.listStates(), request.query as { page?: string; pageSize?: string });
    return { states: result.items, pagination: result.pagination };
  });
  app.post("/admin/states", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = stateCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(apiError("VALIDATION_ERROR", "Estado invalido.", parsed.error.issues));
    try {
      const state = await repositories.geographies.createState(parsed.data);
      await audit(request, "geography.state.created", "state", state.id);
      return reply.code(201).send({ state });
    }
    catch (error) { return geographyError(error, reply); }
  });
  app.patch("/admin/states/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = statePatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(apiError("VALIDATION_ERROR", "Estado invalido.", parsed.error.issues));
    try {
      const state = await repositories.geographies.updateState((request.params as { id: string }).id, parsed.data);
      if (state) await audit(request, "geography.state.updated", "state", state.id);
      return state ? { state } : reply.code(404).send(apiError("NOT_FOUND", "Estado nao encontrado."));
    } catch (error) { return geographyError(error, reply); }
  });
  app.delete("/admin/states/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const result = await repositories.geographies.deleteState((request.params as { id: string }).id);
    if (result === "linked") return reply.code(409).send(apiError("CONFLICT", "Estado vinculado deve ser desativado."));
    if (result === "not_found") return reply.code(404).send(apiError("NOT_FOUND", "Estado nao encontrado."));
    await audit(request, "geography.state.deleted", "state", (request.params as { id: string }).id);
    return reply.code(204).send();
  });

  app.get("/admin/cities", { preHandler: requireAdmin }, async (request) => {
    const query = request.query as { stateId?: string; page?: string; pageSize?: string };
    const result = paginated(await repositories.geographies.listCities(query.stateId), query);
    return { cities: result.items, pagination: result.pagination };
  });
  app.post("/admin/cities", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = cityCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(apiError("VALIDATION_ERROR", "Cidade invalida.", parsed.error.issues));
    try {
      const city = await repositories.geographies.createCity(parsed.data);
      await audit(request, "geography.city.created", "city", city.id);
      return reply.code(201).send({ city });
    }
    catch (error) { return geographyError(error, reply); }
  });
  app.patch("/admin/cities/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = cityPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(apiError("VALIDATION_ERROR", "Cidade invalida.", parsed.error.issues));
    try {
      const city = await repositories.geographies.updateCity((request.params as { id: string }).id, parsed.data);
      if (city) await audit(request, "geography.city.updated", "city", city.id);
      return city ? { city } : reply.code(404).send(apiError("NOT_FOUND", "Cidade nao encontrada."));
    } catch (error) { return geographyError(error, reply); }
  });
  app.delete("/admin/cities/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const result = await repositories.geographies.deleteCity((request.params as { id: string }).id);
    if (result === "linked") return reply.code(409).send(apiError("CONFLICT", "Cidade vinculada deve ser desativada."));
    if (result === "not_found") return reply.code(404).send(apiError("NOT_FOUND", "Cidade nao encontrada."));
    await audit(request, "geography.city.deleted", "city", (request.params as { id: string }).id);
    return reply.code(204).send();
  });
}
