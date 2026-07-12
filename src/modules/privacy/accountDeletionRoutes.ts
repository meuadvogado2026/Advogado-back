import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "../../auth/authMiddleware.js";
import type { AppEnv } from "../../config/env.js";
import { apiError } from "../../lib/httpError.js";
import { createSupabaseAdminClient } from "../../lib/supabase.js";
import type { Repositories } from "../../repositories/types.js";

type DeletionRequest = { id: string; profileId: string; name: string; email: string; role: string; status: "requested" | "in_review" | "completed"; requestedAt: string; dueAt: string; completedAt: string | null; priority: "normal" | "warning" | "overdue" };
const memoryRequests: DeletionRequest[] = [];
const priorityFor = (requestedAt: string, dueAt: string) => {
  const now = Date.now();
  if (now >= Date.parse(dueAt)) return "overdue" as const;
  return now >= Date.parse(requestedAt) + 10 * 86400000 ? "warning" as const : "normal" as const;
};

export async function registerAccountDeletionRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const authenticated = createAuthPreHandler(env, repositories);
  const admin = createAuthPreHandler(env, repositories, ["admin"]);
  app.post("/account-deletion-requests", { preHandler: authenticated }, async (request, reply) => {
    const current = request.currentUser!;
    const requestedAt = new Date().toISOString(); const dueAt = new Date(Date.now() + 15 * 86400000).toISOString();
    if (repositories.mode === "memory") {
      const existing = memoryRequests.find((item) => item.profileId === current.id && item.status !== "completed");
      if (existing) return reply.code(200).send({ request: existing });
      const item: DeletionRequest = { id: crypto.randomUUID(), profileId: current.id, name: current.name ?? "Usuário", email: current.email ?? "", role: current.role, status: "requested", requestedAt, dueAt, completedAt: null, priority: "normal" };
      memoryRequests.push(item); return reply.code(201).send({ request: item });
    }
    const supabase = createSupabaseAdminClient(env); if (!supabase) return reply.code(503).send(apiError("UPSTREAM_ERROR", "Exclusão indisponível."));
    const { data: existing, error: existingError } = await supabase.from("account_deletion_requests").select("*").eq("profile_id", current.id).neq("status", "completed").maybeSingle();
    if (existingError) throw existingError;
    const row = existing ?? (await supabase.from("account_deletion_requests").insert({ profile_id: current.id, requester_name: current.name ?? "Usuário", requester_email: current.email, requester_role: current.role, due_at: dueAt }).select("*").single()).data;
    if (!row) throw new Error("account_deletion_requests.create failed");
    return reply.code(existing ? 200 : 201).send({ request: { id: row.id, requestedAt: row.requested_at, dueAt: row.due_at, status: row.status, priority: priorityFor(row.requested_at, row.due_at) } });
  });
  app.get("/admin/account-deletion-requests", { preHandler: admin }, async () => {
    if (repositories.mode === "memory") return { requests: memoryRequests.map((item) => ({ ...item, priority: priorityFor(item.requestedAt, item.dueAt) })) };
    const supabase = createSupabaseAdminClient(env)!; const { data, error } = await supabase.from("account_deletion_requests").select("*").order("requested_at", { ascending: false }); if (error) throw error;
    return { requests: (data ?? []).map((row: any) => ({ id: row.id, profileId: row.profile_id, name: row.requester_name, email: row.requester_email, role: row.requester_role, status: row.status, requestedAt: row.requested_at, dueAt: row.due_at, completedAt: row.completed_at, priority: priorityFor(row.requested_at, row.due_at) })) };
  });
  app.patch("/admin/account-deletion-requests/:id", { preHandler: admin }, async (request, reply) => {
    const { id } = request.params as { id: string }; const status = (request.body as { status?: string } | undefined)?.status;
    if (status !== "in_review" && status !== "completed") return reply.code(422).send(apiError("VALIDATION_ERROR", "Status de exclusao invalido."));
    if (repositories.mode === "memory") {
      const item = memoryRequests.find((candidate) => candidate.id === id); if (!item) return reply.code(404).send(apiError("NOT_FOUND", "Solicitacao nao encontrada."));
      item.status = status; item.completedAt = status === "completed" ? new Date().toISOString() : null;
      return { request: { ...item, priority: priorityFor(item.requestedAt, item.dueAt) } };
    }
    const supabase = createSupabaseAdminClient(env)!;
    const { data, error } = await supabase.from("account_deletion_requests").update({ status, completed_at: status === "completed" ? new Date().toISOString() : null, completed_by_profile_id: status === "completed" ? request.currentUser!.id : null }).eq("id", id).select("*").maybeSingle();
    if (error) throw error; if (!data) return reply.code(404).send(apiError("NOT_FOUND", "Solicitacao nao encontrada."));
    return { request: { id: data.id, profileId: data.profile_id, name: data.requester_name, email: data.requester_email, role: data.requester_role, status: data.status, requestedAt: data.requested_at, dueAt: data.due_at, completedAt: data.completed_at, priority: priorityFor(data.requested_at, data.due_at) } };
  });
}
