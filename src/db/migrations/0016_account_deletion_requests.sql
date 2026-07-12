-- Solicitações de exclusão: trilha operacional mínima, sem conteúdo sensível.
create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  requester_name text not null,
  requester_email text not null,
  requester_role public.profile_role not null,
  status text not null default 'requested' check (status in ('requested', 'in_review', 'completed')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by_profile_id uuid references public.profiles(id) on delete set null,
  unique (profile_id)
);

create index if not exists account_deletion_requests_open_due_idx
  on public.account_deletion_requests(status, due_at)
  where status <> 'completed';
