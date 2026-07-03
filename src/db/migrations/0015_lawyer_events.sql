-- Eventos leves para insights do painel do advogado.
-- Nao armazena telefone, mensagem de WhatsApp, coordenada ou URL externa.

create table if not exists public.lawyer_events (
  id uuid primary key default gen_random_uuid(),
  lawyer_profile_id uuid not null references public.lawyer_profiles(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  source text not null default 'unknown',
  dedupe_key text,
  created_at timestamptz not null default now(),
  constraint lawyer_events_type_check check (event_type in ('profile_view', 'whatsapp_click')),
  constraint lawyer_events_source_check check (source in ('mobile', 'landing', 'admin', 'unknown')),
  constraint lawyer_events_dedupe_key_length_check check (dedupe_key is null or char_length(trim(dedupe_key)) between 8 and 160)
);

create index if not exists lawyer_events_lawyer_type_created_at_idx
  on public.lawyer_events(lawyer_profile_id, event_type, created_at desc);

create index if not exists lawyer_events_created_at_idx
  on public.lawyer_events(created_at desc);

create unique index if not exists lawyer_events_dedupe_key_unique_idx
  on public.lawyer_events(dedupe_key)
  where dedupe_key is not null;

alter table public.lawyer_events enable row level security;

create or replace function public.lawyer_event_counts(
  p_lawyer_profile_id uuid,
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  profile_views bigint,
  whatsapp_clicks bigint,
  contacts bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where event_type = 'profile_view') as profile_views,
    count(*) filter (where event_type = 'whatsapp_click') as whatsapp_clicks,
    count(*) filter (where event_type = 'whatsapp_click') as contacts
  from public.lawyer_events
  where lawyer_profile_id = p_lawyer_profile_id
    and created_at >= p_since;
$$;
