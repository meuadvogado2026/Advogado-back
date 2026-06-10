# Backend Operations - Advogado 2.0

**Hospedagem alvo:** Railway

## Ambientes

- Local.
- Staging.
- Production.

## Variaveis

- `SUPABASE_URL`.
- `SUPABASE_ANON_KEY`, publica, quando necessario para clientes/ferramentas.
- `SUPABASE_SERVICE_ROLE_KEY`.
- `SUPABASE_DB_URL` somente para migration controlada.
- `APPLY_REMOTE_MIGRATIONS=false` por padrao.
- `MIGRATION_CONFIRMATION` somente no momento de aplicar migration.
- `GEOCODING_PROVIDER`.
- `NOMINATIM_BASE_URL`.
- `BRASILAPI_BASE_URL`.
- `CORS_ORIGINS`.
- Rate limit config.

Ver `.env.example`.

O backend carrega primeiro `.env` da raiz do workspace e depois `.env` local do backend, se existir. Valores locais sobrescrevem os da raiz.

## Deploy

- Deploy staging antes de producao.
- Healthcheck obrigatorio.
- Migrations controladas.

## Smoke Pos-Deploy

- `GET /health`.
- Auth valida token.
- Match com seed.
- Admin geocode com CEP valido.

## Migration

Padrao seguro:

- `npm run migration:check`

Aplicacao remota exige comando explicito, confirmacao explicita e `psql` disponivel:

- `npm run migration:apply`
- `APPLY_REMOTE_MIGRATIONS=true`
- `MIGRATION_CONFIRMATION=APPLY_ADVOGADO_20_FOUNDATION`
- `SUPABASE_DB_URL` configurado somente no ambiente seguro.

## Seeds De Teste

`npm run seed:test-users` sincroniza os tres usuarios de teste do Supabase Auth com `profiles`:

- `admin@advogado20.com` -> `admin`
- `advogado@advogado20.com` -> `lawyer`
- `usuario@advogado20.com` -> `client`

O script tambem cria/atualiza um `lawyer_profiles` minimo aprovado para o usuario advogado.

`npm run auth:smoke` le `../Credenciais para testes.txt`, faz login via Supabase Auth e valida permissoes reais:

- admin -> `GET /v1/admin/lawyers` retorna `200`.
- advogado -> `403`.
- cliente -> `403`.

O script nao imprime senhas nem JWTs.

## Rollback

- API versionada.
- Migration rollback documentado.
- Railway rollback quando aplicavel.
