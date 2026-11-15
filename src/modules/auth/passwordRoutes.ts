import { createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isIP } from "node:net";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import type { Repositories } from "../../repositories/types.js";
import { createSupabaseAdminClient } from "../../lib/supabase.js";
import { apiError } from "../../lib/httpError.js";
import { createAuthMailer } from "./authMailer.js";

export const resetPasswordSchema = z.object({
  tokenHash: z.string().regex(/^[a-f0-9]{32,128}$/), type: z.literal("recovery"),
  newPassword: z.string().min(8).max(72), confirmPassword: z.string().min(8).max(72)
}).strict().refine(value => value.newPassword === value.confirmPassword);
const emailSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
const generic = { message: "Se existir uma conta para este e-mail, você receberá um link para definir sua senha." };

export function authRequestIp(request: Pick<FastifyRequest, "ip" | "headers">, env: AppEnv) {
  // Opt in only on DO App Platform, whose ingress overwrites this header.
  // Never enable this for a directly exposed Node server; X-Forwarded-For is
  // deliberately ignored. Verify header spoofing against the hosted ingress.
  const value = request.headers["do-connecting-ip"];
  return env.AUTH_IP_SOURCE === "digitalocean" && env.NODE_ENV === "production" && typeof value === "string" && isIP(value) ? value : request.ip;
}

// Single-instance bounded limiter. No raw email/IP retained. Replace with shared
// store before adding API replicas; do not trust arbitrary forwarded headers.
export function createAuthLimiter(now = Date.now) {
  const secret = randomBytes(32);
  const buckets = new Map<string, { start: number; last: number; count: number }>();
  return (value: string, max: number, cooldown = 0) => {
    const time = now();
    for (const [key, bucket] of buckets) if (time - bucket.start >= 900_000) buckets.delete(key);
    const key = createHmac("sha256", secret).update(value).digest("hex");
    const bucket = buckets.get(key);
    if (bucket && (bucket.count >= max || time - bucket.last < cooldown)) return false;
    if (!bucket && buckets.size >= 10_000) return false;
    buckets.set(key, { start: bucket?.start ?? time, last: time, count: (bucket?.count ?? 0) + 1 });
    return true;
  };
}

export async function registerPasswordRoutes(app: FastifyInstance, env: AppEnv, repositories: Repositories) {
  const allow = createAuthLimiter();
  const mailer = createAuthMailer(env);
  let pending = 0;
  app.post("/auth/password-recovery", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(apiError("VALIDATION_ERROR", "Informe um e-mail válido."));
    if (!allow(`request:${authRequestIp(request, env)}`, 5)) return reply.code(429).send(apiError("VALIDATION_ERROR", "Aguarde 15 minutos para tentar novamente."));
    if (pending >= 100 || (repositories.mode !== "memory" && (env.EMAIL_PROVEDOR !== "resend" || !env.RESEND_API_KEY))) {
      return reply.code(503).send(apiError("UPSTREAM_ERROR", "Recuperação temporariamente indisponível. Tente novamente."));
    }
    const email = parsed.data.email.toLowerCase();
    if (allow(`email:${email}`, 3, 60_000) && repositories.mode !== "memory") {
      // Response independent of account existence, provider latency and status.
      pending++;
      setImmediate(() => {
        void (async () => {
          const supabase = createSupabaseAdminClient(env);
          if (!supabase) throw new Error("AUTH_NOT_CONFIGURED");
          // recovery never creates a new identity (including existing Google users).
          const { data, error } = await supabase.auth.admin.generateLink({ type: "recovery", email });
          if (error || !data.properties?.hashed_token || !data.user) {
            if (error && error.code !== "user_not_found") app.log.warn({ event: "auth.recovery.unavailable" });
            return;
          }
          const profile = await repositories.profiles.getById(data.user.id);
          if (!profile || profile.blockedAt) return;
          const sent = await mailer.send(email, data.properties.hashed_token);
          app.log.info({ event: "auth.email.accepted", messageId: sent.messageId });
        })().catch(() => app.log.error({ event: "auth.recovery.failed" })).finally(() => { pending--; });
      });
    }
    return reply.code(202).send(generic);
  });

  app.post("/auth/password-reset", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!allow(`reset:${authRequestIp(request, env)}`, 10)) return reply.code(429).send(apiError("VALIDATION_ERROR", "Muitas tentativas. Aguarde 15 minutos."));
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send(apiError("VALIDATION_ERROR", "Confirme a mesma senha, com 8 a 72 caracteres."));
    const invalid = () => reply.code(401).send(apiError("UNAUTHORIZED", "Link inválido, expirado ou já utilizado. Solicite outro link."));
    if (repositories.mode === "memory") return invalid(); // Never simulate successful proof.
    const supabase = createSupabaseAdminClient(env);
    if (!supabase) return reply.code(503).send(apiError("UPSTREAM_ERROR", "Serviço temporariamente indisponível."));
    let verified;
    try {
      verified = await supabase.auth.verifyOtp({ token_hash: parsed.data.tokenHash, type: "recovery" });
    } catch {
      app.log.error({ event: "auth.password_reset.provider_unavailable" });
      return reply.code(503).send(apiError("UPSTREAM_ERROR", "Serviço temporariamente indisponível. Tente novamente."));
    }
    const { data, error } = verified;
    if (error || !data.user || !data.session) return invalid();
    try {
      const profile = await repositories.profiles.getById(data.user.id);
      if (!profile || profile.blockedAt) return invalid();
      const updated = await supabase.auth.admin.updateUserById(data.user.id, { password: parsed.data.newPassword });
      if (updated.error) return reply.code(422).send(apiError("VALIDATION_ERROR", "Senha recusada pela política de segurança. Solicite novo link e escolha outra senha."));
      await repositories.profiles.markPasswordChanged(data.user.id);
      return reply.code(200).send({ status: "password_updated" });
    } catch {
      app.log.error({ event: "auth.password_reset.reconcile_required" });
      return reply.code(503).send(apiError("UPSTREAM_ERROR", "Não foi possível concluir todas as etapas. Tente entrar com a nova senha ou solicite outro link."));
    } finally {
      // Supabase revokes refresh sessions; already-issued JWTs may live until exp.
      try {
        const result = await supabase.auth.admin.signOut(data.session.access_token, "global");
        if (result.error) app.log.error({ event: "auth.password_reset.revocation_failed" });
      } catch {
        app.log.error({ event: "auth.password_reset.revocation_failed" });
      }
    }
  });
}
