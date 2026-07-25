import type { FastifyInstance } from "fastify";
import { createAuthPreHandler, extractBearerToken } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { changePasswordSchema, clientSignupSchema } from "../../contracts/api.js";
import { apiError } from "../../lib/httpError.js";
import { createSupabaseAdminClient } from "../../lib/supabase.js";
import type { Repositories } from "../../repositories/types.js";

type OAuthIdentity = {
  id: string;
  email: string;
  name: string;
};

function getNameFromMetadata(metadata: Record<string, unknown>, email: string) {
  const name =
    typeof metadata.name === "string"
      ? metadata.name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : "";
  return name.trim() || email.split("@")[0] || "Cliente";
}

async function resolveOAuthIdentity(token: string, env: AppEnv): Promise<OAuthIdentity | null> {
  if (env.NODE_ENV === "test") {
    if (token === env.TEST_AUTH_ADMIN_TOKEN) {
      return { id: "test-admin-user", email: "admin@example.test", name: "Admin Teste" };
    }
    if (token === env.TEST_AUTH_CLIENT_TOKEN) {
      return { id: "test-client-user", email: "client@example.test", name: "Cliente Teste" };
    }
    if (token === env.TEST_AUTH_LAWYER_TOKEN) {
      return { id: "test-lawyer-user", email: "lawyer@example.test", name: "Dra. Teste" };
    }
    if (token.startsWith("test-oauth-client:")) {
      const [, id, email, ...nameParts] = token.split(":");
      if (!id || !email) return null;
      return { id, email, name: nameParts.join(":") || "Cliente Google" };
    }
    return null;
  }

  const supabase = createSupabaseAdminClient(env);
  if (!supabase) {
    throw new Error("OAUTH_SUPABASE_AUSENTE");
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id || !data.user.email) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email,
    name: getNameFromMetadata(data.user.user_metadata ?? {}, data.user.email)
  };
}

export async function registerAuthRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAuthenticated = createAuthPreHandler(env, repositories);

  app.post("/auth/signup-client", async (request, reply) => {
    const parsed = clientSignupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(422)
        .send(apiError("VALIDATION_ERROR", "Dados de cadastro invalidos.", parsed.error.issues));
    }

    const input = parsed.data;

    if (repositories.mode === "memory") {
      const profile = await repositories.profiles.createClientProfile({
        id: crypto.randomUUID(),
        name: input.name,
        email: input.email
      });
      return reply.code(201).send({
        user: {
          id: profile.id,
          email: profile.email,
          role: profile.role
        },
        persistence: repositories.mode
      });
    }

    const supabase = createSupabaseAdminClient(env);
    if (!supabase) {
      return reply
        .code(503)
        .send(apiError("UPSTREAM_ERROR", "Cadastro indisponivel sem credencial server-side."));
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        name: input.name,
        role: "client"
      }
    });

    if (error || !data.user) {
      return reply
        .code(422)
        .send(apiError("VALIDATION_ERROR", error?.message ?? "Nao foi possivel criar o usuario."));
    }

    try {
      const profile = await repositories.profiles.createClientProfile({
        id: data.user.id,
        name: input.name,
        email: input.email
      });
      return reply.code(201).send({
        user: {
          id: profile.id,
          email: profile.email,
          role: profile.role
        },
        persistence: repositories.mode
      });
    } catch (error) {
      await supabase.auth.admin.deleteUser(data.user.id);
      throw error;
    }
  });

  app.post("/auth/oauth-client/complete", async (request, reply) => {
    const token = extractBearerToken(request);
    if (!token) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Token Bearer obrigatorio."));
    }

    let identity: OAuthIdentity | null;
    try {
      identity = await resolveOAuthIdentity(token, env);
    } catch (error) {
      if (error instanceof Error && error.message === "OAUTH_SUPABASE_AUSENTE") {
        return reply.code(503).send(apiError("UPSTREAM_ERROR", "OAuth indisponivel sem credencial server-side."));
      }
      throw error;
    }

    if (!identity) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Token OAuth invalido."));
    }

    const existing = await repositories.profiles.getById(identity.id);
    if (existing) {
      if (existing.blockedAt) {
        return reply.code(403).send(apiError("FORBIDDEN", "Usuario bloqueado."));
      }
      return reply.code(200).send({
        user: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          role: existing.role,
          mustChangePassword: existing.mustChangePassword ?? false,
          firstLoginCompletedAt: existing.firstLoginCompletedAt ?? null
        },
        persistence: repositories.mode
      });
    }

    return reply
      .code(404)
      .send(apiError("PROFILE_NOT_FOUND", "Cadastro nao encontrado para este login Google."));
  });

  app.post("/auth/change-password", { preHandler: requireAuthenticated }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(422)
        .send(apiError("VALIDATION_ERROR", "Senha invalida.", parsed.error.issues));
    }

    if (repositories.mode !== "memory") {
      const supabase = createSupabaseAdminClient(env);
      if (!supabase) {
        return reply.code(503).send(apiError("UPSTREAM_ERROR", "Troca de senha indisponivel sem credencial server-side."));
      }

      const { error } = await supabase.auth.admin.updateUserById(request.currentUser!.id, {
        password: parsed.data.newPassword
      });
      if (error) {
        return reply.code(422).send(apiError("VALIDATION_ERROR", "Nao foi possivel atualizar a senha."));
      }
    }

    const profile = await repositories.profiles.markPasswordChanged(request.currentUser!.id);
    return reply.code(200).send({
      user: {
        id: request.currentUser!.id,
        name: profile?.name ?? request.currentUser!.name,
        email: request.currentUser!.email,
        role: request.currentUser!.role,
        mustChangePassword: profile?.mustChangePassword ?? false,
        firstLoginCompletedAt: profile?.firstLoginCompletedAt ?? null
      }
    });
  });

  app.get("/me", { preHandler: requireAuthenticated }, async (request) => {
    let profile =
      request.currentUser!.role === "lawyer" && !request.currentUser!.mustChangePassword
        ? await repositories.profiles.markFirstLoginCompleted(request.currentUser!.id)
        : await repositories.profiles.getById(request.currentUser!.id);

    return {
      user: {
        id: request.currentUser!.id,
        name: profile?.name ?? request.currentUser!.name,
        email: request.currentUser!.email,
        role: request.currentUser!.role,
        mustChangePassword: profile?.mustChangePassword ?? request.currentUser!.mustChangePassword ?? false,
        firstLoginCompletedAt: profile?.firstLoginCompletedAt ?? request.currentUser!.firstLoginCompletedAt ?? null
      }
    };
  });
}
