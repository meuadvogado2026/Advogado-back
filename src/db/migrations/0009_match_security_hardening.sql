-- Advogado 2.0 - hardening de RPC e match
-- Aditiva: restringe execucao da RPC de convite, filtra perfis bloqueados no
-- match e usa pre-filtro geoespacial para aproveitar o indice GiST.

revoke execute on function public.activate_lawyer_profile_access(uuid, uuid, timestamptz) from public;
revoke execute on function public.activate_lawyer_profile_access(uuid, uuid, timestamptz) from anon;
revoke execute on function public.activate_lawyer_profile_access(uuid, uuid, timestamptz) from authenticated;
grant execute on function public.activate_lawyer_profile_access(uuid, uuid, timestamptz) to service_role;

create index if not exists lawyer_specialties_specialty_lawyer_idx
  on public.lawyer_specialties(specialty_id, lawyer_profile_id);

create index if not exists profiles_lawyer_unblocked_idx
  on public.profiles(id)
  where role = 'lawyer' and blocked_at is null;

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
    and p.blocked_at is null
    and lp.office_location is not null
    and lp.office_geocode_confidence = 'high'
    and lp.office_geocode_precision in ('street', 'manual')
    and ls.specialty_id = any (p_area_ids)
    and st_dwithin(lp.office_location, cp.g, p_max_radius_km * 1000.0)
  group by lp.id, p.name, lp.whatsapp, lp.office_city, lp.office_state, lp.office_location, lp.updated_at, cp.g
  order by st_distance(lp.office_location, cp.g) asc, lp.updated_at desc
  limit 1;
$$;
