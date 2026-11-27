# Boodschappenlijst

Een gedeelde boodschappenlijst voor het gezin, als webapp op de telefoon (PWA).

- **Lijst**: snel toevoegen vanuit *vaak gekozen* artikelen of door te typen; sorteren per categorie of in winkelvolgorde. Eén notitie per artikel ("2 stuks", "de grote").
- **Winkelen**: kies de winkel, tik een artikel aan en het gaat in de kar (met *ongedaan maken*). De kar is te bekijken en artikelen kunnen er weer uit. **Klaar** leegt de kar.
- **Leert de looproute**: bij *Klaar* onthoudt de app per winkel in welke volgorde je hebt afgevinkt. De volgende keer staat de lijst in die volgorde.
- **Gedeeld**: de eerste gebruiker start een gezin en krijgt een code van 4 letters. Anderen vragen toegang met die code; de starter keurt goed (badge bij *Beheer*). Wijzigingen verschijnen direct op alle telefoons.
- **Startdata**: 13 categorieën in de looproute van Lidl Siersteenlaan, 3 Lidl-winkels en 162 artikelen uit 14 kassabonnen (aug–nov 2026), met hoe vaak ze gekocht zijn.

Techniek: HTML/CSS/JavaScript zonder build-stap, [Supabase](https://supabase.com) als database (gratis plan), anonieme inlog per toestel en Row Level Security voor de afscherming per gezin.

---

## Installatie

### 1. Database aanmaken in Supabase

1. Open je project *boodschappenlijst* op supabase.com.
2. Ga naar **SQL Editor → New query**.
3. Plak de volledige inhoud van [`supabase/setup.sql`](supabase/setup.sql) en klik **Run**.
   Het script maakt tabellen, beveiliging (RLS), functies en startdata aan. Je kunt het later opnieuw uitvoeren zonder dat er data verloren gaat.

### 2. Anonieme inlog aanzetten

**Authentication → Sign In / Providers → Allow anonymous sign-ins** aanzetten en opslaan.
Gezinsleden hebben zo geen account of wachtwoord nodig: elk toestel krijgt automatisch een eigen, onzichtbaar account.

### 3. Sleutels invullen

1. Ga naar **Project Settings → API** (of *Data API*).
2. Kopieer de **Project URL** en de **anon / publishable key**.
3. Vul ze in [`js/config.js`](js/config.js) in en commit de wijziging.

Deze sleutel mag openbaar zijn: hij geeft alleen toegang tot wat de RLS-regels toestaan. Gebruik **nooit** de *service_role* / *secret* key in de app.

### 4. Online zetten

**GitHub Pages**: *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*. De app staat dan op `https://raymondd78.github.io/boodschappenlijst/`.

> Let op: GitHub Pages werkt voor een **privé**-repository alleen met een betaald GitHub-abonnement (Pro/Team). Alternatieven:
> - de repository openbaar maken (er staan geen geheimen in), of
> - de privé-repository koppelen aan **Cloudflare Pages** of **Netlify** (beide gratis, geen build-commando nodig, publicatiemap = root).

### 5. Op de telefoon (Android)

Open de link in Chrome → menu **⋮ → App installeren** (of *Toevoegen aan startscherm*). De app opent daarna als een gewone app.

### 6. Eerste gebruik

1. Eén persoon kiest **Gezin starten** en vult een naam in. Bovenin staat de gezinscode.
2. De anderen kiezen **Meedoen met je gezin**, vullen de code en hun naam in.
3. De starter ziet een badge bij **Beheer** en tikt op **Goedkeuren**.

---

## Gebruik

| Scherm | Wat je doet |
|---|---|
| **Lijst** | Typ een deel van de naam en druk op Enter (pakt de beste match), of tik op een suggestie. Bestaat het artikel nog niet, kies dan *+ Nieuw artikel* en een categorie. Tik op een artikel voor notitie en categorie; × haalt het van de lijst. |
| **Winkelen** | Kies de winkel. Tik een artikel aan → in de kar. *Kar* toont wat je al hebt (↩ zet terug). *Klaar* leegt de kar en onthoudt de volgorde. |
| **Beheer** | Gezinscode en leden (goedkeuren, weigeren, verwijderen), winkels (toevoegen, hernoemen, geleerde volgorde wissen ↺), categorieën (volgorde = standaardroute, ↑↓), artikelen zoeken en wijzigen. |

Iedereen in het gezin mag leden verwijderen en winkels/categorieën/artikelen beheren; alleen de starter keurt nieuwe leden goed. Vertrekt de starter, dan gaat die rol naar het langst aanwezige lid.

### Zo leert de app de looproute

Elke winkel heeft per artikel een positie. Zonder geleerde positie geldt de volgorde van de categorieën (*Beheer → Categorieën*). Bij **Klaar** kijkt de app naar de volgorde waarin je hebt afgevinkt:

- de langste reeks artikelen die al in de goede volgorde stond, blijft staan;
- de andere artikelen worden verplaatst naar de plek tussen wat je ervoor en erna pakte.

Eén keer winkelen is genoeg om de volgorde van die artikelen over te nemen; een artikel dat je een keer te laat afvinkt, schuift de volgende keer weer terug. Per winkel is dit te wissen met ↺.

### Demomodus

Is `js/config.js` nog leeg, dan biedt de app een demo aan. Alles werkt dan, maar de gegevens staan alleen in die browser (inclusief een nep-gezinslid om goedkeuren te proberen). Met `?demo` achter de URL start de demo altijd.

---

## Bekende beperkingen (versie 1.0)

- **Zonder internet**: de laatst bekende lijst blijft zichtbaar, maar afvinken en toevoegen lukken pas weer met verbinding.
- **Toestel = account**: wie de app-gegevens van de browser wist of een andere browser gebruikt, moet opnieuw meedoen met de code (en opnieuw goedgekeurd worden).
- **Geen pushmeldingen**: wachtende leden zie je aan de badge in de app.

## Nieuwe versie uitrollen

Verhoog bij elke wijziging `CACHE` in [`sw.js`](sw.js) en `VERSION` in [`js/app.js`](js/app.js), anders blijven telefoons de oude versie uit de cache tonen.

Wijzig je de startdata, pas dan [`tools/build_seed.py`](tools/build_seed.py) aan en draai `python3 tools/build_seed.py`; dat maakt `supabase/seed.sql`, `supabase/setup.sql` en `js/seed.js` opnieuw. Startdata geldt alleen voor **nieuwe** gezinnen.

## Bestanden

```
index.html, css/, js/          de app
  js/app.js                    schermen en acties
  js/order.js                  sorteren en leren van de looproute
  js/api-supabase.js           data via Supabase
  js/api-demo.js               data in de browser (demomodus)
  js/config.js                 Supabase URL en sleutel
sw.js, manifest.webmanifest    installeerbare PWA
vendor/supabase.js             supabase-js 2.119.2 (meegeleverd, geen CDN nodig)
supabase/schema.sql            tabellen, RLS, functies
supabase/setup.sql             schema + startdata in één bestand (dit plak je in Supabase)
tools/build_seed.py            genereert de startdata
tests/                         tests (zie hieronder)
```

## Testen

```bash
node tests/test_order.mjs                       # sorteren en leren
tests/run_sql_tests.sh                          # database, met een lokale PostgreSQL 16
python3 -m http.server 8765 & node tests/ui_test.mjs   # hele app in headless Chrome (puppeteer-core nodig)
```
