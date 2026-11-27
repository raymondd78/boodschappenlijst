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

-- Wat er nu op de lijst of in de kar staat
create table if not exists public.list_entries (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  item_id       uuid not null references public.items(id) on delete cascade,
  note          text check (note is null or char_length(note) <= 120),
  in_cart       boolean not null default false,
  cart_at       timestamptz,
  cart_store_id uuid references public.stores(id) on delete set null,
  added_at      timestamptz not null default now(),
  unique (family_id, item_id)
);

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
  if not exists (select 1 from public.members
                 where user_id = auth.uid() and is_starter and status = 'approved') then
    raise exception 'Alleen de starter van het gezin kan leden goedkeuren';
  end if;
  update public.members set status = 'approved'
    where user_id = p_user and family_id = public.my_family() and status = 'pending';
  if not found then raise exception 'Aanvraag niet gevonden'; end if;
end $$;

-- "Klaar": geleerde posities opslaan, gebruik tellen en de kar leegmaken
-- p_positions: [{"item_id": "...", "pos": 1234.5}, ...]
create or replace function public.finish_shopping(p_store uuid, p_positions jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  fam uuid := public.my_family();
  n integer;
begin
  if fam is null then raise exception 'Geen toegang'; end if;

  if p_store is not null and exists (select 1 from public.stores where id = p_store and family_id = fam) then
    insert into public.item_positions (store_id, item_id, family_id, pos)
      select p_store, i.id, fam, (e->>'pos')::double precision
      from jsonb_array_elements(coalesce(p_positions, '[]'::jsonb)) e
      join public.items i on i.id = (e->>'item_id')::uuid and i.family_id = fam
    on conflict (store_id, item_id) do update set pos = excluded.pos;
  end if;

  update public.items set use_count = use_count + 1, last_used = now()
    where family_id = fam
      and id in (select item_id from public.list_entries where family_id = fam and in_cart);

  delete from public.list_entries where family_id = fam and in_cart;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Rechten en Row Level Security ----------

alter table public.families       enable row level security;
alter table public.members        enable row level security;
alter table public.categories     enable row level security;
alter table public.stores         enable row level security;
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
  foreach t in array array['categories', 'stores', 'items', 'item_positions', 'list_entries'] loop
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
  on public.categories, public.stores, public.items, public.item_positions, public.list_entries
  to authenticated;

revoke execute on function public.create_family(text)            from public, anon;
revoke execute on function public.join_family(text, text)        from public, anon;
revoke execute on function public.approve_member(uuid)           from public, anon;
revoke execute on function public.finish_shopping(uuid, jsonb)   from public, anon;
revoke execute on function public.gen_family_code()              from public, anon, authenticated;
grant  execute on function public.create_family(text)            to authenticated;
grant  execute on function public.join_family(text, text)        to authenticated;
grant  execute on function public.approve_member(uuid)           to authenticated;
grant  execute on function public.finish_shopping(uuid, jsonb)   to authenticated;

-- ---------- Realtime (wijzigingen direct naar alle telefoons) ----------

do $$
declare t text;
begin
  foreach t in array array['members', 'categories', 'stores', 'items', 'item_positions', 'list_entries'] loop
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
  ('Groente en fruit', 1),
  ('Brood', 2),
  ('Broodbeleg', 3),
  ('Bakproducten', 4),
  ('Kaas en vleeswaren', 5),
  ('Beschuit, ontbijtkoek e.d.', 6),
  ('Zuivel', 7),
  ('Schoonmaak', 8),
  ('Wc-papier', 9),
  ('Nootjes', 10),
  ('Diepvriesproducten', 11),
  ('Water', 12),
  ('Overig', 13);

insert into public.tpl_stores (name, position) values
  ('Lidl Siersteenlaan', 1),
  ('Lidl Eikenlaan', 2),
  ('Lidl Hoogkerk', 3);

insert into public.tpl_items (name, category, use_count) values
  ('Soja yoghurt', 'Zuivel', 9),
  ('Schouderham', 'Kaas en vleeswaren', 9),
  ('Magere kwark 1kg', 'Zuivel', 9),
  ('Scharreleieren 12st', 'Zuivel', 8),
  ('Halvarine', 'Zuivel', 7),
  ('Geitenkaas extra oud', 'Kaas en vleeswaren', 6),
  ('Geitenkaas belegen (per kg)', 'Kaas en vleeswaren', 6),
  ('Sperziebonen', 'Groente en fruit', 6),
  ('Belegen plakken', 'Kaas en vleeswaren', 6),
  ('Kandij-/gemberkoek', 'Beschuit, ontbijtkoek e.d.', 6),
  ('Aardbeienjam', 'Broodbeleg', 5),
  ('Komkommer', 'Groente en fruit', 5),
  ('Vegan kruidenkaas', 'Kaas en vleeswaren', 5),
  ('Wortels', 'Groente en fruit', 5),
  ('Bananen', 'Groente en fruit', 5),
  ('Mini krieltjes BBQ', 'Groente en fruit', 5),
  ('Mineraalwater 1,5L bruisend', 'Water', 4),
  ('Kaiserbroodje (bake-off)', 'Brood', 4),
  ('Vers bladerdeeg', 'Bakproducten', 4),
  ('Bio haverdrink', 'Zuivel', 4),
  ('Gevulde koek', 'Beschuit, ontbijtkoek e.d.', 4),
  ('Handsinaasappels', 'Groente en fruit', 4),
  ('Ontbijtspek rond', 'Kaas en vleeswaren', 4),
  ('Paprika mix', 'Groente en fruit', 4),
  ('Tomatenblokjes', 'Overig', 3),
  ('Pannenkoekmix meergranen', 'Bakproducten', 3),
  ('Saucijzenbroodje', 'Brood', 3),
  ('Cocktailgarnalen', 'Kaas en vleeswaren', 3),
  ('Pistolet', 'Brood', 3),
  ('Wraps 8x20cm', 'Brood', 3),
  ('Aardappelen iets kruimig', 'Groente en fruit', 3),
  ('Appels Elstar (tas)', 'Groente en fruit', 3),
  ('Beschuit naturel', 'Brood', 3),
  ('Biscuits duo''s vanille', 'Beschuit, ontbijtkoek e.d.', 3),
  ('Fuet extra', 'Kaas en vleeswaren', 3),
  ('Geitenkaas schijf naturel', 'Kaas en vleeswaren', 3),
  ('IJsbergsla', 'Groente en fruit', 3),
  ('Kokosyoghurt', 'Zuivel', 3),
  ('Lente-ui', 'Groente en fruit', 3),
  ('Mandarijnen', 'Groente en fruit', 3),
  ('Mini crackers', 'Beschuit, ontbijtkoek e.d.', 3),
  ('Ontbijtkoek ongesneden', 'Beschuit, ontbijtkoek e.d.', 3),
  ('Toiletpapier recycled', 'Wc-papier', 3),
  ('Trostomaten', 'Groente en fruit', 3),
  ('Vlugge Japie', 'Beschuit, ontbijtkoek e.d.', 3),
  ('Kidneybonen', 'Overig', 2),
  ('Mais extra zoet', 'Overig', 2),
  ('Spinazie gewassen', 'Groente en fruit', 2),
  ('Tomato frito', 'Overig', 2),
  ('Zuurkool naturel', 'Overig', 2),
  ('Bio flespompoen', 'Groente en fruit', 2),
  ('Broccoli', 'Groente en fruit', 2),
  ('Feta', 'Kaas en vleeswaren', 2),
  ('Pindakaas Creamy', 'Broodbeleg', 2),
  ('Schnittbroodje wit', 'Brood', 2),
  ('Vegan kipkrokante schnitzel', 'Kaas en vleeswaren', 2),
  ('Walnoten honingbroodje', 'Brood', 2),
  ('Witlof', 'Groente en fruit', 2),
  ('Wraps naturel', 'Brood', 2),
  ('Augurken minder zout', 'Overig', 2),
  ('Bio maiswafels', 'Beschuit, ontbijtkoek e.d.', 2),
  ('Chips paprika XXL', 'Nootjes', 2),
  ('Crackers luchtig', 'Beschuit, ontbijtkoek e.d.', 2),
  ('Frikandelbroodje XXL', 'Brood', 2),
  ('Gember', 'Groente en fruit', 2),
  ('Gouda belegen stuk', 'Kaas en vleeswaren', 2),
  ('Kastanjechampignons', 'Groente en fruit', 2),
  ('Kropsla met kluit', 'Groente en fruit', 2),
  ('Magere Franse kwark', 'Zuivel', 2),
  ('Multi Color sla', 'Groente en fruit', 2),
  ('Notenmix', 'Nootjes', 2),
  ('PL kipstukjes HME', 'Kaas en vleeswaren', 2),
  ('Partysauzen', 'Overig', 2),
  ('Peulen / sugar snaps', 'Groente en fruit', 2),
  ('Prei', 'Groente en fruit', 2),
  ('Premium muesli', 'Beschuit, ontbijtkoek e.d.', 2),
  ('Rucola sla', 'Groente en fruit', 2),
  ('Uien geel 1kg', 'Groente en fruit', 2),
  ('Vega balletjes', 'Kaas en vleeswaren', 2),
  ('Vega kipreepjes', 'Kaas en vleeswaren', 2),
  ('Verse boerenfriet', 'Groente en fruit', 2),
  ('Verse halfvolle melk', 'Zuivel', 2),
  ('Way to Go vegan rasp', 'Kaas en vleeswaren', 2),
  ('Zalmfilet zonder huid', 'Kaas en vleeswaren', 2),
  ('Druivensap', 'Overig', 1),
  ('Bio zuurkool met kruiden', 'Overig', 1),
  ('Amaryllisbol', 'Overig', 1),
  ('Aubergine', 'Groente en fruit', 1),
  ('Azijn', 'Overig', 1),
  ('Boerenkool', 'Groente en fruit', 1),
  ('Cherrytomaten', 'Groente en fruit', 1),
  ('Kamerplantenmix (potgrond)', 'Overig', 1),
  ('Pitabroodjes', 'Brood', 1),
  ('Unox Gelderse rookworst', 'Kaas en vleeswaren', 1),
  ('Volkorenbol', 'Brood', 1),
  ('Amandelschaafsel', 'Bakproducten', 1),
  ('Bio aardappel vastkokend', 'Groente en fruit', 1),
  ('Bio kikkererwten', 'Overig', 1),
  ('Bio sojadrink ongezoet', 'Zuivel', 1),
  ('Bio tofu', 'Kaas en vleeswaren', 1),
  ('Biologische rozijnen', 'Bakproducten', 1),
  ('Blauwe bessen (diepvries)', 'Diepvriesproducten', 1),
  ('Bockworst', 'Kaas en vleeswaren', 1),
  ('Bolletje schuddebuikjes', 'Beschuit, ontbijtkoek e.d.', 1),
  ('Braadworsten XXL', 'Kaas en vleeswaren', 1),
  ('Churros', 'Brood', 1),
  ('Citroenen', 'Groente en fruit', 1),
  ('Clipper groene thee lemon', 'Overig', 1),
  ('Clipper thee lemon & ginger', 'Overig', 1),
  ('Courgette', 'Groente en fruit', 1),
  ('Digestives naturel', 'Beschuit, ontbijtkoek e.d.', 1),
  ('Filet americain', 'Kaas en vleeswaren', 1),
  ('Frambozen', 'Groente en fruit', 1),
  ('Frans stokbrood', 'Brood', 1),
  ('Geitenkaas stuk (per kg)', 'Kaas en vleeswaren', 1),
  ('Gemarineerde BBQ worst', 'Kaas en vleeswaren', 1),
  ('Gevriesdroogde kruiden', 'Overig', 1),
  ('Grapefruit', 'Groente en fruit', 1),
  ('Groentebouillonblokjes', 'Overig', 1),
  ('Hollandse aardbeien', 'Groente en fruit', 1),
  ('Ibuprofen gel', 'Overig', 1),
  ('Keukenmargarine 80%', 'Zuivel', 1),
  ('Keukenpapier 3-laags', 'Schoonmaak', 1),
  ('Kikkererwten', 'Overig', 1),
  ('Knoflook', 'Groente en fruit', 1),
  ('Kristalsuiker', 'Bakproducten', 1),
  ('Limoenen', 'Groente en fruit', 1),
  ('Mango', 'Groente en fruit', 1),
  ('Notenmelange royal mix', 'Nootjes', 1),
  ('PL chocoladevla', 'Zuivel', 1),
  ('PL verse burger', 'Kaas en vleeswaren', 1),
  ('Paksoi', 'Groente en fruit', 1),
  ('Peren Conference', 'Groente en fruit', 1),
  ('Pindakaas', 'Broodbeleg', 1),
  ('Pindakaas 100%', 'Broodbeleg', 1),
  ('Poedersuiker', 'Bakproducten', 1),
  ('Premium angus burger', 'Kaas en vleeswaren', 1),
  ('Rijstnoedels mihoen', 'Overig', 1),
  ('Roze koeken XXL', 'Beschuit, ontbijtkoek e.d.', 1),
  ('Schenkstroop', 'Broodbeleg', 1),
  ('Sinaasappelsap 100%', 'Overig', 1),
  ('Snackradijs', 'Groente en fruit', 1),
  ('Snacktomaten mix', 'Groente en fruit', 1),
  ('Snoeptomaten rood', 'Groente en fruit', 1),
  ('Speculaasbrokken', 'Beschuit, ontbijtkoek e.d.', 1),
  ('Spekreepjes', 'Kaas en vleeswaren', 1),
  ('Spinazie deelblokjes', 'Diepvriesproducten', 1),
  ('Sushi', 'Kaas en vleeswaren', 1),
  ('Taartvulling', 'Bakproducten', 1),
  ('Tijm', 'Groente en fruit', 1),
  ('Tortilla wraps XXL', 'Brood', 1),
  ('Uienpoeder', 'Overig', 1),
  ('Vanillestokjes', 'Beschuit, ontbijtkoek e.d.', 1),
  ('Vega shoarma 300g', 'Kaas en vleeswaren', 1),
  ('Vegan paté', 'Kaas en vleeswaren', 1),
  ('Vegan pesto', 'Overig', 1),
  ('Vegetarische focaccia', 'Brood', 1),
  ('Vloeibare margarine', 'Zuivel', 1),
  ('Waspeen', 'Groente en fruit', 1),
  ('Witte champignons', 'Groente en fruit', 1),
  ('Zoete aardappel', 'Groente en fruit', 1),
  ('Zongedroogde tomaten', 'Overig', 1);
