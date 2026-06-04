# Backend Status - Meu Advogado 2.0

**Ultima atualizacao:** 2026-06-04
**Fase:** BACKEND / ADMIN OPERACIONAL PRODUCAO
**Veredito:** PERFIL_ADVOGADO_SOCIAIS_PRODUCAO_OK / MIGRATION_0006_APLICADA_OK / MIGRATION_0005_APLICADA_OK / ADMIN_OPERACIONAL_ORACOES_USUARIOS_MIDIA_PRODUCAO_OK / MIGRATION_0004_APLICADA_OK / CLIENT_SIGNUP_PRODUCAO_OK / CLIENT_SIGNUP_BACKEND_LOCAL_OK / MATCH_EVENTO_NAO_BLOQUEIA_RESPOSTA_LOCAL_OK / SPEC008_PARTE3_RETENCAO_ORACAO_PUBLICADA_OK

- [x] Ajuste publicado em 2026-06-04 no commit `ac06577`: resposta `matched` de `POST /v1/match` passou a incluir `avatarUrl` e `coverUrl` opcionais do advogado indicado, preservando a allowlist sem CEP/endereco/coordenada/email interno. `GET /v1/partner-logos` segue publico para o rodape mobile. Gates: `npm run test`, `npm run smoke` e `npm run harness` exit 0.

## Producao (Railway)

