-- Meu Advogado 2.0 - seed de fixtures de match (coordenadas fixas) - spec 001
-- Decisao: semear coordenadas fixas agora, sem depender da UI admin nem do
-- geocoding real (spec 002). Aplicar manualmente no Supabase SQL Editor.
-- Idempotente: pode rodar mais de uma vez sem duplicar.

-- 1) Advogado aprovado em Sao Paulo (Av. Paulista), area civil + consumidor.
with sp_profile as (
  insert into public.profiles (role, name, email, phone)
  values ('lawyer', 'Dra. Ana Geo (fixture)', 'fixture-lawyer-sp@example.test', '11988887777')
  on conflict (email) do update set name = excluded.name
  returning id
),
sp_lawyer as (
  insert into public.lawyer_profiles (
    profile_id, status, oab_number, oab_state, whatsapp,
    office_cep, office_number, office_city, office_state,
    office_lat, office_lng, office_location,
    office_geocode_provider, office_geocode_precision, office_geocode_confidence, office_geocoded_at
  )
  select
    sp.id, 'approved', '654321', 'SP', '11988887777',
    '01310100', '1000', 'Sao Paulo', 'SP',
    -23.561414, -46.655881,
    st_setsrid(st_makepoint(-46.655881, -23.561414), 4326)::geography,
    'manual', 'manual', 'high', now()
  from sp_profile sp
  where not exists (
    select 1 from public.lawyer_profiles lp where lp.profile_id = sp.id
  )
  returning id
)
insert into public.lawyer_specialties (lawyer_profile_id, specialty_id, is_main)
select sp_lawyer.id, ls.id, ls.slug = 'civil'
from sp_lawyer
join public.legal_specialties ls on ls.slug in ('civil', 'consumidor')
on conflict do nothing;

-- 2) Advogado aprovado no Rio de Janeiro, area trabalhista (controle de area distinta).
with rj_profile as (
  insert into public.profiles (role, name, email, phone)
  values ('lawyer', 'Dr. Bruno Costa (fixture)', 'fixture-lawyer-rj@example.test', '21977776666')
  on conflict (email) do update set name = excluded.name
  returning id
),
rj_lawyer as (
  insert into public.lawyer_profiles (
    profile_id, status, oab_number, oab_state, whatsapp,
    office_cep, office_number, office_city, office_state,
    office_lat, office_lng, office_location,
    office_geocode_provider, office_geocode_precision, office_geocode_confidence, office_geocoded_at
  )
  select
    rj.id, 'approved', '112233', 'RJ', '21977776666',
    '20040002', '50', 'Rio de Janeiro', 'RJ',
    -22.906847, -43.172896,
    st_setsrid(st_makepoint(-43.172896, -22.906847), 4326)::geography,
    'manual', 'manual', 'high', now()
  from rj_profile rj
  where not exists (
    select 1 from public.lawyer_profiles lp where lp.profile_id = rj.id
  )
  returning id
)
insert into public.lawyer_specialties (lawyer_profile_id, specialty_id, is_main)
select rj_lawyer.id, ls.id, true
from rj_lawyer
join public.legal_specialties ls on ls.slug = 'trabalhista'
on conflict do nothing;

-- 3) Advogado aprovado em Brasilia (Samambaia Sul, DF), area civil + familia.
-- Coordenadas aproximadas do bairro (CEP 72309-601); ajustar via geocoding real (spec 002).
with df_profile as (
  insert into public.profiles (role, name, email, phone)
  values ('lawyer', 'Dra. Carla Lima (fixture)', 'fixture-lawyer-df@example.test', '61966665555')
  on conflict (email) do update set name = excluded.name
  returning id
),
df_lawyer as (
  insert into public.lawyer_profiles (
    profile_id, status, oab_number, oab_state, whatsapp,
    office_cep, office_number, office_city, office_state,
    office_lat, office_lng, office_location,
    office_geocode_provider, office_geocode_precision, office_geocode_confidence, office_geocoded_at
  )
  select
    df.id, 'approved', '778899', 'DF', '61966665555',
    '72309601', '10', 'Brasilia', 'DF',
    -15.878300, -48.087600,
    st_setsrid(st_makepoint(-48.087600, -15.878300), 4326)::geography,
    'nominatim', 'cep_centroid', 'medium', now()
  from df_profile df
  where not exists (
    select 1 from public.lawyer_profiles lp where lp.profile_id = df.id
  )
  returning id
)
insert into public.lawyer_specialties (lawyer_profile_id, specialty_id, is_main)
select df_lawyer.id, ls.id, ls.slug = 'civil'
from df_lawyer
join public.legal_specialties ls on ls.slug in ('civil', 'familia')
on conflict do nothing;
