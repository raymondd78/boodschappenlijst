-- Versie 1.3: nieuwe standaardlijst van {n} categorieën.
-- (gegenereerd door tools/build_seed.py — niet met de hand wijzigen)
--
-- Eén keer uitvoeren in de Supabase SQL Editor (bestaande database, na versie 1.2).
-- Per gezin dat nog de oude startcategorieën heeft:
--   * de {n} nieuwe categorieën komen erbij, in de volgorde van de looproute;
--   * artikelen uit de startdata krijgen hun nieuwe categorie, zelf toegevoegde
--     artikelen gaan van hun oude naar de bijpassende nieuwe categorie;
--   * zelf aangemaakte categorieën blijven bestaan (vóór het vangnet);
--   * de oude startcategorieën verdwijnen;
--   * de geleerde winkelvolgorde wordt gewist (die was op de oude indeling
--     gebaseerd); de app leert hem opnieuw bij het afvinken.
-- Het script is opnieuw uit te voeren: gezinnen die al over zijn, blijven ongemoeid.

-- 1. Startdata voor nieuwe gezinnen bijwerken
{seed}

-- 2. Bestaande gezinnen omzetten
do $$
declare
  fam record;
  fallback text := {fallback};
begin
  create temp table mig_new (name text primary key, position integer) on commit drop;
  insert into mig_new values
{new_vals};
  create temp table mig_old (old_name text primary key, new_name text) on commit drop;
  insert into mig_old values
{old_vals};

  for fam in
    select distinct c.family_id as id from public.categories c
    join mig_old o on lower(o.old_name) = lower(c.name)
    where lower(c.name) not in (select lower(name) from mig_new)
  loop
    -- nieuwe categorieën toevoegen (bestaat de naam al, dan die gebruiken)
    insert into public.categories (family_id, name, position)
      select fam.id, n.name, n.position from mig_new n
      where not exists (select 1 from public.categories c
                        where c.family_id = fam.id and lower(c.name) = lower(n.name));

    -- artikelen uit de startdata: categorie volgens de nieuwe startdata
    update public.items i set category_id = nc.id
      from public.tpl_items t
      join public.categories nc on nc.family_id = fam.id and lower(nc.name) = lower(t.category)
      where i.family_id = fam.id and lower(i.name) = lower(t.name)
        and (i.category_id is null or i.category_id in (
          select c.id from public.categories c join mig_old o on lower(o.old_name) = lower(c.name)
          where c.family_id = fam.id));

    -- overige artikelen in een oude categorie: naar de bijpassende nieuwe
    update public.items i set category_id = nc.id
      from public.categories oc
      join mig_old o on lower(o.old_name) = lower(oc.name)
      join public.categories nc on nc.family_id = fam.id and lower(nc.name) = lower(o.new_name)
      where oc.family_id = fam.id and i.category_id = oc.id;

    -- oude startcategorieën weg
    delete from public.categories c using mig_old o
      where c.family_id = fam.id and lower(c.name) = lower(o.old_name)
        and lower(c.name) not in (select lower(name) from mig_new);

    -- volgorde: nieuwe categorieën, dan eigen categorieën, vangnet als laatste
    with ordered as (
      select c.id, row_number() over (order by
               case when lower(c.name) = lower(fallback) then 3
                    when n.name is not null then 1 else 2 end,
               n.position, c.position, c.name) as pos
      from public.categories c
      left join mig_new n on lower(n.name) = lower(c.name)
      where c.family_id = fam.id)
    update public.categories c set position = o.pos from ordered o where o.id = c.id;

    -- geleerde volgorde hoorde bij de oude indeling
    delete from public.item_positions p using public.stores s
      where p.store_id = s.id and s.family_id = fam.id;

    raise notice 'Gezin % omgezet naar de nieuwe categorieën', fam.id;
  end loop;
end $$;
