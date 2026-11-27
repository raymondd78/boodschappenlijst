// Boodschappenlijst — gebruikersinterface
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createSupabaseApi } from './api-supabase.js';
import { createDemoApi } from './api-demo.js';
import { sortByStore, groupByCategory, effectivePosition, learnPositions } from './order.js';

const VERSION = '1.3.0';
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet-root');
const $toast = document.getElementById('toast-root');

// ---------- Hulpjes ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
const plural = (n, one, more) => `${n} ${n === 1 ? one : more}`;
const tmpId = () => 'tmp-' + Math.random().toString(36).slice(2);
const nowIso = () => new Date().toISOString();
const qtyOf = (e) => Math.max(1, Number(e?.qty) || 1);
/** Duidelijk aantal achter de naam, alleen bij 2 of meer */
const qtyBadge = (e) => (qtyOf(e) > 1 ? ` <span class="qty-badge">${qtyOf(e)}×</span>` : '');
const MAX_QTY = 99;

const prefs = {
  get(k, d) { try { const v = localStorage.getItem('bl-pref-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bl-pref-' + k, JSON.stringify(v)); } catch { /* vol of privé */ } },
};

const ICON = {
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2.2l2.3 11h10.3l2-8H6.3"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="16.5" cy="19.5" r="1.4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
};

// ---------- Toestand ----------

const S = {
  api: null,
  membership: null,   // {member, family} | null
  data: null,         // gezinsdata, zie setData()
  offline: false,
  tab: prefs.get('tab', 'lijst'),
  sortMode: prefs.get('sort', 'categorie'),
  storeId: prefs.get('store', null),
  listId: prefs.get('list', null),   // huidige (laatst geopende) lijst
  overview: true,                    // lijstoverzicht tonen op het tabblad Lijst
  search: '',
  manageSearch: '',
  showMoreFav: false,
  wasMember: false,
};

function setData(raw) {
  const d = {
    members: raw.members,
    categories: [...raw.categories].sort((a, b) => a.position - b.position),
    stores: [...raw.stores].sort((a, b) => a.position - b.position),
    lists: [...(raw.lists || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    items: raw.items,
    entries: raw.entries,
    positionRows: raw.positions,
  };
  if (!d.lists.some((l) => l.id === S.listId)) {
    // Lijst verdwenen (bijv. door een ander gezinslid verwijderd): terug naar het overzicht
    if (S.listId && S.data) S.overview = true;
    S.listId = d.lists[0]?.id ?? null;
  }
  reindex(d);
  S.data = d;
  if (!d.stores.some((s) => s.id === S.storeId)) S.storeId = d.stores[0]?.id ?? null;
}

function reindex(d = S.data) {
  d.catsById = new Map(d.categories.map((c) => [c.id, c]));
  d.itemsById = new Map(d.items.map((i) => [i.id, i]));
  d.positions = new Map(d.positionRows.map((p) => [p.store_id + '|' + p.item_id, p.pos]));
  // artikel → regel op de huidige lijst
  d.entryByItem = new Map(d.entries.filter((e) => e.list_id === S.listId).map((e) => [e.item_id, e]));
}

const me = () => S.membership?.member;
const familyId = () => S.membership?.family?.id;
/** Alle regels van een lijst (ook die in de kar) */
const entriesOf = (listId) => S.data.entries.filter((e) => e.list_id === listId && S.data.itemsById.has(e.item_id));
const curEntries = () => entriesOf(S.listId);
const listEntries = () => curEntries().filter((e) => !e.in_cart);
const cartEntries = () => curEntries().filter((e) => e.in_cart)
  .sort((a, b) => String(a.cart_at).localeCompare(String(b.cart_at)));
const currentList = () => S.data.lists.find((l) => l.id === S.listId) ?? null;
const DEFAULT_LIST_NAME = 'Boodschappenlijst';

/** Bestaat de naam al, dan "(2)", "(3)" … erachter */
function uniqueListName(name, exceptId = null) {
  const taken = new Set(S.data.lists.filter((l) => l.id !== exceptId).map((l) => norm(l.name)));
  if (!taken.has(norm(name))) return name;
  const base = name.replace(/\s*\(\d+\)$/, '').slice(0, 54);
  for (let n = 2; ; n++) {
    const c = `${base} (${n})`;
    if (!taken.has(norm(c))) return c;
  }
}

function shortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'vandaag';
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}
const pendingMembers = () => (S.data?.members || []).filter((m) => m.status === 'pending');
/** Vangnetcategorie voor wat nergens anders past: "Overig" (oud), anders "Drogisterij & huishouden", anders de laatste */
const FALLBACK_NAMES = ['overig', 'drogisterij & huishouden'];
const fallbackCategory = () => {
  for (const n of FALLBACK_NAMES) { const c = S.data.categories.find((x) => norm(x.name) === n); if (c) return c; }
  return S.data.categories[S.data.categories.length - 1];
};
const storeName = (id) => S.data.stores.find((s) => s.id === id)?.name ?? '';

// ---------- Cache (laatst bekende lijst, ook zonder verbinding) ----------

const cacheKey = () => 'bl-cache-' + (S.api?.mode || 'x');
function cacheSave() {
  try {
    if (!S.data) { localStorage.removeItem(cacheKey()); return; }
    const { members, categories, stores, lists, items, entries, positionRows } = S.data;
    localStorage.setItem(cacheKey(), JSON.stringify({
      membership: S.membership, data: { members, categories, stores, lists, items, entries, positions: positionRows },
    }));
  } catch { /* niet erg */ }
}
function cacheLoad() {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey()));
    if (c?.membership && c.data) { S.membership = c.membership; setData(c.data); return true; }
  } catch { /* leeg */ }
  return false;
}

// ---------- Verversen en wijzigen ----------

let refreshTimer = null;
let pendingWrites = 0;
let writeSeq = 0;        // telt wijzigingen; verouderde verversingen worden genegeerd

function scheduleRefresh(delay = 250) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, delay);
}

async function refresh() {
  if (pendingWrites > 0) return scheduleRefresh(400);
  const seq = writeSeq;
  try {
    if (!navigator.onLine) throw new Error('Geen verbinding');
    if (queue.length && !(await flushQueue())) throw new Error('Geen verbinding (wachtrij)');
    const m = await S.api.membership();
    const raw = m && m.member.status === 'approved' ? await S.api.loadAll() : null;
    // Tijdens het ophalen iets gewijzigd? Dan is dit resultaat verouderd.
    if (seq !== writeSeq || pendingWrites > 0) return scheduleRefresh(300);
    if (S.wasMember && !m) toast('Je bent geen lid meer van dit gezin');
    S.membership = m;
    S.wasMember = !!raw;
    if (raw) { applyQueue(raw.entries); setData(raw); } else S.data = null;
    S.offline = false;
    cacheSave();
  } catch (e) {
    console.warn(e);
    S.offline = true;
    if (!S.data && !S.membership) return renderError('Kan de gegevens niet ophalen', e);
  }
  render();
}

/** Lokaal direct aanpassen (snel), daarna naar de database; bij fout terugdraaien via verversen. */
async function mutate(local, remote, errorText) {
  writeSeq++;
  if (local) { local(); reindex(); render(); }
  pendingWrites++;
  try {
    await remote();
  } catch (e) {
    console.warn(e);
    toast(errorText ? `${errorText}: ${e.message}` : e.message, { error: true });
  } finally {
    pendingWrites--;
    scheduleRefresh(150);
  }
}

// ---------- Telefoonfuncties: trillen, scherm aan, delen ----------

/** Korte trilling als bevestiging (doet niets als het toestel het niet kan) */
function vibrate(ms = 30) { try { navigator.vibrate?.(ms); } catch { /* niet ondersteund */ } }

// Scherm aan houden zolang het tabblad Winkelen open is
let wakeLock = null;
async function syncWakeLock() {
  const want = S.tab === 'winkelen' && !document.hidden && !!S.data;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = 'pending';
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      if (!(S.tab === 'winkelen' && !document.hidden)) { wakeLock = null; lock.release(); }
    } else if (!want && wakeLock && wakeLock !== 'pending') {
      const lock = wakeLock; wakeLock = null; await lock.release();
    }
  } catch (e) {
    if (wakeLock === 'pending') wakeLock = null;
    console.warn('Scherm aan houden lukt niet:', e?.message || e);
  }
}

