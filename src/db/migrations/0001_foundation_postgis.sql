-- Meu Advogado 2.0 - foundation migration draft
-- Status: versionado, NAO aplicado remotamente neste ciclo.

create extension if not exists pgcrypto;
create extension if not exists postgis;

do $$
begin
  create type public.profile_role as enum ('client', 'lawyer', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.lawyer_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'suspended');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  role public.profile_role not null,
  name text not null,
  email text not null unique,
  phone text,
  avatar_url text,
  cover_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legal_specialties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.lawyer_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status public.lawyer_status not null default 'draft',
  oab_number text not null,
  oab_state char(2) not null,
  whatsapp text not null,
  mini_bio text,
  full_bio text,
  office_cep text not null,
  office_street text,
  office_number text,
  office_neighborhood text,
  office_city text,
  office_state char(2),
  office_lat double precision,
  office_lng double precision,
  office_location geography(Point, 4326),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lawyer_specialties (
  lawyer_profile_id uuid not null references public.lawyer_profiles(id) on delete cascade,
  specialty_id uuid not null references public.legal_specialties(id),
  is_main boolean not null default false,
  primary key (lawyer_profile_id, specialty_id)
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  client_profile_id uuid references public.profiles(id),
  lawyer_profile_id uuid references public.lawyer_profiles(id),
  client_location geography(Point, 4326) not null,
  accuracy_m integer,
  specialty_ids uuid[] not null default '{}',
  distance_km numeric(10, 3),
  algorithm_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists lawyer_profiles_office_location_gix
  on public.lawyer_profiles using gist (office_location);

create index if not exists lawyer_profiles_status_idx
  on public.lawyer_profiles(status);

insert into public.legal_specialties (slug, name)
values
  ('civil', 'Direito Civil'),
  ('trabalhista', 'Direito Trabalhista'),
  ('familia', 'Direito de Família'),
  ('previdenciario', 'Direito Previdenciário'),
  ('criminal', 'Direito Criminal'),
  ('consumidor', 'Direito do Consumidor'),
  ('empresarial', 'Direito Empresarial'),
  ('tributario', 'Direito Tributário')
on conflict (slug) do update
set name = excluded.name,
    active = true;
