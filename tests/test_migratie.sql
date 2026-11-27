-- Test van de migratie naar lijstjes (versie 1.2) op een database van versie 1.1.
-- Draai met: tests/run_sql_tests.sh
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'TEST MISLUKT: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

-- Vóór de migratie: gezin met twee regels op de lijst, één in de kar (versie 1.1)
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is not null as _u \gset
select public.create_family('Raymond') is not null as _f \gset
select family_id as fam from members \gset
insert into list_entries (family_id, item_id, qty) select :'fam', id, 2 from items where name = 'Bananen';
insert into list_entries (family_id, item_id, in_cart) select :'fam', id, true from items where name = 'Schouderham';
reset role;

\ir ../supabase/migraties/2026-11-27_lijstjes.sql
\ir ../supabase/migraties/2026-11-27_lijstjes.sql

select pg_temp.check((select count(*) from lists) = 1, 'migratie maakt één lijst');
select pg_temp.check((select name from lists) = 'Boodschappenlijst', 'lijst heet "Boodschappenlijst"');
select pg_temp.check((select count(*) from list_entries where list_id = (select id from lists)) = 2, 'bestaande regels in die lijst');
select pg_temp.check((select qty from list_entries e join items i on i.id = e.item_id where i.name = 'Bananen') = 2, 'aantal blijft bewaard');
select pg_temp.check((select in_cart from list_entries e join items i on i.id = e.item_id where i.name = 'Schouderham'), 'kar blijft bewaard');

-- Daarna moet ook de volledige setup.sql nog zonder fouten lopen
\ir ../supabase/setup.sql
select pg_temp.check((select count(*) from lists) = 1, 'setup.sql na migratie maakt geen extra lijst');

\echo 'MIGRATIETEST GESLAAGD'
