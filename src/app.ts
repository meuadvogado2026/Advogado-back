import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { loadEnv, resolveCorsOrigins } from "./config/env.js";
import { registerAdminLawyerRoutes } from "./modules/adminLawyers/routes.js";
import { registerAreaRoutes } from "./modules/areas/routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerLawyerProfileRoutes } from "./modules/lawyerProfiles/routes.js";
import { registerMatchRoutes } from "./modules/match/routes.js";
import { registerSpec008Routes } from "./modules/spec008/routes.js";
import { createRepositories } from "./repositories/index.js";
import type { Repositories } from "./repositories/types.js";

export async function buildApp(repositoriesOverride?: Repositories) {
  const env = loadEnv();
  const repositories = repositoriesOverride ?? createRepositories(env);
  const app = Fastify({
    logger: env.NODE_ENV === "production"
  });

  await app.register(cors, {
    origin: resolveCorsOrigins(env.CORS_ORIGINS)
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });

  await registerHealthRoutes(app);

  await app.register(async (v1) => {
    await registerAreaRoutes(v1, repositories.legalSpecialties);
    await registerAuthRoutes(v1, env, repositories);
    await registerMatchRoutes(v1, env, repositories);
    await registerLawyerProfileRoutes(v1, env, repositories);
    await registerSpec008Routes(v1, env, repositories);
    await registerAdminLawyerRoutes(v1, env, repositories);
  }, { prefix: env.API_BASE_PATH });

  return app;
}
