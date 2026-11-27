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
- Lijstjes (versie 1.2): tabel `lists` (naam uniek per gezin, hoofdletterongevoelig); `list_entries.list_id` (artikel één keer per lijst). Trigger `list_entries_check_list` controleert dat de lijst bij het gezin hoort en zet regels zonder lijst (oude app) in de oudste lijst. `finish_shopping(p_list, p_store, p_positions)` leegt alleen de kar van die lijst; de oude 2-argumentversie leegt alle karren. UI: `S.listId` (laatst geopend, `prefs`), `S.overview`; app opent altijd op het overzicht; dubbele naam → `uniqueListName` zet "(2)" erachter; minstens één lijst blijft; regels in de kar blijven zichtbaar op de lijst (`cartRow`) en tellen mee.
- Startdata: `tools/build_seed.py` → `supabase/seed.sql`, `supabase/setup.sql`, `js/seed.js`.

## Na elke wijziging

- `CACHE` in `sw.js` en `VERSION` in `js/app.js` ophogen.
- Tests: `node tests/test_order.mjs`, `tests/run_sql_tests.sh` (PostgreSQL 16; test ook de migratie vanaf `tests/setup_v1.1.sql`), `tests/ui_test.mjs` (headless Chrome).
- Schemawijziging: `schema.sql` aanpassen, `python3 tools/build_seed.py` draaien, en de wijziging ook als los migratiescript aanbieden voor de bestaande database.

## Genomen beslissingen

Zie de projectdocumentatie in claude.ai (`claude/CLAUDE.md`). Kort: zelf bouwen; GitHub + Supabase; Android, geen accounts; gezinscode van 4 letters met goedkeuring door de starter; meerdere winkels met geleerde volgorde; sorteren per categorie of winkelvolgorde; afvinken → kar (terug te zetten), "Klaar" leegt de kar; één notitie per artikel; iedereen beheert; badge voor wachtende leden; 12 Lidl-categorieën + Overig.
