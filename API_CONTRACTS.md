# Backend API Contracts - Meu Advogado 2.0

**Estado:** auth/roles versionado em `openapi.yaml`  
**Versao:** `/v1`

## Public/Health

- `GET /health`

## Auth/Profile

- `POST /v1/auth/signup-client` - cadastro publico de cliente; cria Supabase Auth + `profiles.role=client` no backend
- `GET /v1/me` - implementado na spec 006 para validar identidade/role sem expor campos sensiveis
- `PATCH /v1/me`

## Cliente

- `GET /v1/areas`
- `POST /v1/match` - exige Bearer token (`client` ou `admin`); ver contrato abaixo
- `GET /v1/lawyers/:id` - implementado na spec 004; exige Bearer token (`client` ou `admin`)
- `GET /v1/partner-logos` - lista publica segura de logos ativas para rodape futuro do mobile
- `POST /v1/prayer-requests` - implementado na spec 008 Parte 3; exige Bearer token `client`
- `POST /v1/lawyers/:id/events`
- `POST /v1/lawyers/:id/urgent-calls`

## Advogado

- `GET /v1/lawyer/me/dashboard` - implementado na spec 008 Parte 3; exige Bearer token `lawyer`
- `GET /v1/lawyer/vip-card`
- `GET /v1/lawyer/benefits`

## Admin

- `GET /v1/admin/dashboard`
- `GET /v1/admin/lawyers` - exige Bearer token com role `admin`
- `POST /v1/admin/lawyers` - exige Bearer token com role `admin`
- `GET /v1/admin/lawyers/:id`
- `PATCH /v1/admin/lawyers/:id` - exige Bearer token com role `admin`
- `PATCH /v1/admin/lawyers/:id/status`
- `POST /v1/admin/geocode/cep`
- `POST /v1/admin/lawyer-media` - upload server-side de foto/capa do advogado
- `GET /v1/admin/prayer-requests` - leitura operacional dos pedidos de oracao
- `PATCH /v1/admin/prayer-requests/:id` - marca pedido como `read`/`received`
- `GET /v1/admin/partner-logos` - listagem operacional de logos de parceiros
- `POST /v1/admin/partner-logo-media` - upload server-side de logo de parceiro
- `POST /v1/admin/partner-logos` - cadastro de parceiro com logo HTTPS
- `GET /v1/admin/users` - listagem segura de usuarios cadastrados
- `PATCH /v1/admin/users/:id` - bloqueio/desbloqueio de usuario
- `GET /v1/admin/urgent-calls`
- `PATCH /v1/admin/urgent-calls/:id`
- `CRUD /v1/admin/benefits`
- `CRUD /v1/admin/partners`

## GET /v1/admin/lawyers (spec 009)

Requer `Authorization: Bearer <token>` com role `admin`. Retorna lista operacional
segura para o painel administrativo, sem CEP completo, coordenada exata, token, senha
ou payload sensivel.

Resposta `200`:

```json
{
  "lawyers": [
    {
      "id": "...",
      "name": "...",
      "email": "...",
      "oab": "123456/SP",
      "status": "pending",
      "officeCity": "Sao Paulo",
      "officeState": "SP",
      "mainAreaId": "...",
      "secondaryAreaIds": ["..."],
      "createdAt": "2026-06-03T00:00:00Z"
    }
  ]
}
```

Em modo Supabase, o repositorio hidrata `name`, `email`, imagens seguras e areas a
partir de `profiles` e `lawyer_specialties`; `POST /v1/admin/lawyers` persiste area
principal/secundarias em `lawyer_specialties`. A regra de aprovacao continua bloqueando
`approved` sem coordenada valida.

`PATCH /v1/admin/lawyers/:id` aceita os mesmos campos do cadastro de advogado para
edicao operacional. Quando `officeCep` e enviado, a rota reconsulta o CEP, persiste
`officeCity`/`officeState` e atualiza coordenada/PostGIS quando houver geocoding
valido. Nome, email, WhatsApp, foto e capa sao atualizados em `profiles`; OAB, bio,
status, endereco e especialidades permanecem em `lawyer_profiles`/`lawyer_specialties`.

## Admin operacional - midia, oracoes e usuarios

`POST /v1/admin/lawyer-media` requer role `admin` e recebe:

