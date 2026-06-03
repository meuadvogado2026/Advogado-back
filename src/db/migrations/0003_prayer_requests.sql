-- Spec 008 Parte 3 - pedidos de oracao
-- Migration aditiva, sem dados destrutivos.

create table if not exists public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  client_profile_id uuid null references public.profiles(id) on delete set null,
  message text not null,
  anonymous boolean not null default true,
  status text not null default 'received',
  created_at timestamptz not null default now(),
  constraint prayer_requests_status_check check (status in ('received')),
  constraint prayer_requests_message_length_check check (char_length(btrim(message)) between 20 and 500)
);

create index if not exists prayer_requests_created_at_idx
  on public.prayer_requests(created_at desc);

create index if not exists prayer_requests_client_profile_id_idx
  on public.prayer_requests(client_profile_id);
