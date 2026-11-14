import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { Repositories } from "../../repositories/types.js";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import { apiError } from "../../lib/httpError.js";
import { buildAdminDashboard } from "./service.js";

export async function registerAdminDashboardRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  app.get("/admin/dashboard", { preHandler: createAuthPreHandler(env, repositories, ["admin"]) }, async (_request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try { return buildAdminDashboard(await repositories.adminDashboard.snapshot()); }
    catch { return reply.code(502).send(apiError("UPSTREAM_ERROR", "Não foi possível atualizar os indicadores. Tente novamente.")); }
  });
}
