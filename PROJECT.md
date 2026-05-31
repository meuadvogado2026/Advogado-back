# Backend Project - Meu Advogado 2.0

**Fase:** producao Railway / spec 004 perfil do advogado pronta para breakdown
**Hospedagem alvo:** Railway  
**Stack:** Node.js + Fastify + TypeScript + Zod

## Objetivo

Construir a API que centraliza regra de negocio, autorizacao, match por localizacao, cadastro de advogados por CEP, eventos e operacao administrativa.

## Responsabilidades

- Validar JWT/session.
- Resolver roles.
- Expor API `/v1`.
- Cadastrar advogado via admin.
- Geocodificar CEP do advogado.
- Executar match por localizacao do cliente.
- Registrar eventos, urgencias e audit logs.
- Proteger PII e logs.

## Fora De Escopo

- UI.
- Segredos no mobile/admin.
- Migrar banco legado.

## Fontes De Verdade

- `../DOCUMENTACAO_TECNICA.md`
- `../DECISIONS.md`
- `../.codex/SPEC_Specs/SPEC_MeuAdvogado20_SDD.md`

## Scaffold Atual

- `src/app.ts`: instancia Fastify, CORS, rate limit e registro das rotas.
- `src/modules/health`: `GET /health`.
- `src/modules/areas`: `GET /v1/areas`.
- `src/modules/match`: `POST /v1/match` real com auth, PostGIS e respostas `matched`/`empty`.
- `src/modules/adminLawyers`: `GET/POST/PATCH /v1/admin/lawyers` com repositorios memory/Supabase.
- `src/auth`: middleware Bearer token, Supabase Auth e guards por role.
- `src/repositories`: fronteira de persistencia com implementacoes Supabase e memoria local/teste.
- `src/modules/geocoding`: provider BrasilAPI + Nominatim cacheado e stub controlado para testes.
- `src/contracts/api.ts`: DTOs Zod iniciais.
- `openapi.yaml`: contrato versionado da fundacao.
- `src/db/migrations/`: migrations versionadas e aplicadas manualmente no Supabase oficial.
- `scripts/harness.ts` e `scripts/smoke.ts`: Harness CLI e smoke local.
- `src/modules/lawyerProfiles`: `GET /v1/lawyers/:id` com auth cliente/admin, allowlist publica e `404` seguro para perfil indisponivel.

## Scripts

- `npm run dev`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run migration:check`
- `npm run smoke`
- `npm run harness`

## Supabase Controlado

Quando `SUPABASE_SERVICE_ROLE_KEY` valido existe apenas no backend, a API usa Supabase Auth para validar o Bearer token e busca a role em `profiles`. Sem service role valida, o backend nao autentica tokens reais; apenas `NODE_ENV=test` aceita tokens fixos de teste.
