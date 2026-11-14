-- SPEC-018: aplicar ANTES da API minimizada. Nao apaga historico.
-- NOT VALID dispensa verificar linhas legadas, mas protege novas escritas.
-- Sem rollback para coleta: corrigir para frente mantendo esta protecao.
begin;
alter table public.match_events alter column client_location drop not null;
alter table public.match_events add constraint match_events_no_client_geography
  check (client_location is null and accuracy_m is null and distance_km is null) not valid;
comment on constraint match_events_no_client_geography on public.match_events is
  'Novos eventos nao guardam localizacao, precisao ou distancia do cliente. Historico exige saneamento separado.';
commit;
