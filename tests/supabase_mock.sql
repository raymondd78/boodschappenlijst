-- Bootst het deel van Supabase na dat schema.sql nodig heeft (alleen voor lokale tests)
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Geen default privileges: nieuwere Supabase-projecten geven tabellen niet meer automatisch vrij,
-- dus setup.sql moet de tabelrechten zelf geven.
create publication supabase_realtime;
