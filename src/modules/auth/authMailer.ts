import { randomUUID } from "node:crypto";
import type { AppEnv } from "../../config/env.js";

export function createAuthMailer(env: AppEnv, fetchImpl: typeof fetch = fetch) {
  return {
    async send(email: string, tokenHash: string): Promise<{ status: "accepted"; messageId: string }> {
      if (env.EMAIL_PROVEDOR !== "resend" || !env.RESEND_API_KEY || !/^re_/.test(env.RESEND_API_KEY)) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
      const url = new URL(env.AUTH_PASSWORD_REDIRECT_URL);
      // Fixed config only; fragment stays out of web server access logs/referrers.
      url.hash = new URLSearchParams({ token_hash: tokenHash, type: "recovery" }).toString();
      const link = url.toString();
      const text = `Advogado 2.0\n\nDefina uma nova senha para sua conta ou conclua seu primeiro acesso.\n\n${link}\n\nEste link é pessoal, de uso único e expira conforme a política de segurança da conta. Se expirou, solicite outro no aplicativo. Sua senha só muda após confirmar o formulário. Se não solicitou, ignore esta mensagem.\nSuporte: suporte@advogado20.com.br`;
      const body = JSON.stringify({ from: env.AUTH_EMAIL_FROM, reply_to: "suporte@advogado20.com.br", to: [email], subject: "Advogado 2.0 — Defina sua senha", text, html: `<main lang="pt-BR"><h1>Advogado 2.0</h1><h2>Defina sua senha</h2><p>Recupere sua conta ou conclua seu primeiro acesso com segurança.</p><p><a href="${link.replace(/&/g, "&amp;")}">Definir nova senha</a></p><p>Link pessoal, de uso único. A validade segue a política de segurança da conta. Se expirou, peça outro no aplicativo. A senha só muda após confirmar o formulário.</p><p>Se não solicitou, ignore este e-mail.</p><p>Suporte: suporte@advogado20.com.br</p></main>` });
      const attempt = randomUUID();
      for (let retry = 0; retry < 2; retry++) {
        try {
          const response = await fetchImpl("https://api.resend.com/emails", {
            method: "POST", signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": attempt }, body
          });
          if (response.ok) {
            const result = await response.json() as { id?: string };
            if (result.id) return { status: "accepted", messageId: result.id };
          }
          if (response.status < 500 && response.status !== 429) break;
        } catch { /* Retry once with identical payload/key; never log upstream body. */ }
      }
      throw new Error("AUTH_EMAIL_FAILED");
    }
  };
}
