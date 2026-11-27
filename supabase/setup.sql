-- BoodschappenlijstApp — volledige installatie (schema + startdata)
-- Plak dit hele bestand in Supabase > SQL Editor en klik Run.

-- =====================================================================
-- BoodschappenlijstApp — databaseschema voor Supabase
-- Gebruikers loggen anoniem in (Supabase anonymous sign-in); elk toestel
-- krijgt zo een eigen gebruikers-id. Toegang tot gezinsdata loopt via
-- Row Level Security: alleen goedgekeurde gezinsleden zien/wijzigen data.
-- Het script is opnieuw uit te voeren zonder data te verliezen.
-- =====================================================================

-- ---------- Tabellen ----------

create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z]{4}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null unique,              -- één gezin per toestel
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  status      text not null default 'pending' check (status in ('pending', 'approved')),
  is_starter  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  position    integer not null default 0
);
create unique index if not exists categories_family_name on public.categories (family_id, lower(name));

create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  position    integer not null default 0
);
create unique index if not exists stores_family_name on public.stores (family_id, lower(name));

create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  category_id uuid references public.categories(id) on delete set null,
  use_count   integer not null default 0,
  last_used   timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists items_family_name on public.items (family_id, lower(name));

-- Geleerde positie van een artikel in een winkel (looproute)
create table if not exists public.item_positions (
  store_id    uuid not null references public.stores(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  pos         double precision not null,
  primary key (store_id, item_id)
);

-- Lijstjes (versie 1.2): een gezin kan meerdere lijsten hebben, elk met een eigen naam
create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now()
);
create unique index if not exists lists_family_name on public.lists (family_id, lower(name));

-- Wat er nu op een lijst of in de kar staat
create table if not exists public.list_entries (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  list_id       uuid not null references public.lists(id) on delete cascade,
  item_id       uuid not null references public.items(id) on delete cascade,
  note          text check (note is null or char_length(note) <= 120),
  qty           integer not null default 1 check (qty between 1 and 99),
  in_cart       boolean not null default false,
  cart_at       timestamptz,
  cart_store_id uuid references public.stores(id) on delete set null,
  added_at      timestamptz not null default now()
);
-- Aantal (versie 1.1): ook voor bestaande databases
alter table public.list_entries add column if not exists qty integer not null default 1 check (qty between 1 and 99);

-- Lijstjes (versie 1.2): bestaande databases bijwerken. Elk gezin zonder lijst krijgt
-- "Boodschappenlijst"; wat al op de lijst stond gaat daarin.
alter table public.list_entries add column if not exists list_id uuid references public.lists(id) on delete cascade;
insert into public.lists (family_id, name)
  select f.id, 'Boodschappenlijst' from public.families f
  where not exists (select 1 from public.lists l where l.family_id = f.id);
update public.list_entries e set list_id = (
    select l.id from public.lists l where l.family_id = e.family_id order by l.created_at, l.id limit 1)
  where e.list_id is null;
alter table public.list_entries alter column list_id set not null;
alter table public.list_entries drop constraint if exists list_entries_family_id_item_id_key;
create unique index if not exists list_entries_list_item on public.list_entries (list_id, item_id);
create index if not exists list_entries_family on public.list_entries (family_id);

-- Sjablonen voor nieuwe gezinnen (niet via de API leesbaar)
create table if not exists public.tpl_categories (name text primary key, position integer not null);
create table if not exists public.tpl_stores     (name text primary key, position integer not null);
create table if not exists public.tpl_items      (name text primary key, category text not null, use_count integer not null default 0);

-- ---------- Hulpfuncties ----------

-- Het gezin waarvan de ingelogde gebruiker goedgekeurd lid is (of null)
create or replace function public.my_family()
returns uuid language sql stable security definer set search_path = public as $$
  select family_id from public.members where user_id = auth.uid() and status = 'approved'
$$;

-- Het gezin waar de gebruiker lid van is of op goedkeuring wacht
create or replace function public.my_any_family()
returns uuid language sql stable security definer set search_path = public as $$
  select family_id from public.members where user_id = auth.uid()
$$;

create or replace function public.gen_family_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- zonder I en O (verwarring met 1/0)
  c text;
begin
  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.families where code = c);
  end loop;
  return c;
end $$;

