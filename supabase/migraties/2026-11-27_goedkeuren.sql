-- Versie 1.3: elk goedgekeurd gezinslid mag wachtende leden goedkeuren (was: alleen de starter).
-- Eén keer uitvoeren in de Supabase SQL Editor (bestaande database). Veilig om opnieuw te draaien.

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
