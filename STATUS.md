# Backend Status - Meu Advogado 2.0

**Ultima atualizacao:** 2026-05-31  
**Fase:** BACKEND EM PRODUCAO NA RAILWAY / SPEC 004 ENDPOINT CLIENTE PUBLICADO
**Veredito:** OK

## Producao (Railway)

- URL publica: `https://advogado-back-production.up.railway.app` (HTTPS).
- Deploy via GitHub `meuadvogado2026/Advogado-back` (branch `main`), redeploy automatico a cada push.
- Node 22 exigido (`engines`/`.nvmrc`): supabase-js/realtime quebra em Node 20 por falta de WebSocket nativo.
- `PORT=8080` fixada nas Variables; demais envs (NODE_ENV=production, SUPABASE_URL/ANON/SERVICE_ROLE, GEOCODING_PROVIDER=nominatim) setadas no painel.
- Validado e2e com `npm run prod:smoke` (HTTP real contra a URL): /health 200, 6 areas, match SP/civil matched 0km, perfil cliente 200 com allowlist segura, perfil sem token 401, SP/criminal empty, match sem token 401, admin geocode/cep 200 (persistence=supabase), admin lawyers 200; match_events do smoke limpos.

## Concluido

- [x] Documentacao inicial do backend criada.
- [x] Responsabilidades da API definidas.
- [x] Decisao de backend entre apps e Supabase registrada.
- [x] Scaffold Fastify + TypeScript + Zod criado.
- [x] Healthcheck local executavel criado.
- [x] Contratos iniciais em `openapi.yaml` e schemas Zod criados.
- [x] Modulo geocoding abstrato stub/cacheado criado.
- [x] Modulo match stubado criado.
- [x] Migration Supabase/PostGIS rascunhada em `src/db/migrations/0001_foundation_postgis.sql`.
- [x] Harness CLI e smoke local criados.
- [x] SDK Supabase configurado no backend.
- [x] Middleware Bearer token + role guard implementado.
- [x] Rotas admin protegidas por role `admin`.
- [x] Repositories para profiles, legal_specialties, lawyer_profiles, lawyer_specialties e audit_logs criados.
- [x] Migration revisada para enums idempotentes e seed seguro de areas juridicas.
- [x] Script `npm run migration:check` criado com dry-run estatico e aplicacao remota bloqueada por padrao.
- [x] Testes 401/403/422/200 principais criados.
- [x] Migration inicial aplicada manualmente no Supabase SQL Editor pelo usuario.
- [x] Harness backend validado com Supabase real apos migration aplicada.
- [x] Usuarios de teste sincronizados em `profiles`: admin, lawyer e client.
- [x] `lawyer_profiles` minimo aprovado criado para o usuario advogado de teste.
- [x] Smoke JWT real criado e executado com `npm run auth:smoke`.
- [x] Admin real validado com `200` em rota admin; advogado e cliente validados com `403`.
- [x] Ambiente backend passou a ser governado pela `.codex/` unica da raiz; copia local `Meu Advogado 2.0 - back/.codex` removida.

## Match Real Geoespacial (spec 001)

- [x] Contrato final de `POST /v1/match` definido (`matched`/`empty`, `algorithmVersion: geo-nearest-v1`).
- [x] Auth de cliente exigida na rota (`401` sem token); `422` para payload invalido apos auth.
- [x] Fronteira `MatchRepository.findNearest` + `MatchEventRepository.record` (memory + supabase).
- [x] Impl memory com fixtures de coordenadas fixas + haversine para testes/smoke.
- [x] Impl supabase via RPC `match_nearest_lawyer` (PostGIS `ST_Distance`).
- [x] Migration `src/db/migrations/0002_match_nearest.sql` criada (funcao geoespacial).
- [x] Seed `src/db/seeds/001_match_fixtures.sql` com advogados aprovados e coordenadas fixas.
- [x] `migration:check` ajustado para iterar/validar todas as migrations de `src/db/migrations/` em ordem (0001 + 0002) e listar seeds de `src/db/seeds/`, mantendo dry-run estatico e apply remoto bloqueado por padrao.
- [x] Filtro de elegibilidade: `approved` + `office_location` + area compativel; raio via `MATCH_MAX_RADIUS_KM` (default 200km).
- [x] Evento de match grava coordenada no banco, nunca em logs (LGPD).
- [x] Testes 401/422/matched/empty/fora-do-raio passando; harness exit code 0; smoke valida matched (2.6km) e empty.
- [x] `0002_match_nearest.sql` + seed `001_match_fixtures.sql` aplicados manualmente no Supabase SQL Editor (Success).
- [x] Fixture adicional Dra. Carla Lima (Brasilia/Samambaia Sul, CEP 72309601, civil+familia) versionado no seed e aplicado.

