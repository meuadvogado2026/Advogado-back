import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { loadEnv, resolveCorsOrigins } from "./config/env.js";
import { registerAdminLawyerRoutes } from "./modules/adminLawyers/routes.js";
import { registerAdminOperationRoutes } from "./modules/adminOperations/routes.js";
import { registerAreaRoutes } from "./modules/areas/routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerGeographyRoutes } from "./modules/geography/routes.js";
import { registerLawyerProfileRoutes } from "./modules/lawyerProfiles/routes.js";
import { registerMatchRoutes } from "./modules/match/routes.js";
import { registerSpec008Routes } from "./modules/spec008/routes.js";
import { registerAccountDeletionRoutes } from "./modules/privacy/accountDeletionRoutes.js";
import { createRepositories } from "./repositories/index.js";
import type { Repositories } from "./repositories/types.js";

const productionLogger = {
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['set-cookie']",
      "req.body.password",
      "req.body.newPassword",
      "req.body.token",
      "req.body.access_token",
      "req.body.refresh_token",
      "req.body.message",
      "req.body.lat",
      "req.body.lng",
      "req.body.accuracyM",
      "req.body.location",
      "req.body.client_location",
      "req.body.officeManualLocation",
      "res.headers['set-cookie']"
    ],
    censor: "[REDACTED]"
  }
};

export async function buildApp(repositoriesOverride?: Repositories) {
  const env = loadEnv();
  const repositories = repositoriesOverride ?? createRepositories(env);
  const app = Fastify({
    bodyLimit: 4_000_000,
    logger: env.NODE_ENV === "production" ? productionLogger : false
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
    await registerGeographyRoutes(v1, env, repositories);
    await registerAuthRoutes(v1, env, repositories);
    await registerAccountDeletionRoutes(v1, env, repositories);
    await registerMatchRoutes(v1, env, repositories);
    await registerLawyerProfileRoutes(v1, env, repositories);
    await registerSpec008Routes(v1, env, repositories);
    await registerAdminLawyerRoutes(v1, env, repositories);
    await registerAdminOperationRoutes(v1, env, repositories);
  }, { prefix: env.API_BASE_PATH });

  return app;
}
