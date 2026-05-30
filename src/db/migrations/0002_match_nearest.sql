-- Meu Advogado 2.0 - match real geoespacial (spec 001)
-- Funcao chamada via supabase.rpc("match_nearest_lawyer", ...).
-- Calcula o advogado aprovado mais proximo, compativel com as areas pedidas,
-- dentro do raio maximo. Distancia em km calculada no banco com PostGIS.

create or replace function public.match_nearest_lawyer(
  p_lat double precision,
  p_lng double precision,
  p_area_ids uuid[],
  p_max_radius_km double precision
)
returns table (
  lawyer_profile_id uuid,
  name text,
  whatsapp text,
  office_city text,
  office_state char(2),
  area_ids uuid[],
  distance_km numeric
)
language sql
stable
as $$
  with client_point as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    lp.id as lawyer_profile_id,
    p.name,
    lp.whatsapp,
    lp.office_city,
    lp.office_state,
    array_agg(distinct ls.specialty_id) as area_ids,
    round((st_distance(lp.office_location, cp.g) / 1000.0)::numeric, 3) as distance_km
  from public.lawyer_profiles lp
  join public.profiles p on p.id = lp.profile_id
  join public.lawyer_specialties ls on ls.lawyer_profile_id = lp.id
  cross join client_point cp
  where lp.status = 'approved'
    and lp.office_location is not null
    and ls.specialty_id = any (p_area_ids)
  group by lp.id, p.name, lp.whatsapp, lp.office_city, lp.office_state, lp.office_location, lp.updated_at, cp.g
  having st_distance(lp.office_location, cp.g) / 1000.0 <= p_max_radius_km
  order by st_distance(lp.office_location, cp.g) asc, lp.updated_at desc
  limit 1;
$$;