## Admin Geocoding por CEP (spec 002 - backend)

- [x] `GeocodingProvider` real `NominatimGeocodingProvider`: BrasilAPI (CEP) + Nominatim (coordenada).
- [x] Cache TTL (CEP e coordenada) + rate limit serializado (intervalo minimo, politica Nominatim) no backend.
- [x] Factory `createGeocodingProvider(env)`: stub offline em test/`GEOCODING_PROVIDER=stub`, real caso contrario.
- [x] Endpoint `POST /v1/admin/geocode/cep` protegido por role admin (401/403), 422 para CEP invalido/nao encontrado, 503 para provider indisponivel, 200 com coordenada nula recuperavel quando endereco nao geocodifica.
- [x] Seguranca/PII: nunca loga CEP/stack; auditoria grava apenas cidade/estado/provider, sem CEP cru.
- [x] Testes: 401/403/422/200 do endpoint + unitarios do provider (CEP invalido, 404, provider indisponivel, sucesso, cache, sem resultado). Harness exit code 0 (22 testes).

## Em Andamento

- [x] Revalidar o match real contra Supabase (PostGIS) com token de cliente real (`scripts/match-smoke.ts`: matched SP/civil 0km, empty SP/criminal, 401 sem token; match_events do smoke limpos via service role). Perna de GPS fisica tambem validada no APK preview em device Android real, sem fallback dev.
- [x] Persistir a coordenada geocodificada no `lawyer_profiles` no fluxo de cadastro/edicao admin: `lawyers.create`/`update` recebem `{ lat, lng }` e gravam `office_lat`, `office_lng` e `office_location = SRID=4326;POINT(lng lat)`. A rota geocodifica o CEP, passa a coordenada ao repo e bloqueia `status=approved` sem coordenada valida (422); `update` re-geocodifica quando o CEP muda. Testes: cadastro persiste coordenada, aprovacao sem coordenada bloqueada, aprovacao com re-geocode permitida. Harness exit code 0 (25 testes).
- [x] UI do formulario admin consumindo `POST /v1/admin/geocode/cep` (task 6 da spec 002), validada e2e com token admin real (`scripts/admin-form-smoke.ts`): geocode 200, list 200 `persistence=supabase`, create 201 + limpeza via service role, sem residuo.
- [x] Implementar `GET /v1/lawyers/:id` com allowlist cliente segura conforme spec 004.
- [x] Validar `GET /v1/lawyers/:id` com TDD `401`, `403`, `404`, `200`, Harness backend e smoke Supabase real sem campos proibidos.
- [x] Publicar `GET /v1/lawyers/:id` na Railway e validar por HTTP real com token cliente, allowlist estrita e limpeza de eventos.
- [ ] Definir TTL/anonimizacao de `match_events.client_location` (retencao LGPD sugerida: 90 dias).

## Bloqueios

- Admin UI ainda nao implementa login completo; mobile ja possui login real validado.
- `psql` nao esta disponivel no ambiente local; migrations dependem de aplicacao manual no SQL Editor.
- Provider real BrasilAPI + Nominatim so e exercitado fora de teste (testes usam stub/fetch mockado); validar contra os servicos reais exige `GEOCODING_PROVIDER=nominatim` e rede.
- Proximos ciclos devem ser iniciados pela raiz do projeto para carregar a governanca central `.codex/` e specs em `.codex/specs/`.

## Proximo Passo

Endpoint cliente da spec 004 implementado, publicado e validado por HTTP real na Railway sem migration. Proxima perna: implementar a navegacao mobile `Home -> Perfil -> WhatsApp`.