/** Tekstversie van de lijst (zonder wat al in de kar ligt), in de gekozen sortering */
function listAsText(lst) {
  const entries = entriesOf(lst.id).filter((e) => !e.in_cart);
  const line = (it) => {
    const e = S.data.entries.find((x) => x.list_id === lst.id && x.item_id === it.id);
    return `- ${it.name}${qtyOf(e) > 1 ? ` (${qtyOf(e)}×)` : ''}${e.note ? ` – ${e.note}` : ''}`;
  };
  const items = entries.map((e) => S.data.itemsById.get(e.item_id));
  let body;
  if (S.sortMode === 'winkel') {
    body = sortByStore(items, S.storeId, S.data.positions, S.data.catsById).map(line).join('\n');
  } else {
    body = groupByCategory(items, S.data.catsById)
      .map((g) => `${g.category?.name ?? 'Zonder categorie'}\n${g.items.map(line).join('\n')}`).join('\n\n');
  }
  return `${lst.name}\n\n${body}`;
}

async function shareList() {
  const lst = currentList();
  if (!lst) return;
  if (!entriesOf(lst.id).some((e) => !e.in_cart)) return toast('Er staat nog niets op de lijst om te delen');
  const text = listAsText(lst);
  try {
    if (navigator.share) { await navigator.share({ title: lst.name, text }); return; }
  } catch (e) {
    if (e?.name === 'AbortError') return;   // zelf geannuleerd
  }
  try { await navigator.clipboard.writeText(text); toast('Lijst gekopieerd. Plak hem in bijv. WhatsApp.'); }
  catch { toast('Delen lukt niet op dit toestel', { error: true }); }
}

// ---------- Afvinken zonder internet (wachtrij) ----------
// In de winkel valt het bereik soms weg. Afvinken en terugzetten gaan dan in een
// wachtrij op het toestel en worden in volgorde verstuurd zodra er weer verbinding is.
// Zo blijft ook de afvinkvolgorde (voor het leren van de looproute) bewaard.

const queueKey = () => 'bl-queue-' + (S.api?.mode || 'x');
let queue = [];
let flushing = null;

function queueLoad() { try { queue = JSON.parse(localStorage.getItem(queueKey())) || []; } catch { queue = []; } }
function queueSave() { try { localStorage.setItem(queueKey(), JSON.stringify(queue)); } catch { /* vol */ } }

/** Lijkt de fout op "geen verbinding" (en niet op een weigering door de database)? */
const isNetworkError = (e) => !navigator.onLine || /failed to fetch|networkerror|network request failed|load failed|fetch/i.test(String(e?.message || e));

function enqueue(entryId, patch) {
  // Meerdere tikken op hetzelfde artikel: alleen de laatste toestand telt, maar op de plek van die laatste tik
  queue = queue.filter((q) => q.id !== entryId);
  queue.push({ id: entryId, patch, at: nowIso() });
  queueSave();
}

/** Wachtrij in volgorde versturen. Geeft false als het (nog) niet lukt. */
function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      while (queue.length) {
        const q = queue[0];
        try {
          await S.api.update('list_entries', q.id, q.patch);
        } catch (e) {
          if (isNetworkError(e)) return false;
          console.warn('Wachtrij: wijziging overgeslagen', e);   // bijv. regel intussen verwijderd
        }
        queue.shift();
        queueSave();
      }
      return true;
    } finally { flushing = null; }
  })();
  return flushing;
}

/** Nog niet verstuurde wijzigingen over vers opgehaalde data leggen, zodat niets terugspringt. */
function applyQueue(entries) {
  for (const q of queue) {
    const e = entries.find((x) => x.id === q.id);
    if (!e) continue;
    Object.assign(e, q.patch);
    if (q.patch.in_cart) e.cart_at = q.at; else if (q.patch.in_cart === false) { e.cart_at = null; e.cart_store_id = null; }
  }
}

/** Afvinken/terugzetten: lukt ook zonder verbinding. */
function cartWrite(entry, patch) {
  writeSeq++;
  reindex(); render(); cacheSave();
  if (String(entry.id).startsWith('tmp-')) {
    // nog niet opgeslagen regel: wacht tot hij een echte id heeft
    return mutate(null, async () => { await waitForId(entry); await S.api.update('list_entries', entry.id, patch); }, 'Afvinken mislukt');
  }
  if (queue.length || S.offline || !navigator.onLine) {
    enqueue(entry.id, patch);
    render(); cacheSave();
    if (navigator.onLine) flushQueue().then((ok) => { if (ok) scheduleRefresh(150); });
    return;
  }
  pendingWrites++;
  S.api.update('list_entries', entry.id, patch).catch((e) => {
    if (isNetworkError(e)) { enqueue(entry.id, patch); S.offline = true; render(); cacheSave(); return; }
    console.warn(e);
    toast(`Afvinken mislukt: ${e.message}`, { error: true });
  }).finally(() => { pendingWrites--; scheduleRefresh(150); });
}

async function waitForId(entry) {
  for (let i = 0; i < 50 && String(entry.id).startsWith('tmp-'); i++) await new Promise((r) => setTimeout(r, 100));
  if (String(entry.id).startsWith('tmp-')) throw new Error('artikel nog niet opgeslagen');
}

// ---------- Weergave ----------

function render() {
  const a = document.activeElement;
  const keepId = a && a.id && $app.contains(a) ? a.id : null;
  const sel = keepId && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;

  if (!S.membership) $app.innerHTML = viewWelcome();
  else if (S.membership.member.status !== 'approved') $app.innerHTML = viewWaiting();
  else if (!S.data) $app.innerHTML = '<div class="splash">Laden…</div>';
  else $app.innerHTML = viewMain();
  syncWakeLock();

  if (keepId) {
    const el = document.getElementById(keepId);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* geen tekstveld */ }
    }
  }
}

function renderError(title, e) {
  let hint = '';
  const msg = String(e?.message || e);
  if (/anonymous/i.test(msg)) hint = '<p>Zet in Supabase <b>Authentication → Sign In / Providers → Allow anonymous sign-ins</b> aan.</p>';
  else if (/fetch|network/i.test(msg)) hint = '<p>Controleer de internetverbinding en de gegevens in <code>js/config.js</code>.</p>';
  $app.innerHTML = `<div class="welcome"><h1>${esc(title)}</h1><p>${esc(msg)}</p>${hint}
    <button class="btn primary block" data-action="reload">Opnieuw proberen</button></div>`;
}

function viewNotConfigured() {
  return `<div class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Nog niet gekoppeld</h1>
    <p>De app is nog niet verbonden met Supabase. Vul de Project URL en de anon key in <code>js/config.js</code> in (zie README).</p>
    <div class="card pad"><h2>Eerst proberen?</h2>
      <p class="muted small">In de demomodus werkt alles, maar de lijst staat alleen in deze browser en wordt niet gedeeld.</p>
      <button class="btn primary block" data-action="start-demo">Demo starten</button></div>
  </div>`;
}

function viewWelcome() {
  return `<div class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Boodschappen</h1>
    <p>Eén lijst voor het hele gezin, in de volgorde van de winkel.</p>
    <div class="card pad">
      <h2>Nieuw gezin starten</h2>
      <p class="muted small">Je krijgt een code van 4 letters om met je gezin te delen.</p>
      <label class="lbl" for="new-name">Je naam</label>
      <input id="new-name" class="field" autocomplete="given-name" maxlength="40" placeholder="Bijv. Raymond">
      <button class="btn primary block" data-action="create-family">Gezin starten</button>
    </div>
    <div class="or">of</div>
    <div class="card pad">
      <h2>Meedoen met je gezin</h2>
      <p class="muted small">Vraag de code aan een gezinslid. Die keurt je aanvraag goed.</p>
      <label class="lbl" for="join-code">Gezinscode</label>
      <input id="join-code" class="field code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD">
      <label class="lbl" for="join-name">Je naam</label>
      <input id="join-name" class="field" autocomplete="given-name" maxlength="40" placeholder="Bijv. Sanne">
      <button class="btn block" data-action="join-family">Aanvraag versturen</button>
    </div>
    ${S.api.mode === 'demo' ? '<p class="muted small" style="text-align:center;margin-top:18px">Demomodus</p>' : ''}
  </div>`;
}

