import { readFileSync } from "node:fs";

const bannerId = "advogado20-email-banner";
let bannerContent: string | undefined;

export function authEmailBanner() {
  // Same root-relative path from src/ and dist/. Assets ship with the repository.
  bannerContent ??= readFileSync(new URL("../../../assets/email/advogado20-email-compacto-1200x240.png", import.meta.url)).toString("base64");
  return { filename: "advogado20-banner.png", content: bannerContent, content_type: "image/png", content_id: bannerId };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function renderAuthEmail(link: string, requestNotice: string) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Advogado 2.0 — Defina sua senha</title></head>
<body style="margin:0;padding:0;background-color:#f1f3f6;color:#071426;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff">
<tr><td style="background-color:#071426"><img src="cid:${bannerId}" width="600" height="120" alt="Advogado 2.0 — Conectando pessoas. Aproximando soluções." style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#ffffff;font-size:16px"></td></tr>
<tr><td style="padding:28px 24px 32px"><main>
<h1 style="margin:0 0 16px;font-size:26px;line-height:1.3;color:#071426">Defina sua senha</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6">Recupere sua conta ou conclua seu primeiro acesso com segurança.</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#465468">${escapeHtml(requestNotice)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#D99A2D" style="border-radius:6px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:15px 24px;border:1px solid #D99A2D;border-radius:6px;color:#071426;font-size:16px;font-weight:bold;text-decoration:none;line-height:1.4">Definir nova senha</a></td></tr></table>
<p style="margin:24px 0 16px;font-size:14px;line-height:1.6;color:#465468">Link pessoal, de uso único. A validade segue a política de segurança da conta. Se expirou, peça outro no aplicativo. A senha só muda após confirmar o formulário.</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#465468">Se não solicitou, ignore este e-mail.</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#465468">Suporte: <a href="mailto:suporte@advogado20.com.br" style="color:#071426">suporte@advogado20.com.br</a></p>
</main></td></tr></table></td></tr></table></body></html>`;
}
