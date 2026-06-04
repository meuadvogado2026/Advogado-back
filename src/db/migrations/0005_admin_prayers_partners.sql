-- Melhorias do painel admin: oracoes lidas e logos de parceiros.
-- Migration aditiva, sem dados destrutivos.

alter table if exists public.prayer_requests
  add column if not exists read_at timestamptz;

alter table if exists public.prayer_requests
  drop constraint if exists prayer_requests_status_check;

alter table if exists public.prayer_requests
  add constraint prayer_requests_status_check check (status in ('received', 'read'));

create table if not exists public.partner_logos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text not null,
  website_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_logos_logo_url_https_check check (logo_url ~ '^https://'),
  constraint partner_logos_website_url_https_check check (website_url is null or website_url ~ '^https://')
);

create index if not exists partner_logos_active_created_at_idx
  on public.partner_logos(active, created_at desc);
