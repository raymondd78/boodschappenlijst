// Test van sorteren en leren. Draai met: node tests/test_order.mjs
import assert from 'node:assert/strict';
import { learnPositions, sortByStore, groupByCategory, effectivePosition } from '../js/order.js';

const cats = new Map([
  ['groente', { id: 'groente', name: 'Groente en fruit', position: 1 }],
  ['brood', { id: 'brood', name: 'Brood', position: 2 }],
  ['zuivel', { id: 'zuivel', name: 'Zuivel', position: 7 }],
]);
const items = [
  { id: 'kwark', name: 'Kwark', category_id: 'zuivel' },
  { id: 'banaan', name: 'Bananen', category_id: 'groente' },
  { id: 'brood', name: 'Pistolet', category_id: 'brood' },
  { id: 'appel', name: 'Appels', category_id: 'groente' },
  { id: 'los', name: 'Iets zonder categorie', category_id: null },
];
const S = 'winkel1';
let positions = new Map();
const ordered = () => sortByStore(items, S, positions, cats).map((i) => i.id);

// Standaard: categorie-volgorde, alfabetisch binnen categorie, zonder categorie achteraan
assert.deepEqual(ordered(), ['appel', 'banaan', 'brood', 'kwark', 'los']);

// Groeperen per categorie
const groups = groupByCategory(items, cats);
assert.deepEqual(groups.map((g) => g.category?.name ?? null), ['Groente en fruit', 'Brood', 'Zuivel', null]);

// Leren: in deze winkel ligt het brood ná de kwark, en bananen vóór appels
function shop(sequence) {
  const posOf = (id) => effectivePosition(items.find((i) => i.id === id), S, positions, cats);
  for (const { item_id, pos } of learnPositions(sequence, posOf)) positions.set(S + '|' + item_id, pos);
}
shop(['banaan', 'appel', 'kwark', 'brood']);
const after1 = ordered().filter((id) => id !== 'los');
assert.deepEqual(after1, ['banaan', 'appel', 'kwark', 'brood'], 'route geleerd na één keer winkelen');

// Een volgende keer met minder artikelen verstoort de rest niet
shop(['appel', 'brood']);
assert.deepEqual(ordered().filter((id) => id !== 'los'), ['banaan', 'appel', 'kwark', 'brood']);

// Nieuw artikel (los) als eerste afgevinkt komt vooraan
shop(['los', 'banaan', 'kwark']);
assert.deepEqual(ordered(), ['los', 'banaan', 'appel', 'kwark', 'brood']);

// Andere winkel heeft eigen volgorde (nog standaard)
assert.deepEqual(sortByStore(items, 'winkel2', positions, cats).map((i) => i.id),
  ['appel', 'banaan', 'brood', 'kwark', 'los']);

// Randgevallen
assert.deepEqual(learnPositions([], () => 0), []);
assert.equal(learnPositions(['a'], () => 5)[0].pos, 5);
const rev = learnPositions(['c', 'b', 'a'], (id) => ({ a: 1, b: 2, c: 3 })[id]);
const sorted = [...rev].sort((x, y) => x.pos - y.pos).map((x) => x.item_id);
assert.deepEqual(sorted, ['c', 'b', 'a'], 'omgekeerde volgorde volledig geleerd');

console.log('ALLE ORDER-TESTS GESLAAGD');
