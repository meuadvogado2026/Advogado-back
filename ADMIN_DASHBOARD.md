# Dashboard administrativo - contrato e leitura

Fonte: analise direta do codigo local, 2026-11-14, SPEC-022/ADR-016/CON-022.

- GET /v1/admin/dashboard: JWT admin; 401 sem sessao,403 sem role,502 sem snapshot completo. DTO generatedAt/users/lawyers/coverage/regions/states; sem nomes/emails/telefones/coordenadas ou oracoes.
- Usuarios do app: profiles client+lawyer; administradores fora. Clientes e contas de advogado identificados separadamente. Advogados cadastrados: registros lawyer_profiles em todos os status; nao equivale a quantidade de contas lawyer.
- Novos30dias: contas de cliente/advogado com createdAt entre agora-30dias e agora, inclusivo; data invalida/futura nao entra.
- Disponiveis: advogado aprovado, perfil existente nao bloqueado, available_for_matches, escritorio com coordenada validada high/street ou manual, cidade/estado de atendimento ativos. Mesma elegibilidade do catalogo de busca.
- Cidades atendidas: cidades ativas com pelo menos um advogado elegivel; percentual sobre as cidades ativas do catalogo em estados ativos, nao sobre cidades do Brasil. Repeticoes de advogados na mesma cidade contam uma cidade.
- Regioes/UF: todos os cadastros de advogado, por cidade de atendimento -> estado. Sem cidade/UF valida entra em Nao informado; nunca inferir porOAB/endereco do cliente. Percentuais sobre todos os cadastros, arredondados a1decimal.
- Snapshot le somente colunas necessarias, paginado e ordenado; adapter aborta em falha de qualquer pagina. Leitura entre tabelas e eventual, nao atomica. Sem polling/cache; atualizar refaz consulta. Para grande volume, planejar SQL agregado em nova spec/migration.
- Admin filtra catalogo completo por estado/nome sem acento/situacao, com paginacao local apos filtro. Cidade existente nao e recriada; reativacao permanece explicita porPATCH.

Gates: Harness back/admin, Vitest agregacao/snapshot/roles/PII/filtros; scripts/admin-regression.cjs Chrome com fixtures para loading/falha/zero/prioridades/cidades e responsividade. Smoke real compara totais com fontes paginadas apos rolloutAPI/admin. Rollback: reverter codigo sem dados/schema a restaurar.
