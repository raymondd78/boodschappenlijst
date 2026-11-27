# CLAUDE.md — BoodschappenlijstApp

## Werkwijze (altijd volgen)

1. **Nooit direct beginnen met bouwen.** Eerst terugkoppelen: wat ik begrepen heb, welke aanpak ik voorstel en welke keuzes nog open staan.
2. **Eerst vragen stellen** om de opdracht scherp te krijgen.
3. **Pas bouwen als Raymond daar expliciet om vraagt** ("bouw het", "ga maar aan de slag" of vergelijkbaar).
4. **Elk antwoord eindigt met een advies over taalmodel en inspanning voor de volgende vraag.**
   - Haiku / laag: kleine tekstwijziging, naam of kleur aanpassen, korte vraag.
   - Sonnet / laag–middel: vragen beantwoorden, kleine aanpassing aan bestaande code, bug met duidelijke oorzaak.
   - Opus / middel–hoog: architectuurkeuze, grote refactor, lastige bug.

Communicatie, UI-teksten en documentatie in het Nederlands.

## Architectuur (versie 1.0)

- Vanilla JS (ES-modules), geen build-stap. PWA (`sw.js`, `manifest.webmanifest`).
- Supabase: anonieme inlog per toestel; RLS met `my_family()` (goedgekeurd lid). Schrijfacties op gezinsniveau via RPC: `create_family`, `join_family`, `approve_member`, `finish_shopping`.
- `js/api-supabase.js` en `js/api-demo.js` hebben dezelfde interface; de UI (`js/app.js`) weet niet welke actief is.
- Wijzigingen: optimistisch lokaal (`mutate`), daarna database; realtime-berichten triggeren een volledige herlaad (`refresh`). Verouderde herlaadresultaten worden genegeerd (`writeSeq`).
- Looproute: `item_positions` per winkel; zonder geleerde positie `categorie.position * 1000 + 500`. Leren in `js/order.js` (`learnPositions`, langste stijgende deelrij).
- Aantal per lijstregel: `list_entries.qty` (1–99). Lijst: − / + stepper (− bij 1 = verwijderen), opnieuw toevoegen = +1. Winkel en kar: `N×` achter de naam alleen bij ≥ 2; afvinken = hele aantal. Migraties voor bestaande databases in `supabase/migraties/`.
- Startdata: `tools/build_seed.py` → `supabase/seed.sql`, `supabase/setup.sql`, `js/seed.js`.

## Na elke wijziging

- `CACHE` in `sw.js` en `VERSION` in `js/app.js` ophogen.
- Tests: `node tests/test_order.mjs`, `tests/run_sql_tests.sh` (PostgreSQL 16), `tests/ui_test.mjs` (headless Chrome).
- Schemawijziging: `schema.sql` aanpassen, `python3 tools/build_seed.py` draaien, en de wijziging ook als los migratiescript aanbieden voor de bestaande database.

## Genomen beslissingen

Zie de projectdocumentatie in claude.ai (`claude/CLAUDE.md`). Kort: zelf bouwen; GitHub + Supabase; Android, geen accounts; gezinscode van 4 letters met goedkeuring door de starter; meerdere winkels met geleerde volgorde; sorteren per categorie of winkelvolgorde; afvinken → kar (terug te zetten), "Klaar" leegt de kar; één notitie per artikel; iedereen beheert; badge voor wachtende leden; 12 Lidl-categorieën + Overig.