function viewWaiting() {
  const { family, member } = S.membership;
  return `<div class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Even wachten</h1>
    <p>Hoi ${esc(member.name)}, je aanvraag voor gezin</p>
    <div class="big-code">${esc(family?.code ?? '····')}</div>
    <p>wacht op goedkeuring door een van de gezinsleden. Zodra die je goedkeurt, gaat de app vanzelf open.</p>
    <button class="btn primary block" data-action="reload-data">Opnieuw controleren</button>
    <button class="btn danger block" data-action="cancel-join">Aanvraag intrekken</button>
  </div>`;
}

function offlineBanner() {
  const n = queue.length;
  if (!S.offline && !n) return '';
  if (!S.offline) return `<div class="banner">${plural(n, 'afgevinkt artikel wordt', 'afgevinkte artikelen worden')} nog verstuurd…</div>`;
  return `<div class="banner">Geen internet. Afvinken werkt gewoon${n ? ` (${n} nog te versturen)` : ''}; toevoegen en Klaar wachten op verbinding.</div>`;
}

function topbar(title) {
  return `<header class="topbar"><h1>${esc(title)}</h1>
    <button class="code-chip" data-action="tab" data-tab="beheer" aria-label="Gezinscode">${esc(S.membership.family.code)}</button></header>
    ${offlineBanner()}`;
}

