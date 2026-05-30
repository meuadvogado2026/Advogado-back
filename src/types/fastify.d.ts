import type { AuthenticatedUser } from "../auth/types.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
  }
}
