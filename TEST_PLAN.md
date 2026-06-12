# Backend Test Plan - Advogado 2.0

## Spec 012

- Cobrir ocultacao de localidades inativas nas listagens admin.
- Cobrir reativacao pelo `POST` preservando o ID e conflito para duplicata ativa.
- Roles, catalogo, duplicidade, exclusao vinculada e cidade/estado incorretos.
- Disponibilidade, legado sem cidade, deduplicacao, paginacao 5 e allowlist.
- Regressao de `/v1/match`; `EXPLAIN` real pendente ate migration controlada.

## Harness Obrigatorio

Comando principal:

- `npm run harness`

O harness executa:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run migration:check`
- `npm run smoke`

## Performance Das Listas Admin

- `npm run admin-filter:perf`: executa 2 aquecimentos e 7 amostras por rota
  autenticada, sem imprimir token, PII ou corpos de resposta.
- `ADMIN_FILTER_PERF_BASE_URL=https://... npm run admin-filter:perf`: repete o
  mesmo benchmark pela URL publica; destinos HTTP sao recusados.
- Orcamento padrao: p95 menor ou igual a `1500 ms`, configuravel por
  `ADMIN_FILTER_P95_BUDGET_MS`.
- `scripts/sql/admin-filter-explain.sql`: diagnostico read-only para confirmar
  indices e revisar `Planning Time`, `Execution Time` e buffers no SQL Editor.
- Em tabelas pequenas, `Seq Scan` pode ser a escolha correta do PostgreSQL e
  nao deve ser tratado isoladamente como falha.

Resultado em 2026-06-12 apos aplicacao da migration `0013`: benchmark com
Supabase real passou. P95: advogados/status `267.7 ms`, advogados/busca
`240.7 ms`, oracoes/status `235.4 ms`, usuarios/busca `165.5 ms` e parceiros
`113.8 ms`. Todas as respostas foram `200`, paginadas e com persistencia
Supabase. O `EXPLAIN` direto ficou pendente porque `psql` nao esta instalado
neste ambiente; o SQL read-only esta pronto para execucao no Supabase.

## Testes Minimos

- Auth/roles.
- Geocoding parser.
- Match por coordenadas.
- CEP invalido.
- Advogado sem coordenada.
- Urgencia idempotente.
- Eventos de WhatsApp.
- Admin status update.
- Retencao LGPD de `match_events`.
- Retencao LGPD de `prayer_requests`.

## Smoke API

- `GET /health`.
- `GET /v1/areas`.
- `POST /v1/match`.
- `GET /v1/admin/lawyers` sem token retorna `401`.
- `GET /v1/admin/lawyers` com role errada retorna `403`.

- `POST /v1/admin/geocode/cep` com CEP valido deve retornar endereco normalizado; quando o provider achar coordenada de confianca media/alta, o cadastro/aprovacao pode persistir coordenada.
- CEP com endereco completo sem resultado no Nominatim deve tentar bairro/cidade antes de cair para cidade/UF ampla.

## Spec 007 - Retencao LGPD

- `npm run test -- --run tests/matchEventsRetention.test.ts`: valida cutoff de 90 dias, dry-run sem delete, bloqueio de apply sem confirmacao, apply confirmado via mock e janela invalida.
- `npm run retention:match-events`: dry-run real; conta eventos antigos sem alterar dados e sem imprimir coordenada exata.
- Apply destrutivo exige `npm run retention:match-events -- --apply` com `MATCH_EVENTS_RETENTION_CONFIRMATION=APPLY_MATCH_EVENTS_RETENTION`.

Resultado em 2026-06-02: testes focados exit code 0; dry-run exit code 0 com `matchedEvents=0`, `deletedEvents=0`, `applied=false`; harness backend exit code 0 com 36 testes.

## Spec 008 Parte 3 - Retencao LGPD De Oracao

- `npm run test -- --run tests/prayerRequestsRetention.test.ts`: valida cutoff de 90 dias, dry-run sem delete, bloqueio de apply sem confirmacao, apply confirmado via mock e janela invalida.
- `npm run retention:prayer-requests`: dry-run real; conta pedidos antigos sem alterar dados e sem imprimir texto de oracao.
- Apply destrutivo exige `npm run retention:prayer-requests -- --apply` com `PRAYER_REQUESTS_RETENTION_CONFIRMATION=APPLY_PRAYER_REQUESTS_RETENTION`.
- `npm run prod:smoke` deve validar `POST /v1/prayer-requests` sem eco de texto e limpar os pedidos neutros criados no proprio smoke.

Resultado em 2026-06-03: testes focados exit code 0; dry-run exit code 0 com `matchedRequests=0`, `deletedRequests=0`, `applied=false`; harness backend exit code 0 com 50 testes; `prod:smoke` Railway exit code 0 com `prayerRequestsDeleted=2`.

## Evidencias

- 2026-06-05 hotfix GEO/admin CEP: `npm run test -- --run tests/geocoding.test.ts tests/app.test.ts` exit 0 (59 testes), `npm run typecheck` exit 0, sonda real segura do CEP informado retornou `hasCoordinate=true`, `precision=cep_centroid`, `confidence=medium`, `npm run harness` exit 0 (70 testes, build, migration dry-run e smoke local) e `PROD_BASE_URL=https://advogado-back-production.up.railway.app npm run prod:smoke` exit 0 apos deploy Railway do commit `b0b4ea6`.

Registrar comando, cwd, exit code, resultado e lacunas.