function nav() {
  const pend = pendingMembers().length;
  const listCount = listEntries().length;
  const b = (tab, icon, label, badge) =>
    `<button data-action="tab" data-tab="${tab}" ${S.tab === tab ? 'aria-current="page"' : ''}>${icon}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
  return `<nav class="nav">${b('lijst', ICON.list, 'Lijst', '')}${b('winkelen', ICON.cart, 'Winkelen', listCount || '')}${b('beheer', ICON.gear, 'Beheer', pend || '')}</nav>`;
}

function viewMain() {
  const body = S.tab === 'winkelen' ? viewShop() : S.tab === 'beheer' ? viewManage()
    : (S.overview || !currentList()) ? viewOverview() : viewList();
  return `<div class="screen">${body}</div>${nav()}`;
}

function storeChips(action = 'pick-store') {
  return `<div class="chips scroll">${S.data.stores.map((s) =>
    `<button class="chip" data-action="${action}" data-id="${s.id}" aria-pressed="${s.id === S.storeId}">${esc(s.name)}</button>`).join('')}</div>`;
}

// ---- Lijstjes (overzicht) ----

function viewOverview() {
  const lists = S.data.lists;
  const buttons = lists.map((l) => {
    const n = entriesOf(l.id).length;
    const inCart = entriesOf(l.id).filter((e) => e.in_cart).length;
    const current = l.id === S.listId && lists.length > 1;
    const meta = [current ? 'Laatst geopend' : '', inCart ? `${inCart} in kar` : '', current ? '' : `gemaakt ${shortDate(l.created_at)}`]
      .filter(Boolean).join(' · ');
    return `<button class="list-btn${current ? ' current' : ''}" data-action="open-list" data-id="${l.id}">
      <span class="list-ic" aria-hidden="true">${current ? ICON.cart : ICON.list}</span>
      <span class="list-txt"><span class="name">${esc(l.name)}</span><span class="meta">${esc(meta.charAt(0).toUpperCase() + meta.slice(1))}</span></span>
      <span class="list-count${n ? '' : ' empty-count'}" aria-label="${plural(n, 'regel', 'regels')}">${n || 'leeg'}</span>
    </button>`;
  }).join('');
  return `${topbar('Lijstjes')}
  <div class="content">
    <p class="muted small" style="margin:2px 6px 12px">${lists.length ? 'Kies een lijst om te bewerken' : 'Nog geen lijst. Maak er een met de knop hieronder.'}</p>
    <div class="list-btns">${buttons}</div>
    <div class="shop-pad"></div>
  </div>
  <div class="stickybar"><button class="btn primary" data-action="new-list">${ICON.plus} Nieuwe lijst</button></div>`;
}

/** Knoppen om snel van lijst te wisselen (alleen bij meer dan één lijst) */
function listChips() {
  if (S.data.lists.length < 2) return '';
  return `<div class="chips scroll" role="group" aria-label="Wissel van lijst">${S.data.lists.map((l) =>
    `<button class="chip list-chip" data-action="pick-list" data-id="${l.id}" aria-pressed="${l.id === S.listId}">${esc(l.name)} <b>${entriesOf(l.id).length}</b></button>`).join('')}</div>`;
}

// ---- Lijst (samenstellen) ----

function viewList() {
  const lst = currentList();
  const entries = curEntries();
  const cart = entries.filter((e) => e.in_cart).length;
  const row = (it, showCat) => { const e = S.data.entryByItem.get(it.id); return e.in_cart ? cartRow(e) : entryRow(e, showCat); };
  let list = '';
  if (!entries.length) {
    list = `<div class="empty"><strong>De lijst is leeg</strong>Typ hierboven of tik op een vaak gekozen artikel.</div>`;
  } else if (S.sortMode === 'winkel') {
    const items = sortByStore(entries.map((e) => S.data.itemsById.get(e.item_id)), S.storeId, S.data.positions, S.data.catsById);
    list = `<div class="card">${items.map((it) => row(it, true)).join('')}</div>`;
  } else {
    const groups = groupByCategory(entries.map((e) => S.data.itemsById.get(e.item_id)), S.data.catsById);
    list = `<div class="card">${groups.map((g) =>
      `<div class="group-title">${esc(g.category?.name ?? 'Zonder categorie')}</div>` +
      g.items.map((it) => row(it, false)).join('')).join('')}</div>`;
  }
  return `<header class="topbar">
      <button class="back-btn" data-action="overview">${ICON.back} Lijstjes</button>
      <span style="flex:1"></span>
      <button class="code-chip" data-action="tab" data-tab="beheer" aria-label="Gezinscode">${esc(S.membership.family.code)}</button></header>
    ${offlineBanner()}
  <div class="content">
    <div class="list-title"><h1>${esc(lst.name)}</h1>
      <button class="icon-btn" data-action="share-list" aria-label="Lijst delen" title="Lijst delen">${ICON.share}</button>
      <button class="icon-btn" data-action="edit-list" aria-label="Lijst wijzigen">${ICON.pencil}</button></div>
    <div class="list-sub">${plural(entries.length, 'regel', 'regels')}${cart ? ` · ${cart} in kar` : ''}</div>
    ${listChips()}
    <div class="addbox">
      <input id="add-input" class="field" type="search" placeholder="Artikel toevoegen…" autocomplete="off" enterkeyhint="done" value="${esc(S.search)}">
    </div>
    <div id="suggest">${viewSuggest()}</div>
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Sorteren">
        <button data-action="sort" data-mode="categorie" aria-pressed="${S.sortMode === 'categorie'}">Per categorie</button>
        <button data-action="sort" data-mode="winkel" aria-pressed="${S.sortMode === 'winkel'}">Winkelvolgorde</button>
      </div>
    </div>
    ${S.sortMode === 'winkel' ? storeChips() : ''}
    <div class="section-title">Op de lijst</div>
    ${list}
  </div>`;
}

/** Regel die al in de kar ligt: blijft zichtbaar op de lijst, met "Terug" */
function cartRow(e) {
  const it = S.data.itemsById.get(e.item_id);
  return `<div class="row in-cart">
    <span class="tick on" aria-hidden="true"></span>
    <div class="main"><span class="name">${esc(it.name)}</span>${qtyBadge(e)}${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}<span class="cart-label">In kar</span></div>
    <button class="btn small ghost" data-action="from-cart" data-id="${e.id}" aria-label="${esc(it.name)} terug op de lijst">Terug</button>
  </div>`;
}

function entryRow(e, showCategory) {
  const it = S.data.itemsById.get(e.item_id);
  const cat = showCategory && it.category_id ? S.data.catsById.get(it.category_id)?.name : '';
  return `<div class="row">
    <button class="main" data-action="edit-entry" data-id="${e.id}">
      <span class="name">${esc(it.name)}</span>
      ${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}
      ${cat ? `<span class="meta">${esc(cat)}</span>` : ''}
    </button>
    <div class="stepper" role="group" aria-label="Aantal ${esc(it.name)}">
      <button class="step" data-action="qty-down" data-id="${e.id}" aria-label="${qtyOf(e) > 1 ? 'Eén minder' : esc(it.name) + ' van de lijst halen'}">${qtyOf(e) > 1 ? '−' : ICON.trash}</button>
      <span class="qty" aria-live="polite">${qtyOf(e)}</span>
      <button class="step plus" data-action="qty-up" data-id="${e.id}" aria-label="Eén meer" ${qtyOf(e) >= MAX_QTY ? 'disabled' : ''}>+</button>
    </div>
  </div>`;
}

function searchMatches(q) {
  const n = norm(q);
  if (!n) return [];
  return S.data.items
    .map((it) => ({ it, name: norm(it.name) }))
    .filter((x) => x.name.includes(n))
    .sort((a, b) =>
      (b.name.startsWith(n) - a.name.startsWith(n)) ||
      (b.it.use_count - a.it.use_count) ||
      a.it.name.localeCompare(b.it.name, 'nl'))
    .map((x) => x.it);
}

function viewSuggest() {
  const q = S.search.trim();
  if (!q) {
    const fav = S.data.items
      .filter((it) => !S.data.entryByItem.get(it.id)?.in_cart && it.use_count > 0)
      .sort((a, b) => b.use_count - a.use_count || String(b.last_used).localeCompare(String(a.last_used)) || a.name.localeCompare(b.name, 'nl'))
      .slice(0, S.showMoreFav ? 40 : 12);
    if (!fav.length) return '';
    return `<div class="section-title">Vaak gekozen</div><div class="chips">${fav.map((it) =>
      { const e = S.data.entryByItem.get(it.id);
        return `<button class="chip add${e ? ' on' : ''}" data-action="add-item" data-id="${it.id}">${esc(it.name)}${e ? ` <span class="chip-qty">${qtyOf(e)}</span>` : ''}</button>`; }).join('')}
      <button class="chip more" data-action="more-fav">${S.showMoreFav ? 'Minder' : 'Meer…'}</button></div>`;
  }
  const matches = searchMatches(q).slice(0, 8);
  const exact = matches.some((it) => norm(it.name) === norm(q));
  return `<div class="card suggest">${matches.map((it) => {
    const e = S.data.entryByItem.get(it.id);
    const cat = it.category_id ? S.data.catsById.get(it.category_id)?.name : '';
    return `<div class="row"><button class="main" data-action="add-item" data-id="${it.id}">
      <span class="name">${esc(it.name)}</span><span class="meta">${esc(cat || '')}</span></button>
      ${e ? `<span class="on-list">${e.in_cart ? 'in de kar' : `${qtyOf(e)}× op de lijst`}</span>` : ''}</div>`;
  }).join('')}
    ${exact ? '' : `<div class="row"><button class="main" data-action="new-item"><span class="name">+ Nieuw artikel “${esc(q)}”</span></button></div>`}
  </div>`;
}

// ---- Winkelen ----

function viewShop() {
  if (!currentList()) {
    return `${topbar('Winkelen')}<div class="content"><div class="empty"><strong>Nog geen lijst</strong>Maak eerst een lijst op het tabblad Lijst.</div></div>`;
  }
  const entries = listEntries();
  const cart = cartEntries();
  const items = sortByStore(entries.map((e) => S.data.itemsById.get(e.item_id)), S.storeId, S.data.positions, S.data.catsById);
  const rows = items.map((it) => {
    const e = S.data.entryByItem.get(it.id);
    const cat = it.category_id ? S.data.catsById.get(it.category_id)?.name : '';
    return `<div class="row" data-entry="${e.id}"><button class="main" data-action="to-cart" data-id="${e.id}" style="display:flex;align-items:center;gap:6px">
      <span class="tick" aria-hidden="true"></span>
      <span><span class="name">${esc(it.name)}</span>${qtyBadge(e)}${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}<span class="meta">${esc(cat || '')}</span></span>
    </button></div>`;
  }).join('');
  const multi = S.data.lists.length > 1;
  return `${topbar('Winkelen')}
  <div class="content shop">
    ${multi ? `<div class="section-title" style="margin-top:4px">Lijst</div>${listChips()}<div class="section-title">Winkel</div>` : ''}
    ${storeChips()}
    <div class="progress"><span>Nog <b>${entries.length}</b></span><span>In de kar <b>${cart.length}</b></span></div>
    ${entries.length ? `<div class="card">${rows}</div>`
      : `<div class="empty"><strong>${cart.length ? 'Alles in de kar!' : 'Niets te halen'}</strong>${cart.length ? 'Tik op Klaar als je hebt afgerekend.' : 'Zet eerst iets op de lijst.'}</div>`}
    <div class="shop-pad"></div>
  </div>
  <div class="stickybar">
    <button class="btn" data-action="open-cart">${ICON.cart.replace('<svg', '<svg width="22" height="22"')} Kar (${cart.length})</button>
    <button class="btn primary" data-action="finish" ${cart.length ? '' : 'disabled'}>Klaar</button>
  </div>`;
}

// ---- Beheer ----

function viewManage() {
  const d = S.data;
  const self = me();

  const members = d.members.map((m) => {
    const isMe = m.user_id === self.user_id;
    const tags = [m.is_starter ? 'starter' : '', isMe ? 'jij' : ''].filter(Boolean).join(' · ');
    if (m.status === 'pending') {
      return `<div class="row"><div class="main"><span class="name">${esc(m.name)}</span><span class="meta">wil meedoen</span></div>
        <button class="btn small primary" data-action="approve" data-id="${m.user_id}">Goedkeuren</button>
        <button class="btn small" data-action="remove-member" data-id="${m.user_id}">Weigeren</button></div>`;
    }
    return `<div class="row"><div class="main"><span class="name">${esc(m.name)}</span>${tags ? `<span class="meta">${tags}</span>` : ''}</div>
      ${isMe ? '' : `<button class="icon-btn" data-action="remove-member" data-id="${m.user_id}" aria-label="${esc(m.name)} verwijderen">×</button>`}</div>`;
  }).join('');

  const stores = d.stores.map((s) => {
    const learned = d.positionRows.filter((p) => p.store_id === s.id).length;
    return `<div class="row"><button class="main" data-action="rename-store" data-id="${s.id}">
      <span class="name">${esc(s.name)}</span><span class="meta">${learned ? plural(learned, 'artikel', 'artikelen') + ' met geleerde plek' : 'nog niets geleerd'}</span></button>
      ${learned ? `<button class="icon-btn" data-action="reset-store" data-id="${s.id}" aria-label="Geleerde volgorde wissen" title="Geleerde volgorde wissen">↺</button>` : ''}
      <button class="icon-btn" data-action="delete-store" data-id="${s.id}" aria-label="${esc(s.name)} verwijderen">×</button></div>`;
  }).join('');

  const cats = d.categories.map((c, i) => `<div class="row">
      <button class="main" data-action="rename-category" data-id="${c.id}"><span class="name">${i + 1}. ${esc(c.name)}</span></button>
      <button class="icon-btn" data-action="move-category" data-id="${c.id}" data-dir="-1" aria-label="Omhoog" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon-btn" data-action="move-category" data-id="${c.id}" data-dir="1" aria-label="Omlaag" ${i === d.categories.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="icon-btn" data-action="delete-category" data-id="${c.id}" aria-label="${esc(c.name)} verwijderen">×</button></div>`).join('');

  return `${topbar('Beheer')}
  <div class="content">
    <div class="section-title">Gezin</div>
    <div class="card pad" style="text-align:center">
      <div class="muted small">Gezinscode — deel deze met je gezin</div>
      <div class="big-code">${esc(S.membership.family.code)}</div>
    </div>
    <div class="card" style="margin-top:12px">${members}</div>
    <div class="section-title">Winkels</div>
    <div class="card">${stores || '<div class="row muted">Nog geen winkels</div>'}</div>
    <button class="btn block" style="margin-top:10px" data-action="add-store">+ Winkel toevoegen</button>
    <div class="section-title">Categorieën (volgorde = looproute)</div>
    <div class="card">${cats}</div>
    <button class="btn block" style="margin-top:10px" data-action="add-category">+ Categorie toevoegen</button>
    <div class="section-title">Artikelen (${d.items.length})</div>
    <input id="manage-search" class="field" type="search" placeholder="Zoek artikel om te wijzigen…" autocomplete="off" value="${esc(S.manageSearch)}">
    <div id="manage-items">${viewManageItems()}</div>
    <div class="section-title">Over</div>
    <div class="card pad small">
      <div>Versie ${VERSION} · ${S.api.mode === 'demo' ? '<b>demomodus</b> (alleen op dit toestel)' : 'gekoppeld aan Supabase'}</div>
      <div class="muted">Ingelogd als ${esc(self.name)}</div>
      ${S.api.mode === 'demo' ? '<button class="btn block" style="margin-top:12px" data-action="reset-demo">Demo wissen en opnieuw beginnen</button>' : ''}
      <button class="btn danger block" style="margin-top:12px" data-action="leave-family">Gezin verlaten op dit toestel</button>
    </div>
  </div>`;
}