```json
{ "kind": "avatar", "fileName": "perfil.png", "mimeType": "image/png", "base64Data": "..." }
```

Aceita apenas `image/jpeg`, `image/png` e `image/webp`; rejeita arquivos acima de
2MB e armazena por repository backend, sem acesso direto do admin ao Supabase.

`GET /v1/admin/prayer-requests` retorna os ultimos pedidos para operacao admin:

```json
{ "requests": [{ "id": "...", "message": "...", "anonymous": true, "status": "received", "createdAt": "...", "readAt": null }] }
```

`PATCH /v1/admin/prayer-requests/:id` recebe `{ "status": "read" }` ou
`{ "status": "received" }`. Ao marcar como lida, `readAt` e preenchido. O texto segue
visivel apenas para admin autenticado e nao e ecoado na rota publica de envio.

`POST /v1/admin/partner-logo-media` recebe `{ "kind": "partnerLogo", "fileName": "...", "mimeType": "image/png", "base64Data": "..." }`,
aceita JPG/PNG/WebP ate 2MB e retorna URL publica segura. `POST /v1/admin/partner-logos`
salva `{ "name": "...", "logoUrl": "https://...", "websiteUrl": null, "active": true }`.
`GET /v1/partner-logos` retorna somente parceiros ativos para consumo futuro no mobile.

`GET /v1/admin/users` retorna usuarios cadastrados com identidade operacional,
role, telefone opcional, status de bloqueio e vinculo de advogado quando existir.
`PATCH /v1/admin/users/:id` recebe `{ "blocked": true }` ou `{ "blocked": false }`.
Usuario bloqueado nao passa na autenticacao real (`GET /v1/me` e rotas autenticadas
respondem `403`). A propria sessao admin nao pode se bloquear.

## POST /v1/auth/signup-client

Rota publica para cadastro de cliente. O backend cria o usuario no Supabase Auth com
credencial server-side e cria o profile de dominio com `role=client`. Advogado segue
cadastrado somente pelo admin.

Request:

```json
{ "name": "Cliente Nome", "email": "cliente@example.com", "password": "senha-segura" }
```

Resposta `201`:

```json
{ "user": { "id": "...", "email": "cliente@example.com", "role": "client" }, "persistence": "supabase" }
```

A resposta nunca retorna senha, token, refresh token ou service role. Payload invalido
responde `422`; sem service role no backend Supabase responde `503`.

## POST /v1/match (match real geoespacial)

Requer `Authorization: Bearer <token>` (`client` ou `admin`). Sem token -> `401`.

Request:

```json
{ "lat": -23.55052, "lng": -46.633308, "accuracyM": 25, "areaIds": ["<area-id>"] }
```

- `lat`/`lng`: coordenada do cliente. `accuracyM`: precisao em metros (>0, <=5000).
- `areaIds`: ao menos uma area juridica. Payload invalido -> `422`.

Resposta `matched` (`200`):

```json
{
  "status": "matched",
  "lawyer": { "id": "...", "name": "...", "whatsapp": "...", "city": "...", "state": "...", "areaIds": ["..."] },
  "distanceKm": 2.6,
  "algorithmVersion": "geo-nearest-v1"
}
```

Resposta `empty` (`200`) quando nao ha advogado aprovado, compativel e dentro do raio:

```json
{ "status": "empty", "lawyer": null, "algorithmVersion": "geo-nearest-v1" }
```

Regras:

- Elegivel: advogado `approved`, com `office_location` e area compativel.
- Ordenado por distancia (PostGIS `ST_Distance`); raio maximo via `MATCH_MAX_RADIUS_KM` (default 200km).
- `lawyer` expoe apenas campos seguros; nunca CEP/endereco completo nem PII interna.
- Evento gravado em `match_events`; coordenada vai para o banco, nunca para logs.
- Spec 007 implementa a politica alvo de retencao: expurgo integral de eventos antigos apos 90 dias no MVP via `npm run retention:match-events`, com dry-run padrao e apply bloqueado por confirmacao explicita.

## GET /v1/lawyers/:id (spec 004, ampliado na spec 008 Parte 2)

