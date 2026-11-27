// Sorteren en leren van de looproute. Pure functies, zonder DOM of database.

const CATEGORY_STEP = 1000;          // afstand tussen categorieën op de looproute
const NO_CATEGORY_POSITION = 999;    // artikelen zonder categorie achteraan

/** Plek van een categorie op de route (1 = eerst). */
export function categoryPosition(item, categoriesById) {
  const cat = item.category_id ? categoriesById.get(item.category_id) : null;
  return cat ? cat.position : NO_CATEGORY_POSITION;
}

/**
 * Positie van een artikel in een winkel: de geleerde positie als die er is,
 * anders het midden van zijn categorie op de standaardroute.
 */
export function effectivePosition(item, storeId, positions, categoriesById) {
  const learned = storeId ? positions.get(storeId + '|' + item.id) : undefined;
  if (learned !== undefined) return learned;
  return categoryPosition(item, categoriesById) * CATEGORY_STEP + CATEGORY_STEP / 2;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });

/** Sorteer artikelen op looproute van een winkel. */
export function sortByStore(items, storeId, positions, categoriesById) {
  return items
    .map((it) => ({ it, p: effectivePosition(it, storeId, positions, categoriesById) }))
    .sort((a, b) => a.p - b.p || byName(a.it, b.it))
    .map((x) => x.it);
}

/** Groepeer artikelen per categorie (in route-volgorde), alfabetisch binnen de groep. */
export function groupByCategory(items, categoriesById) {
  const groups = new Map();
  for (const it of items) {
    const key = it.category_id && categoriesById.has(it.category_id) ? it.category_id : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      category: key ? categoriesById.get(key) : null,
      items: list.sort(byName),
    }))
    .sort((a, b) =>
      (a.category ? a.category.position : NO_CATEGORY_POSITION) -
      (b.category ? b.category.position : NO_CATEGORY_POSITION));
}

/**
 * Leer de looproute uit de volgorde van afvinken.
 *
 * sequence: artikel-id's in de volgorde waarin ze in de kar gingen.
 * posOf:    functie id -> huidige (effectieve) positie in deze winkel.
 *
 * Werkwijze: de langste reeks artikelen die al in de goede volgorde stond
 * (langste stijgende deelrij) houdt zijn positie. De overige artikelen worden
 * tussen hun buren in de afvinkvolgorde geplaatst. Zo verandert er zo weinig
 * mogelijk en klopt de route daarna met wat er echt gebeurde.
 *
 * Geeft [{item_id, pos}] terug voor alle artikelen in de reeks.
 */
export function learnPositions(sequence, posOf) {
  const ids = [...new Set(sequence)];
  const n = ids.length;
  if (n === 0) return [];
  const p = ids.map(posOf);

  // Langste strikt stijgende deelrij (O(n²) is ruim genoeg voor een boodschappenlijst)
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (p[j] < p[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[end]) end = i;
  const keep = new Array(n).fill(false);
  for (let k = end; k !== -1; k = prev[k]) keep[k] = true;

  // Artikelen buiten de deelrij tussen de vaste buren verdelen
  const out = p.slice();
  let i = 0;
  while (i < n) {
    if (keep[i]) { i++; continue; }
    let j = i;
    while (j < n && !keep[j]) j++;          // segment [i, j) moet geplaatst worden
    const m = j - i;
    const lo = i > 0 ? out[i - 1] : null;   // vaste buur ervoor
    const hi = j < n ? out[j] : null;       // vaste buur erna
    for (let k = 0; k < m; k++) {
      let v;
      if (lo !== null && hi !== null) v = lo + ((hi - lo) * (k + 1)) / (m + 1);
      else if (lo !== null) v = lo + (CATEGORY_STEP / 10) * (k + 1);
      else v = hi - (CATEGORY_STEP / 10) * (m - k);
      out[i + k] = v;
    }
    i = j;
  }
  return ids.map((id, k) => ({ item_id: id, pos: out[k] }));
}
