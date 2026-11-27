-- Lokale test van schema + RLS + functies. Draai met: tests/run_sql_tests.sh
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
end $$;

create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'TEST MISLUKT: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''

set role authenticated;

-- A start een gezin
select pg_temp.as_user(:A);
select code as fam_code from public.create_family('Raymond') \gset
select pg_temp.check(:'fam_code' ~ '^[A-Z]{4}$', 'gezinscode heeft 4 letters: ' || :'fam_code');
select set_config('test.fam_a', id::text, false) from families;
select pg_temp.check((select count(*) from categories) = 13, '13 startcategorieën');
select pg_temp.check((select count(*) from stores) = 3, '3 startwinkels');
select pg_temp.check((select count(*) from items) = 162, '162 startartikelen');
select pg_temp.check((select count(*) from items where category_id is null) = 0, 'alle artikelen hebben een categorie');
select pg_temp.check((select is_starter from members where user_id = :A), 'A is starter');

-- Tweede gezin aanmaken met hetzelfde toestel mag niet
do $$ begin
  perform public.create_family('Nog een');
  raise exception 'TEST MISLUKT: tweede gezin toegestaan';
exception when raise_exception then
  if sqlerrm like 'TEST MISLUKT%' then raise; end if;
  raise notice 'ok  tweede gezin geweigerd (%)', sqlerrm;
end $$;

-- B vraagt toegang
select pg_temp.as_user(:B);
select public.join_family(lower(:'fam_code'), 'Sanne') is not null as joined \gset
select pg_temp.check((select status from members where user_id = :B) = 'pending', 'B staat op wacht (code hoofdletterongevoelig)');
select pg_temp.check((select count(*) from items) = 0, 'wachtend lid ziet geen artikelen');
select pg_temp.check((select count(*) from families) = 1, 'wachtend lid ziet eigen gezin (code)');
do $$ begin
  insert into public.list_entries (family_id, item_id)
    select family_id, (select id from public.items limit 1) from public.members where user_id = auth.uid();
  raise exception 'TEST MISLUKT: wachtend lid kon schrijven';
exception when insufficient_privilege or not_null_violation then
  raise notice 'ok  wachtend lid kan niet schrijven';
end $$;

-- Onbekende code
select pg_temp.as_user(:C);
do $$ begin
  perform public.join_family('ZZZZ', 'X');
  raise exception 'TEST MISLUKT: onbekende code geaccepteerd';
exception when raise_exception then
  if sqlerrm like 'TEST MISLUKT%' then raise; end if;
  raise notice 'ok  onbekende code geweigerd (%)', sqlerrm;
end $$;

-- B kan zichzelf niet goedkeuren
select pg_temp.as_user(:B);
do $$ begin
  perform public.approve_member('bbbbbbbb-0000-0000-0000-000000000002');
  raise exception 'TEST MISLUKT: zelf goedkeuren';
exception when raise_exception then
  if sqlerrm like 'TEST MISLUKT%' then raise; end if;
  raise notice 'ok  zelf goedkeuren geweigerd';
end $$;
do $$ begin
  update public.members set status = 'approved' where user_id = auth.uid();
  raise exception 'TEST MISLUKT: status direct aangepast';
exception when insufficient_privilege then
  raise notice 'ok  status niet direct aan te passen';
end $$;

-- A ziet het wachtende lid en keurt goed
select pg_temp.as_user(:A);
select pg_temp.check((select count(*) from members where status = 'pending') = 1, 'starter ziet 1 wachtend lid');
select public.approve_member(:B);
select pg_temp.as_user(:B);
select pg_temp.check((select count(*) from items) = 162, 'goedgekeurd lid ziet artikelen');

-- C start eigen gezin en ziet niets van gezin A
select pg_temp.as_user(:C);
select public.create_family('Buurman') is not null as c_created \gset
select pg_temp.check((select count(*) from items) = 162, 'C ziet alleen eigen artikelen');
select pg_temp.check((select count(*) from members) = 1, 'C ziet alleen eigen leden');
do $$ begin
  insert into public.items (family_id, name) values (current_setting('test.fam_a')::uuid, 'Inbraak');
  raise exception 'TEST MISLUKT: C schreef in gezin A';
exception when insufficient_privilege then
  raise notice 'ok  C kan niet in gezin A schrijven';
end $$;

-- Lijst, kar en Klaar (als B)
select pg_temp.as_user(:B);
select family_id as fam from members where user_id = :B \gset
insert into list_entries (family_id, item_id, note)
  select :'fam', id, case when name = 'Bananen' then '2 trossen' end
  from items where name in ('Bananen', 'Soja yoghurt', 'Schouderham');
select pg_temp.check((select count(*) from list_entries) = 3, '3 artikelen op de lijst');
select id as store from stores where name = 'Lidl Siersteenlaan' \gset
update list_entries set in_cart = true, cart_store_id = :'store'
  where item_id in (select id from items where name in ('Bananen', 'Soja yoghurt'));
select pg_temp.check((select count(*) from list_entries where in_cart and cart_at is not null) = 2, 'kar-tijdstip door server gezet');
update list_entries set in_cart = false where item_id = (select id from items where name = 'Soja yoghurt');
select pg_temp.check((select cart_at is null and cart_store_id is null from list_entries
                      where item_id = (select id from items where name = 'Soja yoghurt')), 'terug uit de kar wist tijdstip');
update list_entries set in_cart = true, cart_store_id = :'store'
  where item_id = (select id from items where name = 'Soja yoghurt');

select public.finish_shopping(:'store',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'pos', 1234.5)) from items where name in ('Bananen', 'Soja yoghurt'))
) as removed \gset
select pg_temp.check(:removed = 2, 'Klaar verwijdert 2 artikelen uit de kar');
select pg_temp.check((select count(*) from list_entries) = 1, 'artikel dat niet in de kar zat blijft op de lijst');
select pg_temp.check((select count(*) from item_positions where store_id = :'store') = 2, 'posities opgeslagen');
select pg_temp.check((select use_count from items where name = 'Bananen') = 6, 'gebruiksteller opgehoogd');

-- C kan geen posities in winkel van A zetten
select pg_temp.as_user(:C);
select public.finish_shopping(:'store',
  (select jsonb_agg(jsonb_build_object('item_id', id, 'pos', 1)) from items limit 1)) as c_removed \gset
select pg_temp.as_user(:A);
select pg_temp.check((select count(*) from item_positions where pos = 1) = 0, 'C kan geen posities in gezin A zetten');

-- B verwijdert de starter A → B wordt starter
select pg_temp.as_user(:B);
delete from members where user_id = :A;
select pg_temp.check((select is_starter from members where user_id = :B), 'starter-rol overgedragen aan B');

-- B vertrekt als laatste → gezin wordt opgeruimd
delete from members where user_id = :B;
reset role;
select pg_temp.check((select count(*) from families where code = :'fam_code') = 0, 'leeg gezin opgeruimd');
select pg_temp.check((select count(*) from items where family_id = :'fam') = 0, 'data van leeg gezin opgeruimd');
select pg_temp.check((select count(*) from pg_publication_tables where pubname = 'supabase_realtime') = 6, 'realtime aan voor 6 tabellen');

\echo 'ALLE SQL-TESTS GESLAAGD'
