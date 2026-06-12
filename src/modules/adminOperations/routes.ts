import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import {
  adminImageUploadSchema,
  adminLawyerImageUploadSchema,
  adminPartnerLogoCreateSchema,
  adminPrayerRequestPatchSchema,
  adminUserPatchSchema
} from "../../contracts/api.js";
import { apiError } from "../../lib/httpError.js";
import type { Repositories } from "../../repositories/types.js";

const maxImageBytes = 2_000_000;
const DEFAULT_ADMIN_PAGE_SIZE = 100;
const prayerStatuses = new Set(["received", "read"]);

function parsePagination(query: unknown, defaultPageSize = DEFAULT_ADMIN_PAGE_SIZE) {
  const value = (query ?? {}) as { page?: string; pageSize?: string; search?: string; status?: string };
  if (!value.page && !value.pageSize && !value.search && !value.status) return null;
  const page = Math.max(1, Number.parseInt(value.page ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(value.pageSize ?? String(defaultPageSize), 10) || defaultPageSize));
  const search = value.search?.trim().slice(0, 80);
  const status = prayerStatuses.has(value.status ?? "") ? value.status : undefined;
  return { page, pageSize, ...(search ? { search } : {}), ...(status ? { status } : {}) };
}

function paginationMeta(input: { page: number; pageSize: number }, total: number) {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize))
  };
}

function decodedImageSize(base64Data: string) {
  return Buffer.from(base64Data, "base64").byteLength;
}

export async function registerAdminOperationRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const requireAdmin = createAuthPreHandler(env, repositories, ["admin"]);

  app.get("/partner-logos", async () => ({
    partners: await repositories.partnerLogos.listPublic(),
    persistence: repositories.mode
  }));

  app.get("/admin/prayer-requests", { preHandler: requireAdmin }, async (request) => {
    const page = parsePagination(request.query);
    if (!page) {
      return {
        requests: await repositories.prayerRequests.listAdmin(),
        page: 1,
        pageSize: 100,
        persistence: repositories.mode
      };
    }

    const result = await repositories.prayerRequests.listAdminPage(page);
    return {
      requests: result.items,
      pagination: paginationMeta(page, result.total),
      persistence: repositories.mode
    };
  });

  app.patch("/admin/prayer-requests/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = adminPrayerRequestPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Atualizacao de oracao invalida.", parsed.error.issues));
    }

    const prayerRequest = await repositories.prayerRequests.updateStatus(id, parsed.data.status);
    if (!prayerRequest) {
      return reply.code(404).send(apiError("NOT_FOUND", "Pedido de oracao nao encontrado."));
    }

    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: parsed.data.status === "read" ? "admin.prayer_requests.read" : "admin.prayer_requests.unread",
      entityType: "prayer_request",
      entityId: prayerRequest.id,
      metadata: { persistence: repositories.mode }
    });

    return { request: prayerRequest };
  });

  app.get("/admin/users", { preHandler: requireAdmin }, async (request) => {
    const page = parsePagination(request.query);
    if (!page) {
      return {
        users: await repositories.profiles.listAdminUsers(),
        page: 1,
        pageSize: 100,
        persistence: repositories.mode
      };
    }

    const result = await repositories.profiles.listAdminUsersPage(page);
    return {
      users: result.items,
      pagination: paginationMeta(page, result.total),
      persistence: repositories.mode
    };
  });

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

  app.get("/admin/partner-logos", { preHandler: requireAdmin }, async (request) => {
    const page = parsePagination(request.query);
    if (!page) {
      return {
        partners: await repositories.partnerLogos.listAdmin(),
        page: 1,
        pageSize: 100,
        persistence: repositories.mode
      };
    }

    const result = await repositories.partnerLogos.listAdminPage(page);
    return {
      partners: result.items,
      pagination: paginationMeta(page, result.total),
      persistence: repositories.mode
    };
  });

  app.post("/admin/partner-logo-media", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = adminImageUploadSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.kind !== "partnerLogo") {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Logo invalida.", parsed.success ? [] : parsed.error.issues));
    }

    if (decodedImageSize(parsed.data.base64Data) > maxImageBytes) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Logo deve ter no maximo 2MB."));
    }

    const image = await repositories.partnerLogos.uploadLogo(parsed.data);
    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.partner_logo_media.upload",
      entityType: "partner_logo_media",
      metadata: {
        persistence: repositories.mode,
        contentType: image.contentType
      }
    });

    return reply.code(201).send({ image, persistence: repositories.mode });
  });

  app.post("/admin/partner-logos", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = adminPartnerLogoCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send(apiError("VALIDATION_ERROR", "Parceiro invalido.", parsed.error.issues));
    }

    const partner = await repositories.partnerLogos.create(parsed.data);
    await repositories.auditLogs.record({
      actorProfileId: request.currentUser?.id,
      action: "admin.partner_logos.create",
      entityType: "partner_logo",
      entityId: partner.id,
      metadata: { persistence: repositories.mode, active: partner.active }
    });

    return reply.code(201).send({ partner, persistence: repositories.mode });
  });
}