function viewManageItems() {
  const q = S.manageSearch.trim();
  if (!q) return '<p class="muted small" style="margin:8px 6px">Typ een deel van de naam om een artikel te wijzigen of te verwijderen.</p>';
  const matches = searchMatches(q).slice(0, 30);
  if (!matches.length) return '<p class="muted small" style="margin:8px 6px">Niets gevonden.</p>';
  return `<div class="card" style="margin-top:8px">${matches.map((it) => {
    const cat = it.category_id ? S.data.catsById.get(it.category_id)?.name : 'Zonder categorie';
    return `<div class="row"><button class="main" data-action="edit-item" data-id="${it.id}"><span class="name">${esc(it.name)}</span>
      <span class="meta">${esc(cat)} · ${plural(it.use_count, 'keer', 'keer')} gekocht</span></button></div>`;
  }).join('')}</div>`;
}

// ---------- Sheets (vensters van onderen) ----------

let sheet = null;      // {handlers}
let ignorePop = 0;

function openSheet(html, handlers = {}) {
  const isNew = !sheet;
  sheet = { handlers };
  $sheet.innerHTML = `<div class="sheet-backdrop" data-sheet-backdrop><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  if (isNew) history.pushState({ sheet: true }, '');
  const f = $sheet.querySelector('[autofocus]');
  if (f) setTimeout(() => { f.focus(); if (f.select && f.value) f.select(); }, 30);
}

function closeSheet() {
  if (!sheet) return;
  sheet = null;
  $sheet.innerHTML = '';
  if (history.state?.sheet) { ignorePop++; history.back(); }
}

window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; return; }
  if (sheet) { sheet = null; $sheet.innerHTML = ''; }
});

$sheet.addEventListener('click', (ev) => {
  if (ev.target.matches('[data-sheet-backdrop]')) return closeSheet();
  const el = ev.target.closest('[data-action]');
  if (!el || !sheet) return;
  const fn = sheet.handlers[el.dataset.action];
  if (el.dataset.action === 'close') return closeSheet();
  if (fn) fn(el, ev);
});
$sheet.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches('input')) {
    ev.preventDefault();
    $sheet.querySelector('[data-default]')?.click();
  }
});

function confirmSheet({ title, text = '', ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    openSheet(`<h2>${esc(title)}</h2>${text ? `<p class="muted">${text}</p>` : ''}
      <div class="actions"><button class="btn" data-action="no">Annuleren</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-action="yes" data-default>${esc(ok)}</button></div>`, {
      yes: () => { closeSheet(); resolve(true); },
      no: () => { closeSheet(); resolve(false); },
    });
    const unsub = () => { if (!sheet) { resolve(false); window.removeEventListener('popstate', unsub); } };
    window.addEventListener('popstate', unsub);
  });
}

function promptSheet({ title, value = '', placeholder = '', ok = 'Opslaan' }) {
  return new Promise((resolve) => {
    openSheet(`<h2>${esc(title)}</h2>
      <input id="prompt-input" class="field" style="margin-top:12px" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="60" autofocus>
      <div class="actions"><button class="btn" data-action="no">Annuleren</button>
      <button class="btn primary" data-action="yes" data-default>${esc(ok)}</button></div>`, {
      yes: () => { const v = $sheet.querySelector('#prompt-input').value.trim(); closeSheet(); resolve(v || null); },
      no: () => { closeSheet(); resolve(null); },
    });
  });
}

function categoryChips(selectedId) {
  return `<div class="chips" id="cat-chips">${S.data.categories.map((c) =>
    `<button class="chip" data-action="pick-cat" data-id="${c.id}" aria-pressed="${c.id === selectedId}">${esc(c.name)}</button>`).join('')}</div>`;
}
const pickCat = (el) => {
  $sheet.querySelectorAll('#cat-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === el)));
};
const pickedCat = () => $sheet.querySelector('#cat-chips .chip[aria-pressed="true"]')?.dataset.id ?? null;

// ---------- Meldingen ----------

let toastTimer = null;
function toast(text, { undo, error } = {}) {
  clearTimeout(toastTimer);
  $toast.innerHTML = `<div class="toast ${error ? 'error' : ''}" role="status"><span>${esc(text)}</span>${undo ? '<button data-undo>Ongedaan maken</button>' : ''}</div>`;
  if (undo) $toast.querySelector('[data-undo]').onclick = () => { $toast.innerHTML = ''; undo(); };
  toastTimer = setTimeout(() => { $toast.innerHTML = ''; }, undo ? 5000 : 3500);
}

// ---------- Acties ----------

function addToList(item, note = null, qty = 1, listId = S.listId) {
  if (!listId || !S.data.lists.some((l) => l.id === listId)) return toast('Kies eerst een lijst', { error: true });
  const existing = S.data.entries.find((e) => e.list_id === listId && e.item_id === item.id);
  if (existing) {
    if (existing.in_cart) return fromCart(existing);
    changeQty(existing, +1);
    return toast(`${item.name}: ${qtyOf(existing)}× op de lijst`);
  }
  const temp = { id: tmpId(), family_id: familyId(), list_id: listId, item_id: item.id, note, qty, in_cart: false, cart_at: null, cart_store_id: null, added_at: nowIso() };
  mutate(() => S.data.entries.push(temp), async () => {
    const row = await S.api.insert('list_entries', { family_id: familyId(), list_id: listId, item_id: item.id, note, ...(qty > 1 ? { qty } : {}) });
    await syncInserted(temp, row);
  }, 'Toevoegen mislukt');
}

function newItemSheet(name) {
  const overig = fallbackCategory();
  openSheet(`<h2>Nieuw artikel</h2>
    <label class="lbl" for="ni-name">Naam</label>
    <input id="ni-name" class="field" value="${esc(name)}" maxlength="80">
    <label class="lbl">Categorie</label>
    ${categoryChips(overig?.id)}
    <label class="lbl" for="ni-note">Notitie (optioneel)</label>
    <input id="ni-note" class="field" maxlength="120" placeholder="Bijv. de grote">
    <div class="actions"><button class="btn" data-action="close">Annuleren</button>
    <button class="btn primary" data-action="save" data-default>Op de lijst</button></div>`, {
    'pick-cat': pickCat,
    save: () => {
      const nm = $sheet.querySelector('#ni-name').value.trim();
      const note = $sheet.querySelector('#ni-note').value.trim() || null;
      if (!nm) return;
      const catId = pickedCat();   // uitlezen vóór het sluiten van het venster
      const dup = S.data.items.find((i) => norm(i.name) === norm(nm));
      closeSheet();
      S.search = '';
      if (dup) return addToList(dup, note);
      const listId = S.listId;
      if (!listId) return toast('Kies eerst een lijst', { error: true });
      const item = { id: tmpId(), family_id: familyId(), name: nm, category_id: catId, use_count: 0, last_used: null };
      const entry = { id: tmpId(), family_id: familyId(), list_id: listId, item_id: item.id, note, qty: 1, in_cart: false, cart_at: null, cart_store_id: null, added_at: nowIso() };
      mutate(() => { S.data.items.push(item); S.data.entries.push(entry); }, async () => {
        const row = await S.api.insert('items', { family_id: familyId(), name: nm, category_id: catId });
        Object.assign(item, row);
        entry.item_id = row.id;
        const e = await S.api.insert('list_entries', { family_id: familyId(), list_id: listId, item_id: row.id, note });
        await syncInserted(entry, e);
      }, 'Artikel toevoegen mislukt');
    },
  });
}

function editEntrySheet(entry) {
  const it = S.data.itemsById.get(entry.item_id);
  openSheet(`<h2>${esc(it.name)}</h2>
    <label class="lbl" for="ee-note">Notitie</label>
    <input id="ee-note" class="field" maxlength="120" value="${esc(entry.note || '')}" placeholder="Bijv. de grote, rijpe">
    <label class="lbl">Categorie</label>
    ${categoryChips(it.category_id)}
    <div class="actions"><button class="btn danger" data-action="remove">Van lijst halen</button>
    <button class="btn primary" data-action="save" data-default>Opslaan</button></div>`, {
    'pick-cat': pickCat,
    remove: () => { closeSheet(); removeEntry(entry); },
    save: () => {
      const note = $sheet.querySelector('#ee-note').value.trim() || null;
      const catId = pickedCat();
      closeSheet();
      if (note !== (entry.note || null)) {
        mutate(() => { entry.note = note; }, () => S.api.update('list_entries', entry.id, { note }), 'Opslaan mislukt');
      }
      if (catId !== it.category_id) {
        mutate(() => { it.category_id = catId; }, () => S.api.update('items', it.id, { category_id: catId }), 'Opslaan mislukt');
      }
    },
  });
}

/** Aantal ophogen of verlagen; bij 1 en − gaat het artikel van de lijst. */
function changeQty(entry, delta) {
  const qty = qtyOf(entry) + delta;
  if (qty < 1) return removeEntry(entry);
  if (qty > MAX_QTY) return;
  // Nog niet opgeslagen? Dan neemt syncInserted het aantal mee na het invoegen.
  mutate(() => { entry.qty = qty; }, async () => {
    if (!String(entry.id).startsWith('tmp-')) await S.api.update('list_entries', entry.id, { qty });
  }, 'Aantal opslaan mislukt');
}

/** Na invoegen: databaserij overnemen, maar een intussen aangepast aantal bewaren. */
async function syncInserted(entry, row) {
  const want = qtyOf(entry);
  Object.assign(entry, row);
  if (qtyOf(row) !== want) {
    entry.qty = want;
    await S.api.update('list_entries', entry.id, { qty: want });
  }
}

function removeEntry(entry) {
  const it = S.data.itemsById.get(entry.item_id);
  const idx = S.data.entries.indexOf(entry);
  mutate(() => S.data.entries.splice(idx, 1), () => S.api.remove('list_entries', entry.id), 'Verwijderen mislukt');
  toast(`${it.name} van de lijst gehaald`, {
    undo: () => addToList(it, entry.note, qtyOf(entry), entry.list_id),
  });
}

function toCart(entry, rowEl) {
  const it = S.data.itemsById.get(entry.item_id);
  const store = S.storeId;
  vibrate();
  const apply = () => {
    entry.in_cart = true; entry.cart_at = nowIso(); entry.cart_store_id = store;
    cartWrite(entry, { in_cart: true, cart_store_id: store });
  };
  if (rowEl) { rowEl.classList.add('leaving'); setTimeout(apply, 200); } else apply();
  toast(`${it.name} in de kar`, { undo: () => fromCart(entry) });
}

function fromCart(entry) {
  entry.in_cart = false; entry.cart_at = null; entry.cart_store_id = null;
  cartWrite(entry, { in_cart: false });
}

function cartSheet() {
  const cart = cartEntries();
  openSheet(`<h2>In de kar (${cart.length})</h2>
    <p class="muted small">Tik op ↩ om een artikel terug op de lijst te zetten.</p>
    ${cart.length ? `<div class="card">${cart.map((e) => {
      const it = S.data.itemsById.get(e.item_id);
      return `<div class="row"><div class="main"><span class="name">${esc(it.name)}</span>${qtyBadge(e)}${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</div>
        <button class="icon-btn" data-action="back" data-id="${e.id}" aria-label="${esc(it.name)} terug op de lijst">↩</button></div>`;
    }).join('')}</div>` : '<div class="empty">De kar is leeg.</div>'}
    <div class="actions"><button class="btn" data-action="close">Sluiten</button>
    ${cart.length ? '<button class="btn primary" data-action="finish">Klaar</button>' : ''}</div>`, {
    back: (el) => {
      const e = S.data.entries.find((x) => x.id === el.dataset.id);
      if (e) fromCart(e);
      cartSheet();
    },
    finish: () => finish(true),
  });
}

async function finish(fromSheet = false) {
  const cart = cartEntries();
  if (!cart.length) return;
  if (S.offline || !navigator.onLine) return toast('Klaar lukt pas weer met internet. Je afvinkwerk blijft bewaard.', { error: true });
  const left = listEntries().length;
  const listId = S.listId;
  const multi = S.data.lists.length > 1;
  const ok = await confirmSheet({
    title: 'Klaar met winkelen?',
    text: `${plural(cart.length, 'artikel gaat', 'artikelen gaan')} uit de kar${multi ? ` van “${esc(currentList().name)}”` : ''}.` +
      (left ? ` ${plural(left, 'artikel blijft', 'artikelen blijven')} op de lijst staan.` : '') +
      ` De app onthoudt de volgorde voor ${esc(storeName(S.storeId))}.`,
    ok: 'Klaar',
  });
  if (!ok) return;
  if (fromSheet) closeSheet();

  const storeId = S.storeId;
  const sequence = cart.filter((e) => e.cart_store_id === storeId).map((e) => e.item_id);
  const posOf = (id) => effectivePosition(S.data.itemsById.get(id), storeId, S.data.positions, S.data.catsById);
  const learned = learnPositions(sequence, posOf);

  mutate(() => {
    for (const { item_id, pos } of learned) {
      const row = S.data.positionRows.find((p) => p.store_id === storeId && p.item_id === item_id);
      if (row) row.pos = pos; else S.data.positionRows.push({ store_id: storeId, item_id, pos });
    }
    for (const e of cart) {
      const it = S.data.itemsById.get(e.item_id);
      if (it) { it.use_count += 1; it.last_used = nowIso(); }
    }
    S.data.entries = S.data.entries.filter((e) => !(e.in_cart && e.list_id === listId));
  }, async () => {
    if (queue.length && !(await flushQueue())) throw new Error('geen verbinding, probeer het zo opnieuw');
    await S.api.finishShopping(listId, storeId, learned);
  }, 'Afronden mislukt');
  toast('Kar geleegd. Tot de volgende keer!');
}

// -- Lijstjes --

function openList(id, { overview = false } = {}) {
  S.listId = id; prefs.set('list', id);
  S.overview = overview;
  S.search = '';
  reindex();
  render();
}

const QUICK_NAMES = ['Weekend', 'Feestje', 'Drogist'];

function newListSheet() {
  openSheet(`<h2>Nieuwe lijst</h2>
    <label class="lbl" for="nl-name">Naam van de lijst</label>
    <input id="nl-name" class="field" maxlength="60" value="${esc(DEFAULT_LIST_NAME)}" autofocus>
    <p class="muted small" style="margin:6px 2px 0">Standaardnaam, tik om aan te passen. Later ook te wijzigen.</p>
    <label class="lbl">Of kies een snelle naam</label>
    <div class="chips">${QUICK_NAMES.map((n) => `<button class="chip" data-action="quick-name" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <div class="actions"><button class="btn" data-action="close">Annuleren</button>
    <button class="btn primary" data-action="save" data-default>Lijst maken</button></div>`, {
    'quick-name': (el) => { const f = $sheet.querySelector('#nl-name'); f.value = el.dataset.name; f.focus(); },
    save: () => {
      const typed = $sheet.querySelector('#nl-name').value.trim() || DEFAULT_LIST_NAME;
      const name = uniqueListName(typed);
      closeSheet();
      mutate(null, async () => {
        const row = await S.api.insert('lists', { family_id: familyId(), name });
        S.data.lists.push(row);
        openList(row.id);
        window.scrollTo(0, 0);
        toast(name === typed ? `Lijst “${name}” gemaakt` : `Die naam bestond al: de lijst heet “${name}”`);
      }, 'Lijst maken mislukt');
    },
  });
}

function editListSheet(lst) {
  openSheet(`<h2>Lijst wijzigen</h2>
    <label class="lbl" for="el-name">Naam van de lijst</label>
    <input id="el-name" class="field" maxlength="60" value="${esc(lst.name)}">
    <p class="muted small" style="margin:6px 2px 0">Bestaat de naam al, dan komt er automatisch (2) achter.</p>
    <div class="actions"><button class="btn" data-action="close">Annuleren</button>
    <button class="btn primary" data-action="save" data-default>Opslaan</button></div>
    <hr class="divider">
    <button class="btn danger outline block" data-action="delete">${ICON.trash} Lijst verwijderen</button>`, {
    save: () => {
      const typed = $sheet.querySelector('#el-name').value.trim();
      closeSheet();
      if (!typed || typed === lst.name) return;
      const name = uniqueListName(typed, lst.id);
      if (name === lst.name) return;
      mutate(() => { lst.name = name; }, () => S.api.update('lists', lst.id, { name }), 'Naam wijzigen mislukt');
      if (name !== typed) toast(`Die naam bestond al: de lijst heet “${name}”`);
    },
    delete: () => deleteList(lst),
  });
}

async function deleteList(lst) {
  if (S.data.lists.length <= 1) { closeSheet(); return toast('Er moet minstens één lijst blijven'); }
  const n = entriesOf(lst.id).length;
  if (n) {
    const ok = await confirmSheet({
      title: 'Lijst verwijderen?',
      text: `“${esc(lst.name)}” en ${n === 1 ? 'de regel' : `de ${n} regels`} erin worden voor het hele gezin verwijderd. Dit kan niet ongedaan worden gemaakt.`,
      ok: 'Verwijderen', danger: true,
    });
    if (!ok) return;
  } else {
    closeSheet();
  }
  mutate(() => {
    S.data.lists = S.data.lists.filter((l) => l !== lst);
    S.data.entries = S.data.entries.filter((e) => e.list_id !== lst.id);
    if (S.listId === lst.id) { S.listId = S.data.lists[0]?.id ?? null; prefs.set('list', S.listId); }
    S.overview = true;
  }, () => S.api.remove('lists', lst.id), 'Verwijderen mislukt');
  toast(`Lijst “${lst.name}” verwijderd`);
}

// -- Beheer-acties --

async function addStore() {
  const name = await promptSheet({ title: 'Winkel toevoegen', placeholder: 'Bijv. Lidl Paddepoel', ok: 'Toevoegen' });
  if (!name) return;
  const pos = Math.max(0, ...S.data.stores.map((s) => s.position)) + 1;
  mutate(null, async () => {
    const row = await S.api.insert('stores', { family_id: familyId(), name, position: pos });
    S.storeId = row.id; prefs.set('store', row.id);
  }, 'Winkel toevoegen mislukt');
}

async function renameRow(table, row, title) {
  const name = await promptSheet({ title, value: row.name });
  if (!name || name === row.name) return;
  mutate(() => { row.name = name; }, () => S.api.update(table, row.id, { name }), 'Naam wijzigen mislukt');
}

async function deleteStore(store) {
  if (S.data.stores.length <= 1) return toast('Er moet minstens één winkel blijven');
  const ok = await confirmSheet({ title: `${store.name} verwijderen?`, text: 'De geleerde volgorde van deze winkel gaat verloren.', ok: 'Verwijderen', danger: true });
  if (!ok) return;
  mutate(() => { S.data.stores = S.data.stores.filter((s) => s !== store); if (S.storeId === store.id) S.storeId = S.data.stores[0]?.id; },
    () => S.api.remove('stores', store.id), 'Verwijderen mislukt');
}

async function resetStore(store) {
  const ok = await confirmSheet({ title: 'Geleerde volgorde wissen?', text: `${esc(store.name)} gaat terug naar de standaard volgorde van de categorieën.`, ok: 'Wissen', danger: true });
  if (!ok) return;
  mutate(() => { S.data.positionRows = S.data.positionRows.filter((p) => p.store_id !== store.id); },
    () => S.api.resetStorePositions(store.id), 'Wissen mislukt');
}

async function addCategory() {
  const name = await promptSheet({ title: 'Categorie toevoegen', placeholder: 'Bijv. Dranken', ok: 'Toevoegen' });
  if (!name) return;
  const overig = fallbackCategory();
  mutate(null, async () => {
    if (overig) {
      // nieuwe categorie vóór het vangnet zetten
      await S.api.insert('categories', { family_id: familyId(), name, position: overig.position });
      await S.api.update('categories', overig.id, { position: overig.position + 1 });
    } else {
      await S.api.insert('categories', { family_id: familyId(), name, position: Math.max(0, ...S.data.categories.map((c) => c.position)) + 1 });
    }
  }, 'Categorie toevoegen mislukt');
}

function moveCategory(cat, dir) {
  const list = S.data.categories;
  const i = list.indexOf(cat);
  const other = list[i + dir];
  if (!other) return;
  // posities normaliseren naar 1..n en dan wisselen
  const updates = [];
  list.forEach((c, k) => { if (c.position !== k + 1) { c.position = k + 1; updates.push(c); } });
  [cat.position, other.position] = [other.position, cat.position];
  updates.push(cat, other);
  const uniq = [...new Set(updates)];
  mutate(() => { S.data.categories.sort((a, b) => a.position - b.position); },
    async () => { for (const c of uniq) await S.api.update('categories', c.id, { position: c.position }); }, 'Verplaatsen mislukt');
}

async function deleteCategory(cat) {
  const overig = fallbackCategory();
  const n = S.data.items.filter((i) => i.category_id === cat.id).length;
  const target = overig && overig.id !== cat.id ? overig : null;
  const ok = await confirmSheet({
    title: `${cat.name} verwijderen?`,
    text: n ? `${plural(n, 'artikel gaat', 'artikelen gaan')} naar “${esc(target ? target.name : 'Zonder categorie')}”.` : '',
    ok: 'Verwijderen', danger: true,
  });
  if (!ok) return;
  mutate(() => {
    S.data.items.forEach((i) => { if (i.category_id === cat.id) i.category_id = target?.id ?? null; });
    S.data.categories = S.data.categories.filter((c) => c !== cat);
  }, async () => {
    if (target) await S.api.moveCategoryItems(cat.id, target.id);
    await S.api.remove('categories', cat.id);
  }, 'Verwijderen mislukt');
}

function editItemSheet(it) {
  openSheet(`<h2>Artikel wijzigen</h2>
    <label class="lbl" for="ei-name">Naam</label>
    <input id="ei-name" class="field" maxlength="80" value="${esc(it.name)}">
    <label class="lbl">Categorie</label>
    ${categoryChips(it.category_id)}
    <p class="muted small">${plural(it.use_count, 'keer', 'keer')} gekocht.</p>
    <div class="actions"><button class="btn danger" data-action="delete">Verwijderen</button>
    <button class="btn primary" data-action="save" data-default>Opslaan</button></div>`, {
    'pick-cat': pickCat,
    delete: async () => {
      const ok = await confirmSheet({ title: `${it.name} verwijderen?`, text: 'Het artikel verdwijnt ook van de lijst en uit de vaak gekozen artikelen.', ok: 'Verwijderen', danger: true });
      if (!ok) return;
      mutate(() => {
        S.data.items = S.data.items.filter((i) => i !== it);
        S.data.entries = S.data.entries.filter((e) => e.item_id !== it.id);
      }, () => S.api.remove('items', it.id), 'Verwijderen mislukt');
    },
    save: () => {
      const name = $sheet.querySelector('#ei-name').value.trim();
      const catId = pickedCat();
      closeSheet();
      if (!name) return;
      if (S.data.items.some((i) => i !== it && norm(i.name) === norm(name))) return toast('Er is al een artikel met die naam', { error: true });
      const patch = {};
      if (name !== it.name) patch.name = name;
      if (catId !== it.category_id) patch.category_id = catId;
      if (!Object.keys(patch).length) return;
      mutate(() => Object.assign(it, patch), () => S.api.update('items', it.id, patch), 'Opslaan mislukt');
    },
  });
}

async function removeMember(userId) {
  const m = S.data.members.find((x) => x.user_id === userId);
  if (!m) return;
  const pending = m.status === 'pending';
  const ok = await confirmSheet({
    title: pending ? `Aanvraag van ${m.name} weigeren?` : `${m.name} verwijderen uit het gezin?`,
    text: pending ? '' : 'Op dat toestel is de lijst daarna niet meer te zien.',
    ok: pending ? 'Weigeren' : 'Verwijderen', danger: true,
  });
  if (!ok) return;
  mutate(() => { S.data.members = S.data.members.filter((x) => x !== m); }, () => S.api.removeMember(userId), 'Verwijderen mislukt');
}

// ---------- Gebeurtenissen ----------

const actions = {
  reload: () => location.reload(),
  'reload-data': () => refresh(),
  'start-demo': () => { localStorage.setItem('bl-mode', 'demo'); location.reload(); },

  'create-family': async () => {
    const name = document.getElementById('new-name').value.trim();
    if (!name) return toast('Vul je naam in', { error: true });
    try { await S.api.createFamily(name); await refresh(); toast('Gezin gestart. Deel de code met je gezin!'); }
    catch (e) { toast(e.message, { error: true }); }
  },
  'join-family': async () => {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    const name = document.getElementById('join-name').value.trim();
    if (!/^[A-Z]{4}$/.test(code)) return toast('De code bestaat uit 4 letters', { error: true });
    if (!name) return toast('Vul je naam in', { error: true });
    try { await S.api.joinFamily(code, name); await refresh(); }
    catch (e) { toast(e.message, { error: true }); }
  },
  'cancel-join': async () => {
    const ok = await confirmSheet({ title: 'Aanvraag intrekken?', ok: 'Intrekken', danger: true });
    if (!ok) return;
    try { await S.api.removeMember(S.api.userId); await refresh(); } catch (e) { toast(e.message, { error: true }); }
  },

  tab: (el, ev) => {
    ev.preventDefault();
    // Nog een keer op "Lijst" tikken = terug naar het overzicht
    if (el.dataset.tab === 'lijst' && S.tab === 'lijst') S.overview = true;
    S.tab = el.dataset.tab; prefs.set('tab', S.tab);
    render(); window.scrollTo(0, 0);
  },
  sort: (el) => { S.sortMode = el.dataset.mode; prefs.set('sort', S.sortMode); render(); },
  'pick-store': (el) => { S.storeId = el.dataset.id; prefs.set('store', S.storeId); render(); },
  overview: () => { S.overview = true; S.search = ''; render(); window.scrollTo(0, 0); },
  'open-list': (el) => { openList(el.dataset.id); window.scrollTo(0, 0); },
  'pick-list': (el) => openList(el.dataset.id, { overview: S.overview }),
  'new-list': () => newListSheet(),
  'share-list': () => shareList(),
  'edit-list': () => { const l = currentList(); if (l) editListSheet(l); },
  'from-cart': (el) => { const e = S.data.entries.find((x) => x.id === el.dataset.id); if (e && e.in_cart) fromCart(e); },

  'add-item': (el) => {
    const it = S.data.itemsById.get(el.dataset.id);
    if (!it) return;
    const fromSearch = !!S.search;
    S.search = '';
    addToList(it);
    if (fromSearch) document.getElementById('add-input')?.focus();
  },
  'more-fav': () => { S.showMoreFav = !S.showMoreFav; document.getElementById('suggest').innerHTML = viewSuggest(); },
  'new-item': () => newItemSheet(S.search.trim()),
  'edit-entry': (el) => { const e = S.data.entries.find((x) => x.id === el.dataset.id); if (e) editEntrySheet(e); },
  'remove-entry': (el) => { const e = S.data.entries.find((x) => x.id === el.dataset.id); if (e) removeEntry(e); },

  'to-cart': (el) => {
    const e = S.data.entries.find((x) => x.id === el.dataset.id);
    if (e && !e.in_cart) toCart(e, el.closest('.row'));
  },
  'open-cart': () => cartSheet(),
  finish: () => finish(false),

  approve: (el) => {
    const m = S.data.members.find((x) => x.user_id === el.dataset.id);
    mutate(() => { if (m) m.status = 'approved'; }, () => S.api.approveMember(el.dataset.id), 'Goedkeuren mislukt');
    if (m) toast(`${m.name} doet nu mee`);
  },
  'remove-member': (el) => removeMember(el.dataset.id),
  'leave-family': async () => {
    const ok = await confirmSheet({ title: 'Gezin verlaten?', text: 'Wil je later weer meedoen, dan is opnieuw goedkeuring nodig.', ok: 'Verlaten', danger: true });
    if (!ok) return;
    try { await S.api.removeMember(S.api.userId); S.wasMember = false; S.data = null; await refresh(); } catch (e) { toast(e.message, { error: true }); }
  },
  'reset-demo': async () => {
    const ok = await confirmSheet({ title: 'Demo wissen?', text: 'Alle demogegevens op dit toestel worden verwijderd.', ok: 'Wissen', danger: true });
    if (!ok) return;
    S.api.reset(); localStorage.removeItem(cacheKey()); location.reload();
  },

  'add-store': () => addStore(),
  'rename-store': (el) => { const s = S.data.stores.find((x) => x.id === el.dataset.id); if (s) renameRow('stores', s, 'Winkel hernoemen'); },
  'delete-store': (el) => { const s = S.data.stores.find((x) => x.id === el.dataset.id); if (s) deleteStore(s); },
  'reset-store': (el) => { const s = S.data.stores.find((x) => x.id === el.dataset.id); if (s) resetStore(s); },
  'add-category': () => addCategory(),
  'rename-category': (el) => { const c = S.data.catsById.get(el.dataset.id); if (c) renameRow('categories', c, 'Categorie hernoemen'); },
  'move-category': (el) => { const c = S.data.catsById.get(el.dataset.id); if (c) moveCategory(c, Number(el.dataset.dir)); },
  'delete-category': (el) => { const c = S.data.catsById.get(el.dataset.id); if (c) deleteCategory(c); },
  'qty-up': (el) => { const e = S.data.entries.find((x) => x.id === el.dataset.id); if (e) changeQty(e, +1); },
  'qty-down': (el) => { const e = S.data.entries.find((x) => x.id === el.dataset.id); if (e) changeQty(e, -1); },
  'edit-item': (el) => { const it = S.data.itemsById.get(el.dataset.id); if (it) editItemSheet(it); },
};

$app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el, ev);
});

