-- Diagnostico somente leitura para a migration 0013.
-- Execute no Supabase SQL Editor e revise Planning Time / Execution Time.
-- Em tabelas pequenas, Seq Scan pode ser mais barato e nao indica falha do indice.

begin read only;
set local statement_timeout = '5s';

-- Confirma que os indices esperados existem sem consultar dados de usuarios.
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'profiles_admin_created_at_idx',
    'profiles_admin_role_created_at_idx',
    'profiles_admin_name_trgm_idx',
    'profiles_admin_email_trgm_idx',
    'profiles_admin_phone_trgm_idx',
    'lawyer_profiles_admin_created_at_idx',
    'lawyer_profiles_admin_status_created_at_idx',
    'lawyer_profiles_admin_oab_number_trgm_idx',
    'lawyer_profiles_admin_oab_state_trgm_idx',
    'lawyer_profiles_admin_office_city_trgm_idx',
    'lawyer_profiles_admin_office_state_trgm_idx',
    'prayer_requests_status_created_at_idx',
    'partner_logos_admin_created_at_idx'
  )
order by indexname;

explain (analyze, buffers, format text)
select id
from public.profiles
where name ilike '%admin%'
   or email ilike '%admin%'
   or phone ilike '%admin%'
   or role = 'admin'
order by created_at desc
limit 5;

explain (analyze, buffers, format text)
select id
from public.profiles
where name ilike '%SP%'
   or email ilike '%SP%'
limit 200;

explain (analyze, buffers, format text)
select id
from public.lawyer_profiles
where status = 'draft'
order by created_at desc
limit 5;

explain (analyze, buffers, format text)
select id
from public.lawyer_profiles
where oab_number ilike '%SP%'
   or (oab_state::text) ilike '%SP%'
   or office_city ilike '%SP%'
   or (office_state::text) ilike '%SP%'
order by created_at desc
limit 5;

explain (analyze, buffers, format text)
select id
from public.prayer_requests
where status = 'received'
order by created_at desc
limit 5;

explain (analyze, buffers, format text)
select id
from public.partner_logos
order by created_at desc
limit 5;

rollback;