- URL publica: `https://advogado-back-production.up.railway.app` (HTTPS).
- Deploy via GitHub `meuadvogado2026/Advogado-back` (branch `main`), redeploy automatico a cada push.
- Node 22 exigido (`engines`/`.nvmrc`): supabase-js/realtime quebra em Node 20 por falta de WebSocket nativo.
- `PORT=8080` fixada nas Variables; demais envs (NODE_ENV=production, SUPABASE_URL/ANON/SERVICE_ROLE, GEOCODING_PROVIDER=nominatim) setadas no painel.
- Validado e2e com `npm run prod:smoke` (HTTP real contra a URL): /health 200, 6 areas, match SP/civil matched, perfil cliente 200 com allowlist segura, perfil sem token 401, SP/criminal empty, match sem token 401, admin geocode/cep 200 (persistence=supabase), admin lawyers 200, dashboard advogado 401/403/200 e prayer requests 401/403/422/201 sem ecoar texto; match_events e prayer_requests neutros do smoke limpos.
- Parte 2 publicada na Railway apos push pela conta correta `meuadvogado2026`; checagem redigida confirmou campos visuais opcionais em `GET /v1/lawyers/:id` e `forbiddenFieldCount=0`.
- Bugfix publicado no commit `60d90ce`: `POST /v1/match` nao retorna 500 se a persistencia de `match_events` falhar; a rota registra log sem coordenada/token e preserva a resposta para o cliente. `prod:smoke` pos-push passou contra Railway.
- Cadastro cliente publicado no commit `45ec1dc`: `POST /v1/auth/signup-client` retornou `422` para payload invalido, `201` para usuario descartavel real, criou Supabase Auth + `profiles.role=client`, login Supabase Auth retornou `200`, `GET /v1/me` retornou `role=client` e cleanup de Auth/profile foi concluido sem expor senha, token ou service role.
- Admin operacional ampliado publicado no commit `a0067c4`: `POST /v1/admin/lawyer-media`, `GET /v1/admin/prayer-requests`, `GET /v1/admin/users` e `PATCH /v1/admin/users/:id` publicados no Railway. Smoke publico validou `/health` `200`, endpoints admin novos sem token `401` e CORS `204` para Vercel; smoke autenticado assistido validou status persistente de advogado, upload de imagem, oracoes, usuarios e bloqueio/desbloqueio de usuario descartavel seguro com limpeza.
- Perfil publico do advogado com redes sociais publicado no commit `c29d5db`: `GET /v1/lawyers/:id` retorna links sociais opcionais seguros (`instagramUrl`, `linkedinUrl`, `facebookUrl`, `websiteUrl`) na allowlist publica. Migrations `0005_admin_prayers_partners.sql` e `0006_lawyer_social_links.sql` aplicadas/verificadas no Supabase.
- Gate final da publicacao social em 2026-06-04: `npm run harness` exit 0, Railway refletiu o commit novo com as chaves sociais no perfil publico e `PROD_BASE_URL=https://advogado-back-production.up.railway.app npm run prod:smoke` exit 0.
- Bugfix publicado em 2026-06-04 no commit `5a0db3e`: aprovacao de advogado legado sem coordenada agora tenta re-geocodificar automaticamente usando o CEP ja salvo antes de bloquear; quando Nominatim nao encontra o endereco completo, o provider tenta cidade/UF como centroide recuperavel. Causa confirmada em producao: `PATCH /v1/admin/lawyers/:id` com apenas `{ "status": "approved" }` retornava `422` porque o advogado tinha CEP salvo, cidade/UF ausentes e `officeLat/officeLng` nulos; a consulta direta do CEP retornava cidade/UF, mas sem coordenada no endereco completo. Backend `npm run harness` exit 0 com 65 testes. Smoke autenticado em producao pos-Railway aprovou o advogado real na 3a tentativa e confirmou status `approved`, cidade/UF e coordenada persistidos, sem registrar CEP, token, service role ou coordenada.

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
- [x] Spec 006: `GET /v1/me` implementado para retornar identidade/role segura (`id`, `email`, `role`) sem token/service role/payload sensivel.
- [x] `POST /v1/auth/signup-client` implementado e publicado para cadastro publico de cliente: cria Supabase Auth via service role server-side, cria `profiles.role=client` com mesmo id e responde sem senha/token/segredo. Em modo memory, contrato e smoke passam sem Supabase real; em producao Railway, smoke real passou com cadastro descartavel, login, `/v1/me` e cleanup.
- [x] Spec 007: mecanismo backend de retencao de `match_events` implementado com comando `npm run retention:match-events`, dry-run padrao, retencao de 90 dias e apply bloqueado por confirmacao explicita.
- [x] Checagem publica Railway sem credenciais executada antes do redeploy para admin producao: `/health` `200`, `/v1/areas` `200`, `/v1/admin/lawyers` sem token `401`, `POST /v1/admin/geocode/cep` sem token `401`, mas `GET /v1/me` retornou `404`.
- [x] Commit backend `e621676` publicado no GitHub/Railway com `GET /v1/me` e fallback CORS de producao no codigo.
- [x] Rechecagem publica pos-publicacao: `/health` `200`, `/v1/areas` `200`, `/v1/me` sem token `401`; preflights de `/v1/me`, `/v1/admin/geocode/cep` e `/v1/admin/lawyers` `204`.
- [x] Commit backend `844c048` publicado no GitHub/Railway para garantir CORS da origem admin Vercel mesmo quando `CORS_ORIGINS` remoto sobrescreve o padrao.
- [x] Rechecagem publica pos-fix CORS: `/v1/areas`, `/v1/me`, `/v1/admin/geocode/cep` e `/v1/admin/lawyers` retornam `Access-Control-Allow-Origin` para `https://advogado20admin.vercel.app`.
- [x] Revalidacao publica pos-env admin Vercel: `/v1/areas` `200`, `/v1/me` sem token `401`, `POST /v1/admin/geocode/cep` sem token `401`, `POST /v1/admin/lawyers` sem token `401` e preflights `204`, todos com CORS para `https://advogado20admin.vercel.app`.
- [x] Smoke autenticado do admin publicado validou backend Railway para `POST /v1/admin/geocode/cep` e `POST /v1/admin/lawyers`; cadastro descartavel foi limpo via service role local e verificacao final ficou sem residuo.
- [x] Spec 008 Parte 2 implementada localmente: `GET /v1/lawyers/:id` ganhou campos opcionais `avatarUrl`, `coverUrl`, `miniBio`, `fullBio`, `yearsExperience`, `planLabel` e `emergencyAvailable` sem quebrar contrato; URLs visuais inseguras/invalidas viram `null`.
- [x] Perfil publico do advogado ganhou suporte local a redes sociais opcionais HTTPS: Instagram, LinkedIn, Facebook e site profissional, preservando a allowlist sem CEP/email/coordenadas.
- [x] Allowlist publica revalidada: perfil segue sem CEP, endereco completo, coordenada, email interno, status administrativo ou auditoria. Testes cobrem `401`, `403`, `404`, `200` e URL insegura normalizada.
- [x] Spec 008 Parte 3 implementada localmente: `GET /v1/lawyer/me/dashboard` com role `lawyer`, beneficios estaticos/seguros e metricas zeradas; `POST /v1/prayer-requests` com role `client`, validacao Zod, rate limit, anonimato e resposta sem ecoar texto.
- [x] Migration aditiva `0003_prayer_requests.sql` versionada, validada por `npm run migration:check` e aplicada manualmente pelo usuario no Supabase SQL Editor aprovado.
- [x] Harness backend passou em 2026-06-03 com typecheck, 45 testes, build, migration dry-run e smoke local.
- [x] Spec 008 Parte 3 publicada apos aplicacao manual de `0003_prayer_requests.sql` no Supabase pelo usuario. Commit backend `a5db016` publicado no Railway; sonda sem credenciais retornou `401` nos endpoints novos; `npm run prod:smoke` contra Railway passou com dashboard advogado e prayer requests validados por role/status, sem ecoar texto.
- [x] Retencao LGPD de `prayer_requests` implementada sem migration nova: `npm run retention:prayer-requests` roda em dry-run por padrao, usa retencao de 90 dias e exige `--apply` + `PRAYER_REQUESTS_RETENTION_CONFIRMATION=APPLY_PRAYER_REQUESTS_RETENTION` para expurgo destrutivo.
- [x] `prod:smoke` ajustado para limpar os `prayer_requests` neutros criados pelo proprio smoke; smoke Railway passou com `prayerRequestsDeleted=2`, sem ecoar texto nem `clientProfileId`.
- [x] Pacote de retencao de `prayer_requests` versionado e publicado no repo oficial pelo commit `5434baa` (`Implement prayer requests retention`); smoke Railway pos-push passou com limpeza de `match_events` e `prayer_requests` neutros criados no teste.
- [x] Spec 009 backend implementada localmente: `GET /v1/admin/lawyers` em modo Supabase agora hidrata `name`, `email`, `mainAreaId` e `secondaryAreaIds` via `profiles` e `lawyer_specialties`; `POST /v1/admin/lawyers` persiste `lawyer_specialties` com area principal/secundarias.
- [x] Harness backend da spec 009 passou com exit code 0: typecheck, 51 testes, build, migration dry-run e smoke local.
- [x] Bugfix do match publicado: falha de `match_events.record` nao bloqueia `matched`/`empty`; teste de regressao adicionado, harness backend exit 0 e `prod:smoke` Railway exit 0.
- [x] Harness backend do cadastro cliente passou em 2026-06-03: typecheck, 55 testes, build, migration dry-run e smoke local com signup publico sem token/senha na resposta.
- [x] Ciclo admin operacional ampliado implementado localmente: `POST /v1/admin/lawyer-media`, `GET /v1/admin/prayer-requests`, `GET /v1/admin/users` e `PATCH /v1/admin/users/:id`.
- [x] Migration aditiva `0004_admin_users_blocking.sql` versionada para `profiles.blocked_at`; auth real passa a rejeitar usuario bloqueado com `403`.
- [x] Status do advogado coberto por regressao: `PATCH /v1/admin/lawyers/:id` persiste a escolha e `GET /v1/admin/lawyers` reflete o status atualizado.
- [x] Harness backend do ciclo ampliado passou com exit 0: typecheck, 60 testes, build, migration dry-run incluindo `0004` e smoke local.
- [x] Migration `0004_admin_users_blocking.sql` aplicada manualmente no Supabase aprovado; verificacao REST redigida confirmou `profiles.blocked_at` existente (`HTTP 200`, `blockedAtExists=true`) e `npm run migration:check` seguiu OK.
- [x] Ciclo admin operacional ampliado publicado/validado em producao pelo commit backend `a0067c4`, com endpoints sem token retornando `401`, CORS Vercel OK e smoke autenticado assistido OK.
- [x] Melhorias publicadas em 2026-06-04 pelo commit `1565c23`: `PATCH /v1/admin/lawyers/:id` atualiza dados completos e persiste cidade/UF do CEP; `PATCH /v1/admin/prayer-requests/:id` marca `read`/`received`; `GET/POST /v1/admin/partner-logos`, `POST /v1/admin/partner-logo-media` e `GET /v1/partner-logos` foram criados. Migration `0005_admin_prayers_partners.sql` versionada; backend `npm run harness` exit 0 e smoke publico basico `/health` retornou 200.
- [x] Perfil do advogado com redes sociais publicado em 2026-06-04 pelo commit `c29d5db`; backend `npm run harness` exit 0 e `prod:smoke` Railway exit 0 apos aplicacao das migrations `0005` e `0006`.

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
- [x] Testes 401/422/matched/empty/fora-do-raio passando; harness exit code 0; smoke valida matched (2.6km) com foto/capa e empty.
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
- [x] Spec 007 implementada para TTL/anonimizacao de `match_events.client_location`, com recomendacao MVP de expurgo integral apos 90 dias.
- [x] Dry-run real de `npm run retention:match-events` passou com `matchedEvents=0`, `deletedEvents=0`, `applied=false`.
- [ ] Executar apply remoto real da spec 007 somente quando houver janela aprovada e necessidade operacional.
- [x] Apoiar spec 006 com contrato seguro de perfil/role (`GET /v1/me`) e harness backend exit 0.
- [x] Apoiar spec 008 Parte 3 localmente com dashboard advogado e pedido de oracao.
- [x] Apoiar painel admin com midia, oracoes e usuarios.
- [x] Apoiar melhorias locais do painel admin com edicao completa, oracao lida e parceiros.
- [x] Corrigir aprovacao de advogado legado sem coordenada persistida, recuperando coordenada pelo CEP salvo quando o status alvo for `approved`.