-- Kar-tijdstip altijd door de server laten zetten (volgorde van afvinken)
create or replace function public.list_entries_cart_time()
returns trigger language plpgsql as $$
begin
  if new.in_cart and (tg_op = 'INSERT' or not old.in_cart) then
    new.cart_at := now();
  elsif not new.in_cart then
    new.cart_at := null;
    new.cart_store_id := null;
  end if;
  return new;
end $$;

drop trigger if exists list_entries_cart_time on public.list_entries;
create trigger list_entries_cart_time before insert or update on public.list_entries
  for each row execute function public.list_entries_cart_time();

-- Lijstregel hoort bij een lijst van hetzelfde gezin. Zonder lijst (oudere app-versie)
-- gaat de regel naar de oudste lijst van het gezin.
create or replace function public.list_entries_check_list()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.list_id is null then
    select id into new.list_id from public.lists
      where family_id = new.family_id order by created_at, id limit 1;
  elsif not exists (select 1 from public.lists where id = new.list_id and family_id = new.family_id) then
    raise exception 'Deze lijst hoort niet bij het gezin';
  end if;
  return new;
end $$;

drop trigger if exists list_entries_check_list on public.list_entries;
create trigger list_entries_check_list before insert or update of list_id, family_id on public.list_entries
  for each row execute function public.list_entries_check_list();

-- Na verwijderen van een lid: starter-rol doorgeven of leeg gezin opruimen
create or replace function public.members_after_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  next_user uuid;
begin
  if not exists (select 1 from public.members where family_id = old.family_id and status = 'approved') then
    delete from public.families where id = old.family_id;
  elsif old.is_starter then
    select user_id into next_user from public.members
      where family_id = old.family_id and status = 'approved'
      order by created_at limit 1;
    update public.members set is_starter = true where user_id = next_user;
  end if;
  return null;
end $$;

drop trigger if exists members_after_delete on public.members;
create trigger members_after_delete after delete on public.members
  for each row execute function public.members_after_delete();

-- ---------- RPC-functies (aangeroepen vanuit de app) ----------

-- Nieuw gezin starten; de aanroeper wordt starter. Vult startdata in.
create or replace function public.create_family(p_name text)
returns public.families language plpgsql security definer set search_path = public as $$
declare
  fam public.families;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Dit toestel hoort al bij een gezin';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Vul je naam in'; end if;

  insert into public.families (code) values (public.gen_family_code()) returning * into fam;
  insert into public.members (family_id, user_id, name, status, is_starter)
    values (fam.id, auth.uid(), btrim(p_name), 'approved', true);

  insert into public.lists (family_id, name) values (fam.id, 'Boodschappenlijst');
  insert into public.categories (family_id, name, position)
    select fam.id, name, position from public.tpl_categories;
  insert into public.stores (family_id, name, position)
    select fam.id, name, position from public.tpl_stores;
  insert into public.items (family_id, name, category_id, use_count)
    select fam.id, t.name, c.id, t.use_count
    from public.tpl_items t
    left join public.categories c on c.family_id = fam.id and c.name = t.category;
  return fam;
end $$;

