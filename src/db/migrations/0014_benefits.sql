-- Clube de beneficios exibido no painel do advogado.
-- Migration aditiva, sem dados destrutivos.

create table if not exists public.benefits (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  badge text,
  redemption_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benefits_title_length_check check (char_length(trim(title)) between 2 and 120),
  constraint benefits_description_length_check check (char_length(trim(description)) between 3 and 600),
  constraint benefits_badge_length_check check (badge is null or char_length(trim(badge)) <= 40),
  constraint benefits_redemption_url_https_check check (redemption_url is null or redemption_url ~ '^https://')
);

create index if not exists benefits_active_created_at_idx
  on public.benefits(active, created_at desc);

create index if not exists benefits_admin_created_at_idx
  on public.benefits(created_at desc);
