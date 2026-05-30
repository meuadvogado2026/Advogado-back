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

## Smoke API

- `GET /health`.
- `GET /v1/areas`.
- `POST /v1/match`.
- `GET /v1/admin/lawyers` sem token retorna `401`.
- `GET /v1/admin/lawyers` com role errada retorna `403`.

`POST /v1/admin/geocode/cep` fica para o ciclo de geocoding real.

## Evidencias

Registrar comando, cwd, exit code, resultado e lacunas.
