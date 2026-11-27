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
