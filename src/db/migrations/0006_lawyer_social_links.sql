alter table public.lawyer_profiles
  add column if not exists instagram_url text,
  add column if not exists linkedin_url text,
  add column if not exists facebook_url text,
  add column if not exists website_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lawyer_profiles_instagram_url_https_check'
  ) then
    alter table public.lawyer_profiles
      add constraint lawyer_profiles_instagram_url_https_check
      check (instagram_url is null or instagram_url ~ '^https://');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lawyer_profiles_linkedin_url_https_check'
  ) then
    alter table public.lawyer_profiles
      add constraint lawyer_profiles_linkedin_url_https_check
      check (linkedin_url is null or linkedin_url ~ '^https://');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lawyer_profiles_facebook_url_https_check'
  ) then
    alter table public.lawyer_profiles
      add constraint lawyer_profiles_facebook_url_https_check
      check (facebook_url is null or facebook_url ~ '^https://');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lawyer_profiles_website_url_https_check'
  ) then
    alter table public.lawyer_profiles
      add constraint lawyer_profiles_website_url_https_check
      check (website_url is null or website_url ~ '^https://');
  end if;
end $$;
