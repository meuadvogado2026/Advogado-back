import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { adminLawyerImageUploadSchema, adminUserPatchSchema } from "../../contracts/api.js";
import { apiError } from "../../lib/httpError.js";
import type { Repositories } from "../../repositories/types.js";

const maxImageBytes = 2_000_000;

function decodedImageSize(base64Data: string) {
  return Buffer.from(base64Data, "base64").byteLength;
}

export async function registerAdminOperationRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAdmin = createAuthPreHandler(env, repositories, ["admin"]);

  app.get("/admin/prayer-requests", { preHandler: requireAdmin }, async () => ({
    requests: await repositories.prayerRequests.listAdmin(),
    page: 1,
    pageSize: 100,
    persistence: repositories.mode
  }));

  app.get("/admin/users", { preHandler: requireAdmin }, async () => ({
    users: await repositories.profiles.listAdminUsers(),
    page: 1,
    pageSize: 100,
    persistence: repositories.mode
  }));

  app.patch("/admin/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminUserPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Atualizacao de usuario invalida.", parsed.error.issues));
    }

    if (id === request.currentUser?.id && parsed.data.blocked) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Admin nao pode bloquear a propria sessao."));
    }

    const user = await repositories.profiles.updateBlocked(id, parsed.data.blocked);
    if (!user) {
      return reply.code(404).send(apiError("NOT_FOUND", "Usuario nao encontrado."));
    }

    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: parsed.data.blocked ? "admin.users.block" : "admin.users.unblock",
      entityType: "profile",
      entityId: user.id,
      metadata: { persistence: repositories.mode, targetRole: user.role }
    });

    return { user };
  });

  app.post("/admin/lawyer-media", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = adminLawyerImageUploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Imagem invalida.", parsed.error.issues));
    }

    if (decodedImageSize(parsed.data.base64Data) > maxImageBytes) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Imagem deve ter no maximo 2MB."));
    }

    const image = await repositories.lawyerMedia.uploadImage(parsed.data);
    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.lawyer_media.upload",
      entityType: "lawyer_media",
      metadata: {
        persistence: repositories.mode,
        kind: parsed.data.kind,
        contentType: image.contentType
      }
    });

    return reply.code(201).send({ image, persistence: repositories.mode });
  });
}
