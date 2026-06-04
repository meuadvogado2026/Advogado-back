-- Admin users blocking
-- Migration aditiva, sem dados destrutivos.

alter table public.profiles
  add column if not exists blocked_at timestamptz null;

create index if not exists profiles_blocked_at_idx
  on public.profiles(blocked_at)
  where blocked_at is not null;
