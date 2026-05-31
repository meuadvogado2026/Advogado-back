import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env.js";
import { apiError } from "../lib/httpError.js";
import { createSupabaseAdminClient } from "../lib/supabase.js";
import type { Repositories } from "../repositories/types.js";
import type { Role } from "./types.js";

function extractBearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

export function createAuthPreHandler(env: AppEnv, repositories: Repositories, allowedRoles?: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearerToken(request);
    if (!token) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Token Bearer obrigatorio."));
    }

    if (env.NODE_ENV === "test") {
      if (token === env.TEST_AUTH_ADMIN_TOKEN) {
        request.currentUser = { id: "test-admin-user", email: "admin@example.test", role: "admin" };
      } else if (token === env.TEST_AUTH_CLIENT_TOKEN) {
        request.currentUser = { id: "test-client-user", email: "client@example.test", role: "client" };
      } else if (token === env.TEST_AUTH_LAWYER_TOKEN) {
        request.currentUser = { id: "test-lawyer-user", email: "lawyer@example.test", role: "lawyer" };
      } else {
        return reply.code(401).send(apiError("UNAUTHORIZED", "Token invalido."));
      }
    } else {
      const supabase = createSupabaseAdminClient(env);
      if (!supabase) {
        return reply.code(401).send(apiError("UNAUTHORIZED", "Auth Supabase nao configurado no backend."));
      }

      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        return reply.code(401).send(apiError("UNAUTHORIZED", "Token invalido."));
      }

      const profile = await repositories.profiles.getById(data.user.id);
      if (!profile) {
        return reply.code(403).send(apiError("FORBIDDEN", "Perfil sem role autorizada."));
      }

      request.currentUser = {
        id: profile.id,
        email: profile.email,
        role: profile.role
      };
    }

    if (allowedRoles && !allowedRoles.includes(request.currentUser.role)) {
      return reply.code(403).send(apiError("FORBIDDEN", "Role insuficiente para esta rota."));
    }
  };
}