Requer `Authorization: Bearer <token>` (`client` ou `admin`). Retorna somente advogado
aprovado para cliente e responde `404` seguro quando o perfil nao existe ou nao esta
disponivel.

Resposta `200`:

```json
{
  "lawyer": {
    "id": "...",
    "name": "...",
    "oabNumber": "...",
    "oabState": "DF",
    "city": "Brasilia",
    "state": "DF",
    "areaIds": ["..."],
    "areas": [{ "id": "...", "name": "Direito Civil" }],
    "whatsapp": "...",
    "verified": true,
    "avatarUrl": "https://cdn.example.com/avatar.jpg",
    "coverUrl": "https://cdn.example.com/capa.jpg",
    "miniBio": "Atendimento consultivo em direito civil.",
    "fullBio": "Texto publico do perfil profissional.",
    "yearsExperience": null,
    "planLabel": null,
    "emergencyAvailable": false
  }
}
```

Campos visuais sao opcionais/aditivos. `avatarUrl` e `coverUrl` aceitam apenas HTTPS;
valor ausente, inseguro ou invalido deve virar `null`/fallback. Nao expor CEP, endereco
completo, coordenada, `office_location`, email, auditoria ou status interno. A distancia
nao pertence a esta resposta: quando houver match, segue como contexto efemero da
navegacao mobile.

## Padrao De Erro

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Mensagem segura",
    "details": []
  }
}
```

## GET /v1/me (spec 006)

Requer `Authorization: Bearer <token>`. Retorna somente identidade minima e role:

```json
{
  "user": {
    "id": "...",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

Sem token -> `401`; token invalido -> `401`; perfil sem role autorizada -> `403`.
Nao retorna token, service role, dados de perfil completos ou payload sensivel.

## GET /v1/lawyer/me/dashboard (spec 008 Parte 3)

Requer `Authorization: Bearer <token>` com role `lawyer`. Cliente recebe `403`.

Resposta `200`:

```json
{
  "lawyer": {
    "id": "...",
    "name": "Dra. Nome",
    "oabNumber": "123456",
    "oabState": "SP",
    "avatarUrl": null,
    "coverUrl": null,
    "planLabel": "MVP interno",
    "verified": true
  },
  "metrics": { "profileViews": 0, "whatsappClicks": 0, "contacts": 0 },
  "benefits": [{ "id": "verified-profile", "title": "Perfil verificado", "description": "..." }]
}
```

Metricas sao zeradas/placeholder seguro no MVP. Beneficios sao estaticos, sem pagamento,
parceiro externo, cupom real, chat ou agenda.

## POST /v1/prayer-requests (spec 008 Parte 3)

Requer `Authorization: Bearer <token>` com role `client`. Advogado/admin recebem `403`.
Endpoint possui rate limit proporcional.

Request:

```json
{ "message": "Texto entre 20 e 500 caracteres", "anonymous": true }
```

Resposta `201`:

```json
{ "request": { "id": "...", "status": "received", "createdAt": "2026-06-03T00:00:00Z" } }
```

Regras: `anonymous=true` persiste `client_profile_id = null`; `anonymous=false` persiste
somente o profile id autenticado. A resposta nao ecoa o texto. Logs, harness e docs nao
devem registrar texto do pedido, token, telefone completo, coordenada ou payload sensivel.
Retencao operacional MVP: expurgo integral de `prayer_requests` antigos apos 90 dias via
`npm run retention:prayer-requests`, com dry-run padrao e apply bloqueado por confirmacao
explicita. O smoke de producao usa texto neutro e limpa os pedidos criados no proprio
teste.

## Observacao Da Fundacao

`POST /v1/match` agora retorna match real geoespacial (PostGIS) via repositorio, com `matched`/`empty` e auth de cliente. Rotas admin de advogados passam por auth/role e usam repositorios. Supabase real depende de env segura + aplicacao manual de `0002_match_nearest.sql` e seed `001_match_fixtures.sql`.

## Spec 006 - Login Admin

O painel admin deve validar sessao/role por contrato backend seguro, preferencialmente
`GET /v1/me`, retornando no maximo `id`, `email` e `role`. Rotas admin operacionais
continuam exigindo Bearer token com role `admin`. Nenhuma service role, token completo,
senha ou payload sensivel deve ser exposto ao admin, logs, docs ou harness.