-- Aanvraag om deel te nemen aan een gezin (wacht op goedkeuring van de starter)
create or replace function public.join_family(p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  fam_id uuid;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Dit toestel hoort al bij een gezin';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Vul je naam in'; end if;

  select id into fam_id from public.families where code = upper(btrim(p_code));
  if fam_id is null then raise exception 'Onbekende gezinscode'; end if;

  insert into public.members (family_id, user_id, name, status)
    values (fam_id, auth.uid(), btrim(p_name), 'pending');
  return fam_id;
end $$;

-- Wachtend lid goedkeuren (alleen de starter)
create or replace function public.approve_member(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Versie 1.3: elk goedgekeurd gezinslid mag wachtende leden goedkeuren
  if public.my_family() is null then
    raise exception 'Alleen goedgekeurde gezinsleden kunnen leden goedkeuren';
  end if;
  update public.members set status = 'approved'
    where user_id = p_user and family_id = public.my_family() and status = 'pending';
  if not found then raise exception 'Aanvraag niet gevonden'; end if;
end $$;

-- "Klaar": geleerde posities opslaan, gebruik tellen en de kar van één lijst leegmaken
-- p_list: de lijst (null = alle lijsten van het gezin)
-- p_positions: [{"item_id": "...", "pos": 1234.5}, ...]
create or replace function public.finish_shopping(p_list uuid, p_store uuid, p_positions jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  fam uuid := public.my_family();
  n integer;
begin
  if fam is null then raise exception 'Geen toegang'; end if;
  if p_list is not null and not exists (select 1 from public.lists where id = p_list and family_id = fam) then
    raise exception 'Lijst niet gevonden';
  end if;

  if p_store is not null and exists (select 1 from public.stores where id = p_store and family_id = fam) then
    insert into public.item_positions (store_id, item_id, family_id, pos)
      select p_store, i.id, fam, (e->>'pos')::double precision
      from jsonb_array_elements(coalesce(p_positions, '[]'::jsonb)) e
      join public.items i on i.id = (e->>'item_id')::uuid and i.family_id = fam
    on conflict (store_id, item_id) do update set pos = excluded.pos;
  end if;

  update public.items set use_count = use_count + 1, last_used = now()
    where family_id = fam
      and id in (select item_id from public.list_entries
                 where family_id = fam and in_cart and (p_list is null or list_id = p_list));

  delete from public.list_entries
    where family_id = fam and in_cart and (p_list is null or list_id = p_list);
  get diagnostics n = row_count;
  return n;
end $$;

-- Oude aanroep (versie 1.1, zonder lijst): kar van alle lijsten leegmaken
create or replace function public.finish_shopping(p_store uuid, p_positions jsonb)
returns integer language sql security definer set search_path = public as $$
  select public.finish_shopping(null::uuid, p_store, p_positions)
$$;

-- ---------- Rechten en Row Level Security ----------

alter table public.families       enable row level security;
alter table public.members        enable row level security;
alter table public.categories     enable row level security;
alter table public.stores         enable row level security;
alter table public.lists          enable row level security;
alter table public.items          enable row level security;
alter table public.item_positions enable row level security;
alter table public.list_entries   enable row level security;
alter table public.tpl_categories enable row level security;
alter table public.tpl_stores     enable row level security;
alter table public.tpl_items      enable row level security;

drop policy if exists families_select on public.families;
create policy families_select on public.families for select to authenticated
  using (id = public.my_any_family());

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (family_id = public.my_family() or user_id = auth.uid());

-- Iedereen in het gezin mag leden verwijderen; zelf vertrekken of aanvraag intrekken mag altijd
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using (family_id = public.my_family() or user_id = auth.uid());

-- Gezinsdata: volledige toegang voor goedgekeurde leden van dat gezin
do $$
declare t text;
begin
  foreach t in array array['categories', 'stores', 'lists', 'items', 'item_positions', 'list_entries'] loop
    execute format('drop policy if exists %I on public.%I', t || '_family', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (family_id = public.my_family())
         with check (family_id = public.my_family())', t || '_family', t);
  end loop;
end $$;

revoke all on public.tpl_categories, public.tpl_stores, public.tpl_items from anon, authenticated;
revoke insert, update on public.families, public.members from anon, authenticated;

-- Tabelrechten voor ingelogde gebruikers. Nieuwere Supabase-projecten zetten tabellen in
-- public niet meer automatisch open; zonder deze regels geeft Postgres "permission denied"
-- nog vóór de RLS-regels aan de beurt komen. RLS bepaalt daarna welke rijen zichtbaar zijn.
grant usage on schema public to authenticated;
grant select on public.families to authenticated;
grant select, delete on public.members to authenticated;
grant select, insert, update, delete
  on public.categories, public.stores, public.lists, public.items, public.item_positions, public.list_entries
  to authenticated;

revoke execute on function public.create_family(text)            from public, anon;
revoke execute on function public.join_family(text, text)        from public, anon;
revoke execute on function public.approve_member(uuid)           from public, anon;
revoke execute on function public.finish_shopping(uuid, jsonb)   from public, anon;
revoke execute on function public.finish_shopping(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.gen_family_code()              from public, anon, authenticated;
grant  execute on function public.create_family(text)            to authenticated;
grant  execute on function public.join_family(text, text)        to authenticated;
grant  execute on function public.approve_member(uuid)           to authenticated;
grant  execute on function public.finish_shopping(uuid, jsonb)   to authenticated;
grant  execute on function public.finish_shopping(uuid, uuid, jsonb) to authenticated;

-- ---------- Realtime (wijzigingen direct naar alle telefoons) ----------

do $$
declare t text;
begin
  foreach t in array array['members', 'categories', 'stores', 'lists', 'items', 'item_positions', 'list_entries'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- Startdata (gegenereerd door tools/build_seed.py — niet met de hand wijzigen)
-- Bron: 14 Lidl-bonnen aug–nov 2026. Wordt gekopieerd naar elk nieuw gezin.

truncate public.tpl_categories, public.tpl_stores, public.tpl_items;

insert into public.tpl_categories (name, position) values
  ('Groente & fruit', 1),
  ('Brood & bakkerij', 2),
  ('Vlees, vis & vega', 3),
  ('Zuivel, kaas & eieren', 4),
  ('Ontbijt & beleg', 5),
  ('Voorraadkast', 6),
  ('Snoep, koek & chips', 7),
  ('Dranken', 8),
  ('Diepvries', 9),
  ('Drogisterij & huishouden', 10);

insert into public.tpl_stores (name, position) values
  ('Lidl Siersteenlaan', 1),
  ('Lidl Eikenlaan', 2),
  ('Lidl Hoogkerk', 3);

insert into public.tpl_items (name, category, use_count) values
  ('Soja yoghurt', 'Zuivel, kaas & eieren', 9),
  ('Schouderham', 'Zuivel, kaas & eieren', 9),
  ('Magere kwark 1kg', 'Zuivel, kaas & eieren', 9),
  ('Scharreleieren 12st', 'Zuivel, kaas & eieren', 8),
  ('Halvarine', 'Zuivel, kaas & eieren', 7),
  ('Geitenkaas extra oud', 'Zuivel, kaas & eieren', 6),
  ('Geitenkaas belegen (per kg)', 'Zuivel, kaas & eieren', 6),
  ('Sperziebonen', 'Groente & fruit', 6),
  ('Belegen plakken', 'Zuivel, kaas & eieren', 6),
  ('Kandij-/gemberkoek', 'Ontbijt & beleg', 6),
  ('Aardbeienjam', 'Ontbijt & beleg', 5),
  ('Komkommer', 'Groente & fruit', 5),
  ('Vegan kruidenkaas', 'Zuivel, kaas & eieren', 5),
  ('Wortels', 'Groente & fruit', 5),
  ('Bananen', 'Groente & fruit', 5),
  ('Mini krieltjes BBQ', 'Groente & fruit', 5),
  ('Mineraalwater 1,5L bruisend', 'Dranken', 4),
  ('Kaiserbroodje (bake-off)', 'Brood & bakkerij', 4),
  ('Vers bladerdeeg', 'Brood & bakkerij', 4),
  ('Bio haverdrink', 'Zuivel, kaas & eieren', 4),
  ('Gevulde koek', 'Snoep, koek & chips', 4),
  ('Handsinaasappels', 'Groente & fruit', 4),
  ('Ontbijtspek rond', 'Vlees, vis & vega', 4),
  ('Paprika mix', 'Groente & fruit', 4),
  ('Tomatenblokjes', 'Voorraadkast', 3),
  ('Pannenkoekmix meergranen', 'Voorraadkast', 3),
  ('Saucijzenbroodje', 'Brood & bakkerij', 3),
  ('Cocktailgarnalen', 'Vlees, vis & vega', 3),
  ('Pistolet', 'Brood & bakkerij', 3),
  ('Wraps 8x20cm', 'Brood & bakkerij', 3),
  ('Aardappelen iets kruimig', 'Groente & fruit', 3),
  ('Appels Elstar (tas)', 'Groente & fruit', 3),
  ('Beschuit naturel', 'Ontbijt & beleg', 3),
  ('Biscuits duo''s vanille', 'Snoep, koek & chips', 3),
  ('Fuet extra', 'Zuivel, kaas & eieren', 3),
  ('Geitenkaas schijf naturel', 'Zuivel, kaas & eieren', 3),
  ('IJsbergsla', 'Groente & fruit', 3),
  ('Kokosyoghurt', 'Zuivel, kaas & eieren', 3),
  ('Lente-ui', 'Groente & fruit', 3),
  ('Mandarijnen', 'Groente & fruit', 3),
  ('Mini crackers', 'Snoep, koek & chips', 3),
  ('Ontbijtkoek ongesneden', 'Ontbijt & beleg', 3),
  ('Toiletpapier recycled', 'Drogisterij & huishouden', 3),
  ('Trostomaten', 'Groente & fruit', 3),
  ('Vlugge Japie', 'Snoep, koek & chips', 3),
  ('Kidneybonen', 'Voorraadkast', 2),
  ('Mais extra zoet', 'Voorraadkast', 2),
  ('Spinazie gewassen', 'Groente & fruit', 2),
  ('Tomato frito', 'Voorraadkast', 2),
  ('Zuurkool naturel', 'Voorraadkast', 2),
  ('Bio flespompoen', 'Groente & fruit', 2),
  ('Broccoli', 'Groente & fruit', 2),
  ('Feta', 'Zuivel, kaas & eieren', 2),
  ('Pindakaas Creamy', 'Ontbijt & beleg', 2),
  ('Schnittbroodje wit', 'Brood & bakkerij', 2),
  ('Vegan kipkrokante schnitzel', 'Vlees, vis & vega', 2),
  ('Walnoten honingbroodje', 'Brood & bakkerij', 2),
  ('Witlof', 'Groente & fruit', 2),
  ('Wraps naturel', 'Brood & bakkerij', 2),
  ('Augurken minder zout', 'Voorraadkast', 2),
  ('Bio maiswafels', 'Snoep, koek & chips', 2),
  ('Chips paprika XXL', 'Snoep, koek & chips', 2),
  ('Crackers luchtig', 'Snoep, koek & chips', 2),
  ('Frikandelbroodje XXL', 'Brood & bakkerij', 2),
  ('Gember', 'Groente & fruit', 2),
  ('Gouda belegen stuk', 'Zuivel, kaas & eieren', 2),
  ('Kastanjechampignons', 'Groente & fruit', 2),
  ('Kropsla met kluit', 'Groente & fruit', 2),
  ('Magere Franse kwark', 'Zuivel, kaas & eieren', 2),
  ('Multi Color sla', 'Groente & fruit', 2),
  ('Notenmix', 'Snoep, koek & chips', 2),
  ('PL kipstukjes HME', 'Vlees, vis & vega', 2),
  ('Partysauzen', 'Voorraadkast', 2),
  ('Peulen / sugar snaps', 'Groente & fruit', 2),
  ('Prei', 'Groente & fruit', 2),
  ('Premium muesli', 'Ontbijt & beleg', 2),
  ('Rucola sla', 'Groente & fruit', 2),
  ('Uien geel 1kg', 'Groente & fruit', 2),
  ('Vega balletjes', 'Vlees, vis & vega', 2),
  ('Vega kipreepjes', 'Vlees, vis & vega', 2),
  ('Verse boerenfriet', 'Groente & fruit', 2),
  ('Verse halfvolle melk', 'Zuivel, kaas & eieren', 2),
  ('Way to Go vegan rasp', 'Zuivel, kaas & eieren', 2),
  ('Zalmfilet zonder huid', 'Vlees, vis & vega', 2),
  ('Druivensap', 'Dranken', 1),
  ('Bio zuurkool met kruiden', 'Voorraadkast', 1),
  ('Amaryllisbol', 'Drogisterij & huishouden', 1),
  ('Aubergine', 'Groente & fruit', 1),
  ('Azijn', 'Voorraadkast', 1),
  ('Boerenkool', 'Groente & fruit', 1),
  ('Cherrytomaten', 'Groente & fruit', 1),
  ('Kamerplantenmix (potgrond)', 'Drogisterij & huishouden', 1),
  ('Pitabroodjes', 'Brood & bakkerij', 1),
  ('Unox Gelderse rookworst', 'Vlees, vis & vega', 1),
  ('Volkorenbol', 'Brood & bakkerij', 1),
  ('Amandelschaafsel', 'Voorraadkast', 1),
  ('Bio aardappel vastkokend', 'Groente & fruit', 1),
  ('Bio kikkererwten', 'Voorraadkast', 1),
  ('Bio sojadrink ongezoet', 'Zuivel, kaas & eieren', 1),
  ('Bio tofu', 'Vlees, vis & vega', 1),
  ('Biologische rozijnen', 'Voorraadkast', 1),
  ('Blauwe bessen (diepvries)', 'Diepvries', 1),
  ('Bockworst', 'Vlees, vis & vega', 1),
  ('Bolletje schuddebuikjes', 'Snoep, koek & chips', 1),
  ('Braadworsten XXL', 'Vlees, vis & vega', 1),
  ('Churros', 'Brood & bakkerij', 1),
  ('Citroenen', 'Groente & fruit', 1),
  ('Clipper groene thee lemon', 'Ontbijt & beleg', 1),
  ('Clipper thee lemon & ginger', 'Ontbijt & beleg', 1),
  ('Courgette', 'Groente & fruit', 1),
  ('Digestives naturel', 'Snoep, koek & chips', 1),
  ('Filet americain', 'Zuivel, kaas & eieren', 1),
  ('Frambozen', 'Groente & fruit', 1),
  ('Frans stokbrood', 'Brood & bakkerij', 1),
  ('Geitenkaas stuk (per kg)', 'Zuivel, kaas & eieren', 1),
  ('Gemarineerde BBQ worst', 'Vlees, vis & vega', 1),
  ('Gevriesdroogde kruiden', 'Voorraadkast', 1),
  ('Grapefruit', 'Groente & fruit', 1),
  ('Groentebouillonblokjes', 'Voorraadkast', 1),
  ('Hollandse aardbeien', 'Groente & fruit', 1),
  ('Ibuprofen gel', 'Drogisterij & huishouden', 1),
  ('Keukenmargarine 80%', 'Zuivel, kaas & eieren', 1),
  ('Keukenpapier 3-laags', 'Drogisterij & huishouden', 1),
  ('Kikkererwten', 'Voorraadkast', 1),
  ('Knoflook', 'Groente & fruit', 1),
  ('Kristalsuiker', 'Voorraadkast', 1),
  ('Limoenen', 'Groente & fruit', 1),
  ('Mango', 'Groente & fruit', 1),
  ('Notenmelange royal mix', 'Snoep, koek & chips', 1),
  ('PL chocoladevla', 'Zuivel, kaas & eieren', 1),
  ('PL verse burger', 'Vlees, vis & vega', 1),
  ('Paksoi', 'Groente & fruit', 1),
  ('Peren Conference', 'Groente & fruit', 1),
  ('Pindakaas', 'Ontbijt & beleg', 1),
  ('Pindakaas 100%', 'Ontbijt & beleg', 1),
  ('Poedersuiker', 'Voorraadkast', 1),
  ('Premium angus burger', 'Vlees, vis & vega', 1),
  ('Rijstnoedels mihoen', 'Voorraadkast', 1),
  ('Roze koeken XXL', 'Snoep, koek & chips', 1),
  ('Schenkstroop', 'Voorraadkast', 1),
  ('Sinaasappelsap 100%', 'Dranken', 1),
  ('Snackradijs', 'Groente & fruit', 1),
  ('Snacktomaten mix', 'Groente & fruit', 1),
  ('Snoeptomaten rood', 'Groente & fruit', 1),
  ('Speculaasbrokken', 'Snoep, koek & chips', 1),
  ('Spekreepjes', 'Vlees, vis & vega', 1),
  ('Spinazie deelblokjes', 'Diepvries', 1),
  ('Sushi', 'Zuivel, kaas & eieren', 1),
  ('Taartvulling', 'Voorraadkast', 1),
  ('Tijm', 'Groente & fruit', 1),
  ('Tortilla wraps XXL', 'Brood & bakkerij', 1),
  ('Uienpoeder', 'Voorraadkast', 1),
  ('Vanillestokjes', 'Snoep, koek & chips', 1),
  ('Vega shoarma 300g', 'Vlees, vis & vega', 1),
  ('Vegan paté', 'Zuivel, kaas & eieren', 1),
  ('Vegan pesto', 'Voorraadkast', 1),
  ('Vegetarische focaccia', 'Brood & bakkerij', 1),
  ('Vloeibare margarine', 'Zuivel, kaas & eieren', 1),
  ('Waspeen', 'Groente & fruit', 1),
  ('Witte champignons', 'Groente & fruit', 1),
  ('Zoete aardappel', 'Groente & fruit', 1),
  ('Zongedroogde tomaten', 'Voorraadkast', 1);