$app.addEventListener('input', (ev) => {
  if (ev.target.id === 'add-input') {
    S.search = ev.target.value;
    document.getElementById('suggest').innerHTML = viewSuggest();
  } else if (ev.target.id === 'manage-search') {
    S.manageSearch = ev.target.value;
    document.getElementById('manage-items').innerHTML = viewManageItems();
  } else if (ev.target.id === 'join-code') {
    ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }
});

$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'add-input') {
    ev.preventDefault();
    const q = S.search.trim();
    if (!q) return;
    const matches = searchMatches(q);
    const pick = matches.find((it) => norm(it.name) === norm(q)) || matches[0];
    if (pick) { S.search = ''; addToList(pick); } else newItemSheet(q);
  } else if (ev.target.id === 'new-name') actions['create-family']();
  else if (ev.target.id === 'join-name' || ev.target.id === 'join-code') actions['join-family']();
});

// ---------- Opstarten ----------

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
  }
}

async function boot() {
  registerServiceWorker();
  const params = new URLSearchParams(location.search);
  const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  const demo = params.has('demo') || (!configured && localStorage.getItem('bl-mode') === 'demo');
  if (!configured && !demo) { S.api = { mode: 'none' }; $app.innerHTML = viewNotConfigured(); return; }

  S.api = demo ? createDemoApi() : createSupabaseApi(SUPABASE_URL, SUPABASE_ANON_KEY);
  queueLoad();
  // Bij het openen altijd eerst het overzicht van de lijstjes
  S.tab = 'lijst'; S.overview = true;
  if (cacheLoad()) { S.wasMember = true; render(); }
  try {
    await S.api.init();
  } catch (e) {
    console.warn(e);
    if (S.data) {
      S.offline = true; render();
      // Opnieuw opstarten zodra er weer verbinding is (wachtrij blijft bewaard)
      window.addEventListener('online', () => location.reload(), { once: true });
      return;
    }
    return renderError('Kan niet verbinden', e);
  }
  S.api.subscribe(() => scheduleRefresh());
  await refresh();

  document.addEventListener('visibilitychange', () => { syncWakeLock(); if (!document.hidden) scheduleRefresh(50); });
  window.addEventListener('online', () => scheduleRefresh(50));
  window.addEventListener('offline', () => { S.offline = true; render(); });
  // vangnet als een realtime-bericht gemist is; sneller zolang je op goedkeuring wacht
  setInterval(() => {
    if (document.hidden) return;
    if (S.membership && S.membership.member.status !== 'approved') refresh();
  }, 5000);
  setInterval(() => { if (!document.hidden) scheduleRefresh(); }, 60000);
}

boot();
