import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { changePasswordSchema, clientSignupSchema } from "../../contracts/api.js";
import { apiError } from "../../lib/httpError.js";
import { createSupabaseAdminClient } from "../../lib/supabase.js";
import type { Repositories } from "../../repositories/types.js";

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
