# Backend API Contracts - Meu Advogado 2.0

**Estado:** auth/roles versionado em `openapi.yaml`  
**Versao:** `/v1`

## Public/Health

- `GET /health`

## Auth/Profile

- `GET /v1/me` - implementado na spec 006 para validar identidade/role sem expor campos sensiveis
- `PATCH /v1/me`

## Cliente

- `GET /v1/areas`
- `POST /v1/match` - exige Bearer token (`client` ou `admin`); ver contrato abaixo
- `GET /v1/lawyers/:id` - implementado na spec 004; exige Bearer token (`client` ou `admin`)
- `POST /v1/lawyers/:id/events`
- `POST /v1/lawyers/:id/urgent-calls`

## Advogado

- `GET /v1/lawyer/dashboard`
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
- `GET /v1/admin/urgent-calls`
- `PATCH /v1/admin/urgent-calls/:id`
- `CRUD /v1/admin/benefits`
- `CRUD /v1/admin/partners`

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

## Observacao Da Fundacao

`POST /v1/match` agora retorna match real geoespacial (PostGIS) via repositorio, com `matched`/`empty` e auth de cliente. Rotas admin de advogados passam por auth/role e usam repositorios. Supabase real depende de env segura + aplicacao manual de `0002_match_nearest.sql` e seed `001_match_fixtures.sql`.

## Spec 006 - Login Admin

O painel admin deve validar sessao/role por contrato backend seguro, preferencialmente
`GET /v1/me`, retornando no maximo `id`, `email` e `role`. Rotas admin operacionais
continuam exigindo Bearer token com role `admin`. Nenhuma service role, token completo,
senha ou payload sensivel deve ser exposto ao admin, logs, docs ou harness.
