# Backend Architecture - Advogado 2.0

## Camadas

- `routes/controllers`: HTTP.
- `schemas`: validacao de entrada/saida.
- `services`: regras de negocio.
- `repositories`: acesso ao Supabase/Postgres.
- `auth`: JWT, roles e guards.
- `integrations`: CEP/geocoding, storage, notificacoes futuras.
- `observability`: logs, metrics e healthcheck.

## Principios

- API stateless.
- `/v1` versionado.
- Validacao server-side obrigatoria.
- Idempotencia em urgencias.
- Paginacao em listas.
- Logs sem PII sensivel.
- RLS no Supabase como defesa adicional, nao como unica autorizacao.

## Fluxos Criticos

- Admin cadastra advogado por CEP.
- Cliente pede match por coordenadas.
- Cliente abre WhatsApp.
- Cliente aciona urgencia.
- Admin resolve urgencia.

## Estrutura Atual

- `src/app.ts`: composicao Fastify.
- `src/auth`: validacao Bearer token, Supabase Auth e role guards.
- `src/contracts`: DTOs Zod compartilhados pelas rotas.
- `src/modules`: health, areas, match, adminLawyers e geocoding.
- `src/repositories`: repositorios Supabase/memoria para dominio.
- `src/db/migrations`: migrations SQL versionadas.
- `scripts`: harness e smoke.

## Decisoes Pendentes

- ORM/query builder.
- Aplicacao remota das migrations.
- RLS detalhado apos schema aplicado.

## Auth E Roles

- Rotas publicas: `GET /health`, `GET /v1/areas`, `POST /v1/match`.
- Rotas admin: exigem `Authorization: Bearer <Supabase JWT>` e perfil com `role = admin`.
- Em `NODE_ENV=test`, tokens fixos `test-admin-token` e `test-client-token` permitem testar 401/403 sem segredos.
