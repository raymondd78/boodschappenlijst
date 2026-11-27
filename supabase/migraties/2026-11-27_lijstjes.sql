-- Versie 1.2: meerdere lijstjes per gezin.
-- Eén keer uitvoeren in de Supabase SQL Editor (bestaande database, na versie 1.1).
-- Elk gezin krijgt de lijst "Boodschappenlijst"; wat nu op de lijst of in de kar staat gaat daarin.
-- Het script is opnieuw uit te voeren zonder data te verliezen.

-- Lijstjes (versie 1.2): een gezin kan meerdere lijsten hebben, elk met een eigen naam
create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_at  timestamptz not null default now()
);
create unique index if not exists lists_family_name on public.lists (family_id, lower(name));

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

alter table public.lists enable row level security;
drop policy if exists lists_family on public.lists;
create policy lists_family on public.lists for all to authenticated
  using (family_id = public.my_family())
  with check (family_id = public.my_family());
grant select, insert, update, delete on public.lists to authenticated;

revoke execute on function public.finish_shopping(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.finish_shopping(uuid, uuid, jsonb) to authenticated;
grant  execute on function public.finish_shopping(uuid, jsonb)       to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lists') then
    alter publication supabase_realtime add table public.lists;
  end if;
end $$;
