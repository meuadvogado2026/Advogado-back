-- Spec 012 - catalogo geografico, disponibilidade e busca por cidade.

create table if not exists public.states (
  id uuid primary key default gen_random_uuid(),
  code char(2) not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  state_id uuid not null references public.states(id) on delete restrict,
  name text not null,
  normalized_name text not null,
  active boolean not null default true,
  center_location geography(Point, 4326) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state_id, normalized_name)
);

alter table public.lawyer_profiles
  add column if not exists service_city_id uuid references public.cities(id) on delete restrict,
  add column if not exists available_for_matches boolean not null default true;

create index if not exists states_active_name_idx on public.states(active, name);
create index if not exists cities_state_active_name_idx on public.cities(state_id, active, normalized_name);
create index if not exists lawyer_profiles_city_match_idx
  on public.lawyer_profiles(service_city_id, status, available_for_matches);

create or replace function public.match_lawyers_by_city(
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
  distance_from_city_center_km numeric,
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
    round((st_distance(lp.office_location, c.center_location) / 1000.0)::numeric, 3),
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
  group by lp.id, p.name, lp.whatsapp, c.name, s.code, lp.office_location, c.center_location
  order by st_distance(lp.office_location, c.center_location), lp.id
  limit greatest(1, least(p_limit, 5))
  offset greatest(0, p_offset);
$$;

-- Mantem o algoritmo GPS, adicionando somente o filtro de disponibilidade.
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
  select lp.id, p.name, lp.whatsapp, lp.office_city, lp.office_state,
    array_agg(distinct ls.specialty_id),
    round((st_distance(lp.office_location, cp.g) / 1000.0)::numeric, 3)
  from public.lawyer_profiles lp
  join public.profiles p on p.id = lp.profile_id
  join public.lawyer_specialties ls on ls.lawyer_profile_id = lp.id
  cross join client_point cp
  where lp.status = 'approved'
    and lp.available_for_matches = true
    and p.blocked_at is null
    and lp.office_location is not null
    and lp.office_geocode_confidence = 'high'
    and lp.office_geocode_precision in ('street', 'manual')
    and ls.specialty_id = any (p_area_ids)
    and st_dwithin(lp.office_location, cp.g, p_max_radius_km * 1000.0)
  group by lp.id, p.name, lp.whatsapp, lp.office_city, lp.office_state, lp.office_location, lp.updated_at, cp.g
  order by st_distance(lp.office_location, cp.g), lp.updated_at desc
  limit 1;
$$;

