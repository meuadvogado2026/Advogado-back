# Backend Data Model - Meu Advogado 2.0

**Banco:** Supabase Postgres novo  
**Estado:** migrations versionadas / spec 007 LGPD implementada com ressalvas

## Spec 012

- `states` e `cities`, com centroide PostGIS e `unique(state_id, normalized_name)`.
- `lawyer_profiles.service_city_id` nullable e FK `on delete restrict`.
- `lawyer_profiles.available_for_matches` default `true`, aplicado aos dois matches.
- Migration aditiva: `src/db/migrations/0011_geographic_catalog_city_match.sql`.

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
- `prayer_requests`
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
- `match_events.client_location` guarda coordenada precisa do cliente para o match atual e deve seguir politica de retencao LGPD da spec 007.
- Recomendacao MVP da spec 007: expurgo integral de eventos antigos apos 90 dias via `npm run retention:match-events`; dry-run validado, apply remoto ainda nao executado.
- `prayer_requests` e tabela aditiva da spec 008 Parte 3. `anonymous=true` guarda `client_profile_id = null`; `anonymous=false` guarda somente o profile id autenticado. O texto nao deve ir para logs, audit metadata, harness ou screenshots. Retencao MVP: expurgo integral apos 90 dias via `npm run retention:prayer-requests`, dry-run por padrao e apply destrutivo com confirmacao explicita.

## Migration Inicial

Arquivo: `src/db/migrations/0001_foundation_postgis.sql`.

Status: rascunho versionado, nao aplicado remotamente por ausencia de credenciais/confirmacao operacional.

## Migration Spec 008 Parte 3

Arquivo: `src/db/migrations/0003_prayer_requests.sql`.

Status: versionado, validado por `npm run migration:check` em dry-run estatico e aplicado manualmente no Supabase aprovado em 2026-06-03.

## Revisao Do Ciclo Auth/Supabase

- Enums `profile_role` e `lawyer_status` agora sao criados de forma idempotente com `DO $$`.
- `legal_specialties` recebe seed seguro de areas juridicas com `on conflict`.
- `lawyer_profiles.office_location` usa `geography(Point, 4326)` e indice GiST.
- Aplicacao remota e bloqueada por padrao pelo script `npm run migration:check`.
