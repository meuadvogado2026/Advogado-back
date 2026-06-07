-- Meu Advogado 2.0 - metadados de geocoding e match com distancia confiavel
-- Aditiva: campos novos podem ficar nulos; coordenadas sem metadado confiavel
-- deixam de ser elegiveis para distancia numerica no match.

alter table public.lawyer_profiles
  add column if not exists office_geocode_provider text,
  add column if not exists office_geocode_precision text,
  add column if not exists office_geocode_confidence text,
  add column if not exists office_geocoded_at timestamptz;

do $$
begin
  alter table public.lawyer_profiles
    add constraint lawyer_profiles_office_geocode_provider_check
    check (office_geocode_provider is null or office_geocode_provider in ('stub', 'nominatim', 'manual'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lawyer_profiles
    add constraint lawyer_profiles_office_geocode_precision_check
    check (office_geocode_precision is null or office_geocode_precision in ('cep_centroid', 'street', 'manual'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.lawyer_profiles
    add constraint lawyer_profiles_office_geocode_confidence_check
    check (office_geocode_confidence is null or office_geocode_confidence in ('high', 'medium', 'low'));
exception
  when duplicate_object then null;
end $$;

-- Fixtures tecnicas com coordenada fixa/manual: preserva o smoke SP exato sem
-- transformar dados reais legados em coordenada confirmada.
update public.lawyer_profiles lp
set office_geocode_provider = 'manual',
    office_geocode_precision = 'manual',
    office_geocode_confidence = 'high',
    office_geocoded_at = coalesce(lp.updated_at, now())
from public.profiles p
where p.id = lp.profile_id
  and p.email in ('fixture-lawyer-sp@example.test', 'fixture-lawyer-rj@example.test')
  and lp.office_location is not null
  and (lp.office_geocode_precision is null or lp.office_geocode_confidence is null);

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
    and lp.office_geocode_confidence = 'high'
    and lp.office_geocode_precision in ('street', 'manual')
    and ls.specialty_id = any (p_area_ids)
  group by lp.id, p.name, lp.whatsapp, lp.office_city, lp.office_state, lp.office_location, lp.updated_at, cp.g
  having st_distance(lp.office_location, cp.g) / 1000.0 <= p_max_radius_km
  order by st_distance(lp.office_location, cp.g) asc, lp.updated_at desc
  limit 1;
$$;
