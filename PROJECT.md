# Backend Project - Meu Advogado 2.0

**Fase:** fundacao backend com auth/roles e Supabase controlado  
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
- `src/modules/match`: `POST /v1/match` com validacao Zod e resposta stubada.
- `src/modules/adminLawyers`: `GET/POST/PATCH /v1/admin/lawyers` com persistencia em memoria.
- `src/auth`: middleware Bearer token, Supabase Auth e guards por role.
- `src/repositories`: fronteira de persistencia com implementacoes Supabase e memoria local/teste.
- `src/modules/geocoding`: abstraction inicial com provider stub cacheado.
- `src/contracts/api.ts`: DTOs Zod iniciais.
- `openapi.yaml`: contrato versionado da fundacao.
- `src/db/migrations/0001_foundation_postgis.sql`: rascunho versionado Supabase/PostGIS, nao aplicado remotamente.
- `scripts/harness.ts` e `scripts/smoke.ts`: Harness CLI e smoke local.

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
