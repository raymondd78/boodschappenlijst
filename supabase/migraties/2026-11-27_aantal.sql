-- Versie 1.1: aantal per artikel op de lijst.
-- Eén keer uitvoeren in de Supabase SQL-editor (bestaande database).
alter table public.list_entries
  add column if not exists qty integer not null default 1 check (qty between 1 and 99);
