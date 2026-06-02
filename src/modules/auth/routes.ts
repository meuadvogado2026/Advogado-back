import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import type { Repositories } from "../../repositories/types.js";

export async function registerAuthRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAuthenticated = createAuthPreHandler(env, repositories);

  app.get("/me", { preHandler: requireAuthenticated }, async (request) => ({
    user: {
      id: request.currentUser!.id,
      email: request.currentUser!.email,
      role: request.currentUser!.role
    }
  }));
}
