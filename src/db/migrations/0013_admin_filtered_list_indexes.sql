-- Performance admin: suporte a listas paginadas e filtros server-side.
-- Migration aditiva, sem alteracao de dados ou contratos de API.

create extension if not exists pg_trgm;

create index if not exists profiles_admin_created_at_idx
  on public.profiles(created_at desc);

create index if not exists profiles_admin_role_created_at_idx
  on public.profiles(role, created_at desc);

create index if not exists profiles_admin_name_trgm_idx
  on public.profiles using gin (name gin_trgm_ops);

create index if not exists profiles_admin_email_trgm_idx
  on public.profiles using gin (email gin_trgm_ops);

create index if not exists profiles_admin_phone_trgm_idx
  on public.profiles using gin (phone gin_trgm_ops);

create index if not exists lawyer_profiles_admin_created_at_idx
  on public.lawyer_profiles(created_at desc);

create index if not exists lawyer_profiles_admin_status_created_at_idx
  on public.lawyer_profiles(status, created_at desc);

create index if not exists lawyer_profiles_admin_oab_number_trgm_idx
  on public.lawyer_profiles using gin (oab_number gin_trgm_ops);

create index if not exists lawyer_profiles_admin_oab_state_trgm_idx
  on public.lawyer_profiles using gin ((oab_state::text) gin_trgm_ops);

create index if not exists lawyer_profiles_admin_office_city_trgm_idx
  on public.lawyer_profiles using gin (office_city gin_trgm_ops);

create index if not exists lawyer_profiles_admin_office_state_trgm_idx
  on public.lawyer_profiles using gin ((office_state::text) gin_trgm_ops);

create index if not exists prayer_requests_status_created_at_idx
  on public.prayer_requests(status, created_at desc);

create index if not exists partner_logos_admin_created_at_idx
  on public.partner_logos(created_at desc);