## Bloqueios

- Spec 006 admin login/sessao foi validada com smoke admin real local; para operar contra producao/Railway, repetir smoke proporcional no ambiente publicado.
- Backend Railway publicado agora contem `GET /v1/me` da spec 006 e retorna `401` sem token, como esperado.
- CORS para `https://advogado20admin.vercel.app` esta validado em producao apos commit `844c048`; o smoke autenticado do admin publicado fechou com limpeza. Negativo nao-admin publicado segue pendente apenas se houver credencial segura desse perfil.
- Apply destrutivo da spec 007 nao foi executado; comando exige `--apply` e `MATCH_EVENTS_RETENTION_CONFIRMATION=APPLY_MATCH_EVENTS_RETENTION`.
- `psql` nao esta disponivel no ambiente local; migrations dependem de aplicacao manual no SQL Editor.
- `0003_prayer_requests.sql` foi aplicada manualmente no Supabase aprovado pelo usuario. A retencao operacional de `prayer_requests` esta formalizada e testada; apply destrutivo real deve ocorrer somente em janela aprovada quando houver pedidos antigos elegiveis.
- Admin operacional ampliado esta publicado e validado em producao. `0004_admin_users_blocking.sql` foi aplicada manualmente pelo usuario no Supabase SQL Editor aprovado; verificacao REST redigida confirmou `profiles.blocked_at` existente (`200`, `blockedAtExists=true`).
- Melhorias de edicao/oracao/parceiros ja tiveram codigo publicado e a migration `0005_admin_prayers_partners.sql` foi aplicada em producao; `prod:smoke` voltou a passar incluindo `prayer_requests`.
- Provider real BrasilAPI + Nominatim so e exercitado fora de teste (testes usam stub/fetch mockado); validar contra os servicos reais exige `GEOCODING_PROVIDER=nominatim` e rede.
- Proximos ciclos devem ser iniciados pela raiz do projeto para carregar a governanca central `.codex/` e specs em `.codex/specs/`.
- Cadastro cliente esta publicado e validado no backend Railway. Se o APK/mobile em uso nao contiver a UI nova, o rebuild/publicacao mobile deve ocorrer em ciclo separado.

## Proximo Passo

Perfil do advogado com redes sociais esta `PERFIL_ADVOGADO_SOCIAIS_PRODUCAO_OK`. O pacote de edicao/oracao/parceiros esta destravado apos aplicacao da `0005` e `prod:smoke` OK. Bugfix de aprovacao por re-geocoding de CEP salvo esta localmente validado e deve ser publicado/validado em producao.
