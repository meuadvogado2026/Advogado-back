-- Spec 012 ajuste de produto: busca por cidade sem distancia e catalogo DF simples.

drop function if exists public.match_lawyers_by_city(uuid, uuid, uuid[], integer, integer);

create function public.match_lawyers_by_city(
  p_state_id uuid,
  p_city_id uuid,
  p_area_ids uuid[],
  p_limit integer,
  p_offset integer
)
returns table (
  lawyer_profile_id uuid,
  name text,
  whatsapp text,
  city_name text,
  state_code char(2),
  area_ids uuid[],
  total_count bigint
)
language sql
stable
as $$
  select
    lp.id,
    p.name,
    lp.whatsapp,
    c.name,
    s.code,
    array_agg(distinct ls.specialty_id),
    count(*) over()
  from public.lawyer_profiles lp
  join public.profiles p on p.id = lp.profile_id
  join public.cities c on c.id = lp.service_city_id
  join public.states s on s.id = c.state_id
  join public.lawyer_specialties ls on ls.lawyer_profile_id = lp.id
  where s.id = p_state_id
    and c.id = p_city_id
    and s.active = true
    and c.active = true
    and lp.status = 'approved'
    and lp.available_for_matches = true
    and p.blocked_at is null
    and lp.office_location is not null
    and lp.office_geocode_confidence = 'high'
    and lp.office_geocode_precision in ('street', 'manual')
    and ls.specialty_id = any (p_area_ids)
  group by lp.id, p.name, lp.whatsapp, c.name, s.code
  order by p.name, lp.id
  limit greatest(1, least(p_limit, 5))
  offset greatest(0, p_offset);
$$;

with upsert_state as (
  insert into public.states (code, name, active)
  values ('DF', 'Distrito Federal', true)
  on conflict (code) do update
  set name = excluded.name,
      active = true,
      updated_at = now()
  returning id
),
df_state as (
  select id from upsert_state
  union all
  select id from public.states where code = 'DF'
  limit 1
),
df_cities(name, normalized_name) as (
  values
    (U&'\00C1guas Claras', 'aguas claras'),
    (U&'\00C1gua Quente', 'agua quente'),
    ('Arapoanga', 'arapoanga'),
    ('Arniqueira', 'arniqueira'),
    (U&'Brazl\00E2ndia', 'brazlandia'),
    (U&'Candangol\00E2ndia', 'candangolandia'),
    (U&'Ceil\00E2ndia', 'ceilandia'),
    ('Cruzeiro', 'cruzeiro'),
    ('Fercal', 'fercal'),
    ('Gama', 'gama'),
    (U&'Guar\00E1', 'guara'),
    (U&'Itapo\00E3', 'itapoa'),
    (U&'Jardim Bot\00E2nico', 'jardim botanico'),
    ('Lago Norte', 'lago norte'),
    ('Lago Sul', 'lago sul'),
    (U&'N\00FAcleo Bandeirante', 'nucleo bandeirante'),
    (U&'Parano\00E1', 'paranoa'),
    ('Park Way', 'park way'),
    ('Planaltina', 'planaltina'),
    ('Plano Piloto', 'plano piloto'),
    ('Recanto das Emas', 'recanto das emas'),
    ('Riacho Fundo I', 'riacho fundo i'),
    ('Riacho Fundo II', 'riacho fundo ii'),
    ('Samambaia', 'samambaia'),
    ('Santa Maria', 'santa maria'),
    (U&'S\00E3o Sebasti\00E3o', 'sao sebastiao'),
    ('SCIA/Estrutural', 'scia/estrutural'),
    ('SIA', 'sia'),
    ('Sobradinho', 'sobradinho'),
    ('Sobradinho II', 'sobradinho ii'),
    (U&'Sol Nascente/P\00F4r do Sol', 'sol nascente/por do sol'),
    ('Sudoeste/Octogonal', 'sudoeste/octogonal'),
    ('Taguatinga', 'taguatinga'),
    (U&'Varj\00E3o', 'varjao'),
    ('Vicente Pires', 'vicente pires')
)
insert into public.cities (state_id, name, normalized_name, active, center_location)
select
  df_state.id,
  df_cities.name,
  df_cities.normalized_name,
  true,
  st_setsrid(st_makepoint(-47.882778, -15.793889), 4326)::geography
from df_state
cross join df_cities
on conflict (state_id, normalized_name) do update
set name = excluded.name,
    active = true,
    updated_at = now();
