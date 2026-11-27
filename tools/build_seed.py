#!/usr/bin/env python3
"""Genereert de startdata (categorieën, winkels, artikelen) voor de app.

Bron: claude/lidl-aankopen-overzicht.md (14 Lidl-bonnen, aug–nov 2026).
Uitvoer:
  supabase/seed.sql  – vult de sjabloontabellen in Supabase
  js/seed.js         – dezelfde data voor de demomodus

Gebruik:  python3 tools/build_seed.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Standaardcategorieën (versie 1.3). Volgorde = startvolgorde van de looproute;
# daarna leert de app per artikel en per winkel uit het afvinken.
# De laatste categorie is het vangnet voor alles wat nergens anders past.
CATEGORIES = [
    "Groente & fruit",
    "Brood & bakkerij",
    "Vlees, vis & vega",
    "Zuivel, kaas & eieren",
    "Ontbijt & beleg",
    "Voorraadkast",
    "Snoep, koek & chips",
    "Dranken",
    "Diepvries",
    "Drogisterij & huishouden",
]
FALLBACK = CATEGORIES[-1]

STORES = ["Lidl Siersteenlaan", "Lidl Eikenlaan", "Lidl Hoogkerk"]

# Categorie op de bon -> standaardcategorie in de app
RECEIPT_MAP = {
    "Groente": "Groente & fruit",
    "Fruit": "Groente & fruit",
    "Brood & gebak": "Brood & bakkerij",
    "Kaas": "Zuivel, kaas & eieren",
    "Vlees, vis & vega": "Vlees, vis & vega",
    "Zuivel & eieren": "Zuivel, kaas & eieren",
    "Koek, snoep & snacks": "Snoep, koek & chips",
    "Voorraad & ontbijt": "Voorraadkast",
    "Dranken": "Dranken",
    "Non-food": "Drogisterij & huishouden",
}

# Uitzonderingen per artikel
OVERRIDES = {
    # vleeswaren en verse maaltijden uit de koeling
    "Schouderham": "Zuivel, kaas & eieren",
    "Fuet extra": "Zuivel, kaas & eieren",
    "Filet americain": "Zuivel, kaas & eieren",
    "Vegan paté": "Zuivel, kaas & eieren",
    "Sushi": "Zuivel, kaas & eieren",
    # ontbijt en beleg
    "Aardbeienjam": "Ontbijt & beleg",
    "Pindakaas Creamy": "Ontbijt & beleg",
    "Pindakaas": "Ontbijt & beleg",
    "Pindakaas 100%": "Ontbijt & beleg",
    "Premium muesli": "Ontbijt & beleg",
    "Beschuit naturel": "Ontbijt & beleg",
    "Ontbijtkoek ongesneden": "Ontbijt & beleg",
    "Kandij-/gemberkoek": "Ontbijt & beleg",
    "Clipper groene thee lemon": "Ontbijt & beleg",
    "Clipper thee lemon & ginger": "Ontbijt & beleg",
    # diepvries
    "Blauwe bessen (diepvries)": "Diepvries",
    "Spinazie deelblokjes": "Diepvries",
}

# Oude startcategorieën (tot en met versie 1.2) -> nieuwe, voor de migratie van
# artikelen die niet in de startdata voorkomen (zelf toegevoegd)
OLD_TO_NEW = {
    "Groente en fruit": "Groente & fruit",
    "Brood": "Brood & bakkerij",
    "Broodbeleg": "Ontbijt & beleg",
    "Bakproducten": "Voorraadkast",
    "Kaas en vleeswaren": "Zuivel, kaas & eieren",
    "Beschuit, ontbijtkoek e.d.": "Ontbijt & beleg",
    "Zuivel": "Zuivel, kaas & eieren",
    "Schoonmaak": "Drogisterij & huishouden",
    "Wc-papier": "Drogisterij & huishouden",
    "Nootjes": "Snoep, koek & chips",
    "Diepvriesproducten": "Diepvries",
    "Water": "Dranken",
    "Overig": "Drogisterij & huishouden",
}

# Niet als artikel overnemen
SKIP = {"Lidl tuintjes (gratis spaaractie)", "Greenbag (tas)"}

# Product | categorie op bon | keer gekocht
ITEMS_TXT = """
Soja yoghurt|Zuivel & eieren|9
Schouderham|Vlees, vis & vega|9
Magere kwark 1kg|Zuivel & eieren|9
Scharreleieren 12st|Zuivel & eieren|8
Halvarine|Zuivel & eieren|7
Geitenkaas extra oud|Kaas|6
Geitenkaas belegen (per kg)|Kaas|6
Sperziebonen|Groente|6
Belegen plakken|Kaas|6
Kandij-/gemberkoek|Koek, snoep & snacks|6
Aardbeienjam|Voorraad & ontbijt|5
Komkommer|Groente|5
Vegan kruidenkaas|Kaas|5
Wortels|Groente|5
Bananen|Fruit|5
Mini krieltjes BBQ|Groente|5
Mineraalwater 1,5L bruisend|Dranken|4
Kaiserbroodje (bake-off)|Brood & gebak|4
Vers bladerdeeg|Brood & gebak|4
Bio haverdrink|Zuivel & eieren|4
Gevulde koek|Koek, snoep & snacks|4
Handsinaasappels|Fruit|4
Ontbijtspek rond|Vlees, vis & vega|4
Paprika mix|Groente|4
Tomatenblokjes|Voorraad & ontbijt|3
Pannenkoekmix meergranen|Voorraad & ontbijt|3
Saucijzenbroodje|Brood & gebak|3
Cocktailgarnalen|Vlees, vis & vega|3
Pistolet|Brood & gebak|3
Wraps 8x20cm|Brood & gebak|3
Aardappelen iets kruimig|Groente|3
Appels Elstar (tas)|Fruit|3
Beschuit naturel|Brood & gebak|3
Biscuits duo's vanille|Koek, snoep & snacks|3
Fuet extra|Vlees, vis & vega|3
Geitenkaas schijf naturel|Kaas|3
IJsbergsla|Groente|3
Kokosyoghurt|Zuivel & eieren|3
Lente-ui|Groente|3
Mandarijnen|Fruit|3
Mini crackers|Koek, snoep & snacks|3
Ontbijtkoek ongesneden|Koek, snoep & snacks|3
Toiletpapier recycled|Non-food|3
Trostomaten|Groente|3
Vlugge Japie|Koek, snoep & snacks|3
Kidneybonen|Voorraad & ontbijt|2
Mais extra zoet|Voorraad & ontbijt|2
Spinazie gewassen|Groente|2
Tomato frito|Voorraad & ontbijt|2
Zuurkool naturel|Voorraad & ontbijt|2
Bio flespompoen|Groente|2
Broccoli|Groente|2
Feta|Kaas|2
Pindakaas Creamy|Voorraad & ontbijt|2
Schnittbroodje wit|Brood & gebak|2
Vegan kipkrokante schnitzel|Vlees, vis & vega|2
Walnoten honingbroodje|Brood & gebak|2
Witlof|Groente|2
Wraps naturel|Brood & gebak|2
Augurken minder zout|Voorraad & ontbijt|2
Bio maiswafels|Koek, snoep & snacks|2
Chips paprika XXL|Koek, snoep & snacks|2
Crackers luchtig|Koek, snoep & snacks|2
Frikandelbroodje XXL|Brood & gebak|2
Gember|Groente|2
Gouda belegen stuk|Kaas|2
Kastanjechampignons|Groente|2
Kropsla met kluit|Groente|2
Magere Franse kwark|Zuivel & eieren|2
Multi Color sla|Groente|2
Notenmix|Koek, snoep & snacks|2
PL kipstukjes HME|Vlees, vis & vega|2
Partysauzen|Voorraad & ontbijt|2
Peulen / sugar snaps|Groente|2
Prei|Groente|2
Premium muesli|Voorraad & ontbijt|2
Rucola sla|Groente|2
Uien geel 1kg|Groente|2
Vega balletjes|Vlees, vis & vega|2
Vega kipreepjes|Vlees, vis & vega|2
Verse boerenfriet|Groente|2
Verse halfvolle melk|Zuivel & eieren|2
Way to Go vegan rasp|Kaas|2
Zalmfilet zonder huid|Vlees, vis & vega|2
Druivensap|Dranken|1
Bio zuurkool met kruiden|Voorraad & ontbijt|1
Amaryllisbol|Non-food|1
Aubergine|Groente|1
Azijn|Voorraad & ontbijt|1
Boerenkool|Groente|1
Cherrytomaten|Groente|1
Kamerplantenmix (potgrond)|Non-food|1
Lidl tuintjes (gratis spaaractie)|Non-food|1
Pitabroodjes|Brood & gebak|1
Unox Gelderse rookworst|Vlees, vis & vega|1
Volkorenbol|Brood & gebak|1
Amandelschaafsel|Voorraad & ontbijt|1
Bio aardappel vastkokend|Groente|1
Bio kikkererwten|Voorraad & ontbijt|1
Bio sojadrink ongezoet|Zuivel & eieren|1
Bio tofu|Vlees, vis & vega|1
Biologische rozijnen|Voorraad & ontbijt|1
Blauwe bessen (diepvries)|Fruit|1
Bockworst|Vlees, vis & vega|1
Bolletje schuddebuikjes|Koek, snoep & snacks|1
Braadworsten XXL|Vlees, vis & vega|1
Churros|Brood & gebak|1
Citroenen|Fruit|1
Clipper groene thee lemon|Dranken|1
Clipper thee lemon & ginger|Dranken|1
Courgette|Groente|1
Digestives naturel|Koek, snoep & snacks|1
Filet americain|Vlees, vis & vega|1
Frambozen|Fruit|1
Frans stokbrood|Brood & gebak|1
Geitenkaas stuk (per kg)|Kaas|1
Gemarineerde BBQ worst|Vlees, vis & vega|1
Gevriesdroogde kruiden|Voorraad & ontbijt|1
Grapefruit|Fruit|1
Greenbag (tas)|Non-food|1
Groentebouillonblokjes|Voorraad & ontbijt|1
Hollandse aardbeien|Fruit|1
Ibuprofen gel|Non-food|1
Keukenmargarine 80%|Zuivel & eieren|1
Keukenpapier 3-laags|Non-food|1
Kikkererwten|Voorraad & ontbijt|1
Knoflook|Groente|1
Kristalsuiker|Voorraad & ontbijt|1
Limoenen|Fruit|1
Mango|Fruit|1
Notenmelange royal mix|Koek, snoep & snacks|1
PL chocoladevla|Zuivel & eieren|1
PL verse burger|Vlees, vis & vega|1
Paksoi|Groente|1
Peren Conference|Fruit|1
Pindakaas|Voorraad & ontbijt|1
Pindakaas 100%|Voorraad & ontbijt|1
Poedersuiker|Voorraad & ontbijt|1
Premium angus burger|Vlees, vis & vega|1
Rijstnoedels mihoen|Voorraad & ontbijt|1
Roze koeken XXL|Koek, snoep & snacks|1
Schenkstroop|Voorraad & ontbijt|1
Sinaasappelsap 100%|Dranken|1
Snackradijs|Groente|1
Snacktomaten mix|Groente|1
Snoeptomaten rood|Groente|1
Speculaasbrokken|Koek, snoep & snacks|1
Spekreepjes|Vlees, vis & vega|1
Spinazie deelblokjes|Groente|1
Sushi|Vlees, vis & vega|1
Taartvulling|Voorraad & ontbijt|1
Tijm|Groente|1
Tortilla wraps XXL|Brood & gebak|1
Uienpoeder|Voorraad & ontbijt|1
Vanillestokjes|Koek, snoep & snacks|1
Vega shoarma 300g|Vlees, vis & vega|1
Vegan paté|Vlees, vis & vega|1
Vegan pesto|Voorraad & ontbijt|1
Vegetarische focaccia|Brood & gebak|1
Vloeibare margarine|Zuivel & eieren|1
Waspeen|Groente|1
Witte champignons|Groente|1
Zoete aardappel|Groente|1
Zongedroogde tomaten|Voorraad & ontbijt|1
"""


def load_items():
    items = []
    for line in ITEMS_TXT.strip().splitlines():
        name, rcat, count = line.split("|")
        if name in SKIP:
            continue
        cat = OVERRIDES.get(name, RECEIPT_MAP[rcat])
        assert cat in CATEGORIES, (name, cat)
        items.append({"name": name, "category": cat, "use_count": int(count)})
    return items


def q(s):
    return "'" + s.replace("'", "''") + "'"


def write_migration(seed_sql):
    """Migratie naar de 10 categorieën (versie 1.3) voor een bestaande database."""
    new_vals = ",\n".join(f"    ({q(c)}, {i + 1})" for i, c in enumerate(CATEGORIES))
    old_vals = ",\n".join(f"    ({q(o)}, {q(n)})" for o, n in OLD_TO_NEW.items())
    body = MIGRATION_TEMPLATE.format(seed="\n".join(seed_sql), new_vals=new_vals,
                                     old_vals=old_vals, fallback=q(FALLBACK), n=len(CATEGORIES))
    (ROOT / "supabase" / "migraties" / "2026-11-27_categorieen.sql").write_text(body, encoding="utf-8")


MIGRATION_TEMPLATE = (ROOT / "tools" / "migratie_categorieen.sql.tpl").read_text(encoding="utf-8")


def main():
    items = load_items()
    sql = [
        "-- Startdata (gegenereerd door tools/build_seed.py — niet met de hand wijzigen)",
        "-- Bron: 14 Lidl-bonnen aug–nov 2026. Wordt gekopieerd naar elk nieuw gezin.",
        "",
        "truncate public.tpl_categories, public.tpl_stores, public.tpl_items;",
        "",
        "insert into public.tpl_categories (name, position) values",
        ",\n".join(f"  ({q(c)}, {i + 1})" for i, c in enumerate(CATEGORIES)) + ";",
        "",
        "insert into public.tpl_stores (name, position) values",
        ",\n".join(f"  ({q(s)}, {i + 1})" for i, s in enumerate(STORES)) + ";",
        "",
        "insert into public.tpl_items (name, category, use_count) values",
        ",\n".join(f"  ({q(it['name'])}, {q(it['category'])}, {it['use_count']})" for it in items) + ";",
        "",
    ]
    (ROOT / "supabase" / "seed.sql").write_text("\n".join(sql), encoding="utf-8")

    seed = {"categories": CATEGORIES, "stores": STORES, "items": items}
    js = (
        "// Startdata (gegenereerd door tools/build_seed.py — niet met de hand wijzigen)\n"
        "export const SEED = " + json.dumps(seed, ensure_ascii=False, indent=1) + ";\n"
    )
    (ROOT / "js" / "seed.js").write_text(js, encoding="utf-8")

    # Eén bestand om in de SQL-editor van Supabase te plakken
    schema = (ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8")
    (ROOT / "supabase" / "setup.sql").write_text(
        "-- BoodschappenlijstApp — volledige installatie (schema + startdata)\n"
        "-- Plak dit hele bestand in Supabase > SQL Editor en klik Run.\n\n"
        + schema + "\n\n" + "\n".join(sql),
        encoding="utf-8",
    )
    write_migration(sql)
    print(f"{len(CATEGORIES)} categorieën, {len(STORES)} winkels, {len(items)} artikelen")


if __name__ == "__main__":
    main()
