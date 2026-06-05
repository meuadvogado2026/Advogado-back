-- Acesso do advogado por convite Supabase Auth.
-- Migration aditiva: campos operacionais e RPC para vincular perfis legados ao auth.users.id.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists access_invited_at timestamptz null,
  add column if not exists first_login_completed_at timestamptz null;

create index if not exists profiles_access_invited_at_idx
  on public.profiles(access_invited_at)
  where access_invited_at is not null;

create or replace function public.activate_lawyer_profile_access(
  old_profile_id uuid,
  new_profile_id uuid,
  invited_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_profile public.profiles%rowtype;
begin
  select *
    into old_profile
    from public.profiles
   where id = old_profile_id
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if old_profile.role <> 'lawyer' then
    raise exception 'profile_not_lawyer';
  end if;

  update public.profiles
     set email = old_profile.email || '#legacy-' || old_profile.id::text,
         blocked_at = coalesce(old_profile.blocked_at, now()),
         updated_at = now()
   where id = old_profile.id;

  insert into public.profiles (
    id,
    role,
    name,
    email,
    phone,
    avatar_url,
    cover_url,
    blocked_at,
    must_change_password,
    access_invited_at,
    first_login_completed_at,
    created_at,
    updated_at
  )
  values (
    new_profile_id,
    old_profile.role,
    old_profile.name,
    old_profile.email,
    old_profile.phone,
    old_profile.avatar_url,
    old_profile.cover_url,
    old_profile.blocked_at,
    false,
    invited_at,
    null,
    old_profile.created_at,
    now()
  );

  update public.lawyer_profiles
     set profile_id = new_profile_id,
         updated_at = now()
   where profile_id = old_profile.id;
end;
$$;
