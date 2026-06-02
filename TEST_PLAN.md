# Backend Test Plan - Meu Advogado 2.0

## Harness Obrigatorio

Comando principal:

- `npm run harness`

O harness executa:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run migration:check`
- `npm run smoke`

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

## Smoke API

- `GET /health`.
- `GET /v1/areas`.
- `POST /v1/match`.
- `GET /v1/admin/lawyers` sem token retorna `401`.
- `GET /v1/admin/lawyers` com role errada retorna `403`.

`POST /v1/admin/geocode/cep` fica para o ciclo de geocoding real.

## Spec 007 - Retencao LGPD

- `npm run test -- --run tests/matchEventsRetention.test.ts`: valida cutoff de 90 dias, dry-run sem delete, bloqueio de apply sem confirmacao, apply confirmado via mock e janela invalida.
- `npm run retention:match-events`: dry-run real; conta eventos antigos sem alterar dados e sem imprimir coordenada exata.
- Apply destrutivo exige `npm run retention:match-events -- --apply` com `MATCH_EVENTS_RETENTION_CONFIRMATION=APPLY_MATCH_EVENTS_RETENTION`.

Resultado em 2026-06-02: testes focados exit code 0; dry-run exit code 0 com `matchedEvents=0`, `deletedEvents=0`, `applied=false`; harness backend exit code 0 com 36 testes.

## Evidencias

Registrar comando, cwd, exit code, resultado e lacunas.
