# Backend API Contracts - Meu Advogado 2.0

**Estado:** auth/roles versionado em `openapi.yaml`  
**Versao:** `/v1`

## Public/Health

- `GET /health`

## Auth/Profile

- `GET /v1/me`
- `PATCH /v1/me`

## Cliente

- `GET /v1/areas`
- `POST /v1/match` - exige Bearer token (`client` ou `admin`); ver contrato abaixo
- `GET /v1/lawyers/:id`
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

## Observacao Da Fundacao

`POST /v1/match` agora retorna match real geoespacial (PostGIS) via repositorio, com `matched`/`empty` e auth de cliente. Rotas admin de advogados passam por auth/role e usam repositorios. Supabase real depende de env segura + aplicacao manual de `0002_match_nearest.sql` e seed `001_match_fixtures.sql`.
