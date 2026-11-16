# Banners oficiais de e-mail

Artes aprovadas pelo usuário em 2026-11-15. PNGs oficiais copiados sem alteração de `output/email-banners-2026-11-15/` na raiz geral.

- Compacto 1200 × 240 px (148.711 bytes): cabeçalho de recuperação, primeiro acesso e convites/reenvios pelo AuthMailer compartilhado. Exibição 600 × 120 px com redução responsiva.
- Principal 1200 × 360 px (218.289 bytes): preservado para futuras comunicações institucionais; não enviado pelos fluxos Auth atuais.

A imagem compacta é enviada como anexo inline CID pela Resend, sem hospedagem pública ou requisição externa do cliente. O HTML contém texto alternativo e usa tabelas e estilos inline. Botão, referência, validade e instruções permanecem texto no corpo; a versão plain text continua disponível. O suporte de cada cliente a imagens inline pode variar.

O diretório `assets/email/` precisa acompanhar `dist/` na distribuição. Não há etapa de cópia no build: o runtime resolve os arquivos em relação ao módulo, tanto em src/ quanto em dist/, sem depender de cwd. Não distribuir somente dist/.

Referência do provedor: https://resend.com/changelog/embed-images-using-cid

Rollback: reverter o commit de integração; não há migrations nem alterações de configuração.
