# Backend Security And Privacy - Meu Advogado 2.0

## Principios

- Backend e autoridade de autorizacao.
- RLS e camada adicional.
- Service role nunca sai do backend.
- Logs sem PII sensivel.

## PII

Dados sensiveis:

- Nome.
- Email.
- Telefone/WhatsApp.
- Localizacao do cliente.
- Endereco do advogado.
- Urgencias.

## Controles

- Validar JWT.
- Checar role por rota.
- Rate limit em match, eventos e urgencias.
- Idempotencia em urgencia.
- Audit log para acoes admin.
- Sanitizar mensagens de erro.

## LGPD

- Minimizar persistencia de localizacao do cliente.
- Permitir exclusao/anonimizacao conforme politica.
- Separar dados operacionais de logs.
- Spec 007 implementa expurgo integral de `match_events` antigos apos 90 dias no MVP via comando backend. Dry-run nao altera dados; apply destrutivo exige confirmacao explicita e deve rodar somente em ambiente aprovado.

## Smoke De Seguranca

- Sem token: `401`.
- Role errada: `403`.
- Payload invalido: `422`.
- Logs nao exibem token nem payload sensivel.

## Ressalva Da Fundacao

As rotas admin agora exigem Bearer token e role `admin`. A service role key deve existir apenas no backend/Railway e nunca em mobile/admin.

## Spec 006 - Sessao Admin

`GET /v1/me` retorna somente `id`, `email` e `role` do usuario autenticado. O painel admin usa esse contrato para validar role antes de liberar a operacao. Senha nao passa pelo backend neste fluxo; o login usa Supabase Auth REST com anon key publica no admin e todas as regras de negocio continuam protegidas pelo backend.

## Spec 008 Parte 2 - Perfil Visual Publico

`GET /v1/lawyers/:id` pode retornar `avatarUrl`, `coverUrl`, `miniBio` e `fullBio`
somente pela allowlist publica. URLs de imagem aceitam apenas HTTPS; URL ausente,
invalida ou insegura vira `null`/fallback. O contrato continua sem CEP, endereco
completo, coordenada exata, email interno, status administrativo ou auditoria.

## Spec 008 Parte 3 - Dashboard E Oracao

`GET /v1/lawyer/me/dashboard` exige role `lawyer` e retorna apenas perfil profissional
seguro, metricas zeradas e beneficios estaticos. `POST /v1/prayer-requests` exige role
`client`, valida texto de 20 a 500 caracteres e aplica rate limit. O texto livre pode
conter dado sensivel espontaneo, portanto nao deve aparecer em logs, audit metadata,
harness, screenshots ou relatorios. A resposta registra somente id/status/data.
`prayer_requests` segue retencao operacional MVP de 90 dias via
`npm run retention:prayer-requests`, com dry-run padrao e apply destrutivo bloqueado por
`PRAYER_REQUESTS_RETENTION_CONFIRMATION=APPLY_PRAYER_REQUESTS_RETENTION`. O `prod:smoke`
deve limpar os pedidos neutros criados no teste.

## Migration Controlada

`npm run migration:check` valida a migration sem aplicar remotamente, mesmo se a env tiver flags de aplicacao. Aplicacao remota so e tentada com `npm run migration:apply`, `APPLY_REMOTE_MIGRATIONS=true`, `SUPABASE_DB_URL` configurado e `MIGRATION_CONFIRMATION=APPLY_MEU_ADVOGADO_20_FOUNDATION`.

## Env

O backend pode ler `.env` da raiz do workspace e `.env` local do backend. A anon key e publica, mas a service role key e segredo critico e nunca deve ser exibida em logs, enviada ao mobile/admin ou commitada.
