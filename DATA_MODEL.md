# Backend Data Model - Meu Advogado 2.0

**Banco:** Supabase Postgres novo  
**Estado:** draft versionado em migration inicial

## Extensoes Recomendadas

- `uuid-ossp` ou `pgcrypto`.
- `postgis` para distancia e indice geografico.

## Entidades

### `profiles`

- `id`
- `role`: `client`, `lawyer`, `admin`
- `name`
- `email`
- `phone`
- `avatar_url`
- `cover_url`
- `created_at`
- `updated_at`

### `lawyer_profiles`

- `id`
- `profile_id`
- `status`
- `oab_number`
- `oab_state`
- `whatsapp`
- `mini_bio`
- `full_bio`
- `office_cep`
- `office_street`
- `office_number`
- `office_neighborhood`
- `office_city`
- `office_state`
- `office_lat`
- `office_lng`
- `office_location`
- `created_at`
- `updated_at`

### Auxiliares

- `legal_specialties`
- `lawyer_specialties`
- `match_events`
- `lawyer_events`
- `urgent_calls`
- `benefits`
- `partners`
- `audit_logs`

## Seeds Minimos

- Admin inicial.
- Areas juridicas.
- Advogados fake para smoke.
- Beneficios/parceiros fake.

## Regras

- Advogado sem coordenada valida nao entra no match.
- Apenas `approved` entra no match.
- Urgencia deve ter idempotencia.

## Migration Inicial

Arquivo: `src/db/migrations/0001_foundation_postgis.sql`.

Status: rascunho versionado, nao aplicado remotamente por ausencia de credenciais/confirmacao operacional.

## Revisao Do Ciclo Auth/Supabase

- Enums `profile_role` e `lawyer_status` agora sao criados de forma idempotente com `DO $$`.
- `legal_specialties` recebe seed seguro de areas juridicas com `on conflict`.
- `lawyer_profiles.office_location` usa `geography(Point, 4326)` e indice GiST.
- Aplicacao remota e bloqueada por padrao pelo script `npm run migration:check`.
