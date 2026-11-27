-- Test van de migratie naar de 10 categorieën (versie 1.3) op een database van versie 1.1/1.2.
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

-- Gezin met de oude startcategorieën, een eigen categorie, een eigen artikel en geleerde volgorde
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is not null as _u \gset
select public.create_family('Raymond') is not null as _f \gset
select family_id as fam from members \gset
reset role;
\ir ../supabase/migraties/2026-11-27_lijstjes.sql
set role authenticated;
select pg_temp.check((select count(*) from categories) = 13, 'vooraf: 13 oude categorieën');
insert into categories (family_id, name, position) values (:'fam', 'Huisdier', 14);
insert into items (family_id, name, category_id)
  select :'fam', 'Eigen yoghurt', id from categories where name = 'Zuivel';
insert into items (family_id, name, category_id)
  select :'fam', 'Brokjes', id from categories where name = 'Huisdier';
insert into item_positions (store_id, item_id, family_id, pos)
  select s.id, i.id, :'fam', 1234 from stores s, items i where s.name = 'Lidl Siersteenlaan' and i.name = 'Bananen';
insert into list_entries (family_id, item_id) select :'fam', id from items where name = 'Schouderham';
reset role;

\ir ../supabase/migraties/2026-11-27_categorieen.sql
\ir ../supabase/migraties/2026-11-27_categorieen.sql
\ir ../supabase/migraties/2026-11-27_goedkeuren.sql
select pg_temp.check(pg_get_functiondef('public.approve_member(uuid)'::regprocedure) not like '%is_starter%', 'goedkeuren niet meer alleen door starter');

set role authenticated;
select pg_temp.check((select count(*) from categories) = 11, '10 nieuwe + 1 eigen categorie');
select pg_temp.check((select count(*) from categories where name in ('Zuivel', 'Overig', 'Brood', 'Water')) = 0, 'oude categorieën verdwenen');
select pg_temp.check((select string_agg(name, '|' order by position) from categories) =
  'Groente & fruit|Brood & bakkerij|Vlees, vis & vega|Zuivel, kaas & eieren|Ontbijt & beleg|Voorraadkast|Snoep, koek & chips|Dranken|Diepvries|Huisdier|Drogisterij & huishouden',
  'volgorde: nieuwe, eigen, vangnet laatst');
select pg_temp.check((select count(*) from items where category_id is null) = 0, 'alle artikelen hebben een categorie');
select pg_temp.check((select c.name from items i join categories c on c.id = i.category_id where i.name = 'Bananen') = 'Groente & fruit', 'Bananen → Groente & fruit');
select pg_temp.check((select c.name from items i join categories c on c.id = i.category_id where i.name = 'Zalmfilet zonder huid') = 'Vlees, vis & vega', 'Zalm → Vlees, vis & vega');
select pg_temp.check((select c.name from items i join categories c on c.id = i.category_id where i.name = 'Schouderham') = 'Zuivel, kaas & eieren', 'Schouderham → koeling (vleeswaren)');
select pg_temp.check((select c.name from items i join categories c on c.id = i.category_id where i.name = 'Eigen yoghurt') = 'Zuivel, kaas & eieren', 'eigen artikel → bijpassende nieuwe categorie');
select pg_temp.check((select c.name from items i join categories c on c.id = i.category_id where i.name = 'Brokjes') = 'Huisdier', 'eigen categorie blijft');
select pg_temp.check((select count(*) from item_positions) = 0, 'geleerde volgorde gewist');
select pg_temp.check((select count(*) from list_entries) = 1, 'lijst blijft staan');
reset role;

-- Daarna moet ook de volledige setup.sql nog zonder fouten lopen, en een nieuw gezin krijgt de 10
\ir ../supabase/setup.sql
set role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false) is not null as _u2 \gset
select public.create_family('Nieuw') is not null as _f2 \gset
select pg_temp.check((select count(*) from categories) = 10, 'nieuw gezin krijgt 10 categorieën');
select pg_temp.check((select count(*) from items where category_id is null) = 0, 'nieuw gezin: alle artikelen ingedeeld');
reset role;

\echo 'MIGRATIETEST CATEGORIEËN GESLAAGD'
