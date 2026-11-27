// Demomodus: dezelfde functies als api-supabase.js, maar alles staat alleen
// in deze browser (localStorage). Handig om de app te proberen zonder Supabase.
import { SEED } from './seed.js';

const KEY = 'bl-demo-db';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const now = () => new Date().toISOString();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}

export function createDemoApi() {
  let db = load() || { me: uid(), families: [], members: [], categories: [], stores: [], items: [], item_positions: [], list_entries: [] };
  const listeners = new Set();
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(db));
    // andere tabbladen krijgen het via het storage-event; dit tabblad direct
    setTimeout(() => listeners.forEach((fn) => fn()), 0);
  };
  const fam = () => db.members.find((m) => m.user_id === db.me)?.family_id;
  const mine = (table) => db[table].filter((r) => r.family_id === fam());
  const fail = (msg) => { throw new Error(msg); };

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { db = load() || db; listeners.forEach((fn) => fn()); }
  });

  return {
    mode: 'demo',
    async init() { save(); return db.me; },
    get userId() { return db.me; },

    async membership() {
      const member = db.members.find((m) => m.user_id === db.me);
      if (!member) return null;
      return { member, family: db.families.find((f) => f.id === member.family_id) };
    },

    async createFamily(name) {
      if (fam()) fail('Dit toestel hoort al bij een gezin');
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
      const f = { id: uid(), code, created_at: now() };
      db.families.push(f);
      db.members.push({ family_id: f.id, user_id: db.me, name, status: 'approved', is_starter: true, created_at: now() });
      // Demo: een wachtend gezinslid, zodat goedkeuren te proberen is
      db.members.push({ family_id: f.id, user_id: uid(), name: 'Sanne (demo)', status: 'pending', is_starter: false, created_at: now() });
      const catIds = new Map();
      SEED.categories.forEach((name, i) => {
        const c = { id: uid(), family_id: f.id, name, position: i + 1 };
        catIds.set(name, c.id);
        db.categories.push(c);
      });
      SEED.stores.forEach((name, i) => db.stores.push({ id: uid(), family_id: f.id, name, position: i + 1 }));
      SEED.items.forEach((it) => db.items.push({
        id: uid(), family_id: f.id, name: it.name, category_id: catIds.get(it.category) || null,
        use_count: it.use_count, last_used: null, created_at: now(),
      }));
      save();
      return f;
    },

    async joinFamily() { fail('Deelnemen aan een gezin kan alleen als de app aan Supabase gekoppeld is'); },

    async approveMember(user) {
      const m = db.members.find((x) => x.user_id === user && x.family_id === fam());
      if (!m) fail('Aanvraag niet gevonden');
      m.status = 'approved';
      save();
    },

    async removeMember(user) {
      const m = db.members.find((x) => x.user_id === user);
      if (!m) return;
      db.members = db.members.filter((x) => x !== m);
      const rest = db.members.filter((x) => x.family_id === m.family_id && x.status === 'approved');
      if (!rest.length) {
        const id = m.family_id;
        for (const t of ['families']) db[t] = db[t].filter((r) => r.id !== id);
        for (const t of ['members', 'categories', 'stores', 'items', 'item_positions', 'list_entries']) db[t] = db[t].filter((r) => r.family_id !== id);
      } else if (m.is_starter) {
        rest.sort((a, b) => a.created_at.localeCompare(b.created_at))[0].is_starter = true;
      }
      save();
    },

    async loadAll() {
      return {
        members: mine('members'),
        categories: mine('categories').sort((a, b) => a.position - b.position),
        stores: mine('stores').sort((a, b) => a.position - b.position),
        items: mine('items'),
        positions: mine('item_positions'),
        entries: mine('list_entries').sort((a, b) => a.added_at.localeCompare(b.added_at)),
      };
    },

    async insert(table, row) {
      if (table === 'items' && mine('items').some((i) => i.name.toLowerCase() === row.name.toLowerCase())) fail('Dat artikel bestaat al');
      if (table === 'list_entries' && mine('list_entries').some((e) => e.item_id === row.item_id)) fail('Staat al op de lijst');
      const full = { id: uid(), family_id: fam(), ...row };
      if (table === 'items') Object.assign(full, { use_count: 0, last_used: null, created_at: now(), ...row });
      if (table === 'list_entries') Object.assign(full, { note: null, in_cart: false, cart_at: null, cart_store_id: null, added_at: now(), ...row });
      db[table].push(full);
      save();
      return full;
    },

    async update(table, id, patch) {
      const r = db[table].find((x) => x.id === id && x.family_id === fam());
      if (!r) return;
      if (table === 'list_entries') {
        if (patch.in_cart === true && !r.in_cart) patch = { ...patch, cart_at: now() };
        if (patch.in_cart === false) patch = { ...patch, cart_at: null, cart_store_id: null };
      }
      Object.assign(r, patch);
      save();
    },

    async remove(table, id) {
      db[table] = db[table].filter((x) => !(x.id === id && x.family_id === fam()));
      if (table === 'items') {
        db.list_entries = db.list_entries.filter((e) => e.item_id !== id);
        db.item_positions = db.item_positions.filter((p) => p.item_id !== id);
      }
      if (table === 'categories') db.items.forEach((i) => { if (i.category_id === id) i.category_id = null; });
      if (table === 'stores') {
        db.item_positions = db.item_positions.filter((p) => p.store_id !== id);
        db.list_entries.forEach((e) => { if (e.cart_store_id === id) e.cart_store_id = null; });
      }
      save();
    },

    async moveCategoryItems(fromId, toId) {
      mine('items').forEach((i) => { if (i.category_id === fromId) i.category_id = toId; });
      save();
    },

    async resetStorePositions(storeId) {
      db.item_positions = db.item_positions.filter((p) => p.store_id !== storeId);
      save();
    },

    async finishShopping(storeId, positions) {
      const f = fam();
      if (storeId) {
        for (const { item_id, pos } of positions) {
          const p = db.item_positions.find((x) => x.store_id === storeId && x.item_id === item_id);
          if (p) p.pos = pos; else db.item_positions.push({ store_id: storeId, item_id, family_id: f, pos });
        }
      }
      const cart = db.list_entries.filter((e) => e.family_id === f && e.in_cart);
      for (const e of cart) {
        const it = db.items.find((i) => i.id === e.item_id);
        if (it) { it.use_count += 1; it.last_used = now(); }
      }
      db.list_entries = db.list_entries.filter((e) => !cart.includes(e));
      save();
      return cart.length;
    },

    subscribe(onChange) { listeners.clear(); listeners.add(onChange); },

    /** Alleen in demo: alles wissen */
    reset() { localStorage.removeItem(KEY); },
  };
}
