// Eind-tot-eind test in headless Chrome (demomodus).
// Nodig: npm i -D puppeteer-core, een lokale webserver (python3 -m http.server 8765)
// en Chrome. Pas CHROME aan naar het pad van Chrome op jouw computer.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const BASE = 'http://localhost:8765/';
const out = process.env.SHOTS || './tests/screenshots/';
import fs from 'node:fs';
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { await sleep(350); await page.screenshot({ path: out + n + '.png' }); };
// klikken via het element zelf: de vaste navigatiebalk kan anders over de knop vallen
const click = async (sel) => { await page.waitForSelector(sel, { timeout: 3000 }); await page.$eval(sel, (e) => e.click()); await sleep(150); };
const text = (sel) => page.$eval(sel, (e) => e.innerText);
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok ', m); };

// Telefoonfuncties nabootsen: delen, trillen, scherm aan
await page.evaluateOnNewDocument(() => {
  window.__shared = []; window.__vibrations = 0; window.__wake = { requests: 0, active: false };
  navigator.share = async (d) => { window.__shared.push(d); };
  navigator.vibrate = () => { window.__vibrations++; return true; };
  Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => {
    window.__wake.requests++; window.__wake.active = true;
    const l = new EventTarget(); l.release = async () => { window.__wake.active = false; l.dispatchEvent(new Event('release')); }; return l;
  } } });
});

// 1. Demomodus (js/config.js is gekoppeld aan Supabase, dus ?demo gebruiken)
await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '?demo', { waitUntil: 'networkidle0' });
await page.waitForSelector('#new-name');
await shot('02-welkom');

// 2. Gezin starten
await page.type('#new-name', 'Raymond');
await click('[data-action="create-family"]');
// Eerst het overzicht van de lijstjes, met de standaardlijst
await page.waitForSelector('.list-btn');
assert((await text('.list-btns')).includes('Boodschappenlijst'), 'overzicht toont "Boodschappenlijst"');
assert((await text('.list-count')) === 'leeg', 'lege lijst toont "leeg"');
await shot('02b-lijstjes');
await click('[data-action="open-list"]');
await page.waitForSelector('#add-input');
assert((await text('.topbar')).match(/[A-Z]{4}/), 'gezinscode zichtbaar');
assert((await page.$$('.chip.add')).length === 12, '12 vaak gekozen artikelen');
assert((await text('.nav')).includes('1'), 'badge voor wachtend lid');
await shot('03-lijst-leeg');

// 3. Toevoegen via chips, zoeken en nieuw artikel
await click('.chip.add'); // Soja yoghurt (meest gekocht)
await click('.chip.add'); // zelfde chip nog eens: aantal 2 (Magere kwark)
assert((await page.$eval('.chip.add', (e) => e.textContent)).includes('2'), 'chip toont aantal 2');
await click('.chip.add:not(.on)');
await page.type('#add-input', 'banan');
await sleep(100);
assert((await text('#suggest')).includes('Bananen'), 'zoeken vindt Bananen');
await shot('04-zoeken');
await page.keyboard.press('Enter');
await sleep(200);
assert((await page.$eval('#add-input', (e) => e.value)) === '', 'zoekveld leeg na toevoegen');
assert(await page.evaluate(() => document.activeElement.id === 'add-input'), 'focus blijft in zoekveld');
await page.type('#add-input', 'kwark');
await page.keyboard.press('Enter');
await page.type('#add-input', 'brood');
await sleep(100);
await page.keyboard.press('Enter'); // eerste match
await page.type('#add-input', 'Wc-reiniger');
await sleep(500);
await click('[data-action="new-item"]');
await page.waitForSelector('#ni-name');
await shot('05-nieuw-artikel');
// vangnetcategorie kiezen
const chips = await page.$$('#cat-chips .chip');
for (const c of chips) if ((await c.evaluate((e) => e.textContent)) === 'Drogisterij & huishouden') await c.evaluate((e) => e.click());
await page.type('#ni-note', '2 stuks');
await click('[data-action="save"]');
await sleep(300);
const listText = await text('.content');
assert(listText.includes('Wc-reiniger') && listText.includes('2 stuks'), 'nieuw artikel met notitie op lijst');
assert(/Drogisterij & huishouden\s+Wc-reiniger/.test(listText), 'nieuw artikel in gekozen categorie');
assert(/5 regels/i.test(listText), '5 regels (kwark stond er al → aantal 3)');
await shot('06-lijst-categorie');

// 3b. Aantal met + en −
const qtyFirst = () => page.$eval('.stepper .qty', (e) => e.textContent);
await click('[data-action="qty-up"]');
assert((await qtyFirst()) === '2', '+ verhoogt aantal');
await click('[data-action="qty-down"]');
assert((await qtyFirst()) === '1', '− verlaagt aantal');
await click('[data-action="qty-up"]'); await click('[data-action="qty-up"]');
assert((await qtyFirst()) === '3', 'aantal 3');
await shot('06b-aantal');

// 4. Notitie wijzigen
const rows = await page.$$('[data-action="edit-entry"]');
await rows[0].evaluate((e) => e.click());
await page.waitForSelector('#ee-note');
await page.type('#ee-note', 'grote');
await shot('07-artikel-bewerken');
await click('[data-action="save"]');
await sleep(250);
assert((await text('.content')).includes('grote'), 'notitie opgeslagen');

// 5. Winkelvolgorde-weergave
await click('[data-action="sort"][data-mode="winkel"]');
await shot('08-lijst-winkelvolgorde');

// 6. Winkelen: afvinken in afwijkende volgorde
await click('.nav [data-tab="winkelen"]');
await shot('09-winkelen');
const badges = await page.$$eval('.shop .qty-badge', (els) => els.map((e) => e.textContent));
assert(JSON.stringify(badges.sort()) === '["3×","3×"]', 'aantal (3×) zichtbaar in winkel, niets bij 1');
const order = await page.$$eval('.shop .row .name', (els) => els.map((e) => e.textContent));
console.log('   volgorde vóór:', order.join(' | '));
// vink de laatste eerst af, dan de rest van boven naar beneden
const tick = async (name) => {
  const ok = await page.evaluate((n) => { const b = [...document.querySelectorAll('.shop .row')].find((r) => r.querySelector('.name').textContent === n)?.querySelector('[data-action="to-cart"]'); if (b) b.click(); return !!b; }, name);
  if (!ok) console.log('   niet gevonden:', name);
  await sleep(450);
};
const plan = [order[order.length - 1], ...order.slice(0, -1)];
for (const n of plan.slice(0, 3)) await tick(n);
await shot('10-winkelen-deels');
// ongedaan maken van de laatste
await click('[data-undo]');
await sleep(300);
assert((await text('.progress')).includes('In de kar 2'), 'ongedaan maken werkt');
for (const n of plan.slice(2)) await tick(n);
assert((await text('.content')).includes('Alles in de kar'), 'alles in de kar');
await click('[data-action="open-cart"]');
await shot('11-kar');
// één terug op de lijst en weer erin
await page.evaluate(() => { const b = [...document.querySelectorAll('.sheet [data-action="back"]')]; b[b.length - 1].click(); });
await sleep(200);
await sleep(250);
await click('.sheet [data-action="close"]');
await sleep(300);
assert((await text('.progress')).includes('Nog 1'), 'terug uit kar op lijst');
await tick(plan[plan.length - 1]);
await click('[data-action="finish"]');
await shot('12-klaar-bevestigen');
await click('.sheet [data-action="yes"]');
await sleep(500);
assert((await text('.content')).includes('Niets te halen'), 'kar geleegd');

// 7. Volgende keer: dezelfde artikelen staan in geleerde volgorde
await click('.nav [data-tab="lijst"]');
for (const n of order) {
  await page.type('#add-input', n);
  await sleep(80);
  await page.keyboard.press('Enter');
  await sleep(120);
}
await click('.nav [data-tab="winkelen"]');
const order2 = await page.$$eval('.shop .row .name', (els) => els.map((e) => e.textContent));
console.log('   volgorde ná: ', order2.join(' | '));
assert(JSON.stringify(order2) === JSON.stringify(plan), 'geleerde volgorde = afvinkvolgorde');

// 8. Beheer
await click('.nav [data-tab="beheer"]');
await shot('13-beheer');
await click('[data-action="approve"]');
await sleep(300);
assert(!(await text('.nav')).match(/Beheer\s*1/), 'badge weg na goedkeuren');
await page.type('#manage-search', 'kwark');
await sleep(150);
await shot('14-beheer-artikelen');
await click('[data-action="move-category"][data-dir="1"]');
await sleep(250);
assert((await page.$$eval('[data-action="rename-category"] .name', (e) => e[0].textContent)).includes('Brood'), 'categorie verplaatst');

// 8b. Meerdere lijstjes
await click('.nav [data-tab="lijst"]');
await click('[data-action="overview"]');
await page.waitForSelector('.list-btn');
assert((await text('.list-count')) === '5', 'overzicht telt 5 regels');
await click('[data-action="new-list"]');
await page.waitForSelector('#nl-name');
assert((await page.$eval('#nl-name', (e) => e.value)) === 'Boodschappenlijst', 'standaardnaam ingevuld');
await shot('16-nieuwe-lijst');
await click('.sheet [data-action="save"]');
await page.waitForSelector('.list-title');
await sleep(300);
assert((await text('.list-title h1')) === 'Boodschappenlijst (2)', 'dubbele naam krijgt (2)');
assert((await text('.content')).includes('De lijst is leeg'), 'nieuwe lijst is leeg');
await page.type('#add-input', 'Bananen');
await page.keyboard.press('Enter');
await sleep(300);
assert((await text('.list-sub')).startsWith('1 regel'), 'artikel op tweede lijst (staat ook op de eerste)');
assert((await page.$$('.list-chip')).length === 2, 'wisselknoppen voor 2 lijsten');
// naam wijzigen via het potloodje
await click('[data-action="edit-list"]');
await page.waitForSelector('#el-name');
await page.$eval('#el-name', (e) => { e.value = ''; });
await page.type('#el-name', 'Barbecue');
await shot('17-lijst-wijzigen');
await click('.sheet [data-action="save"]');
await sleep(300);
assert((await text('.list-title h1')) === 'Barbecue', 'lijst hernoemd');
// in de kar: blijft zichtbaar op de lijst, gemarkeerd
await click('.nav [data-tab="winkelen"]');
await click('.shop [data-action="to-cart"]');
await sleep(500);
await click('.nav [data-tab="lijst"]');
assert((await page.$$('.row.in-cart')).length === 1, 'regel in de kar staat gemarkeerd op de lijst');
assert((await text('.list-sub')) === '1 regel · 1 in kar', 'kopregel telt kar mee');
await shot('18-lijst-met-kar');
await click('[data-action="from-cart"]');
await sleep(300);
assert((await page.$$('.row.in-cart')).length === 0, 'Terug haalt regel uit de kar');
// wisselen
await page.evaluate(() => [...document.querySelectorAll('.list-chip')].find((c) => c.textContent.includes('Boodschappenlijst')).click());
await sleep(250);
assert((await text('.list-title h1')) === 'Boodschappenlijst', 'wisselen met de knoppen');
await click('[data-action="overview"]');
const counts = await page.$$eval('.list-count', (els) => els.map((e) => e.textContent));
assert(JSON.stringify(counts) === '["5","1"]', 'overzicht toont aantal per lijst');
await shot('19-lijstjes-twee');
// verwijderen met bevestiging
await page.evaluate(() => [...document.querySelectorAll('.list-btn')].find((b) => b.textContent.includes('Barbecue')).click());
await sleep(200);
await click('[data-action="edit-list"]');
await click('.sheet [data-action="delete"]');
await page.waitForSelector('.sheet [data-action="yes"]');
assert((await text('.sheet')).includes('“Barbecue” en de regel erin'), 'bevestiging noemt lijst en regels');
await shot('20-verwijderen-bevestigen');
await click('.sheet [data-action="yes"]');
await sleep(400);
assert((await page.$$('.list-btn')).length === 1, 'lijst verwijderd, terug in overzicht');
// lege lijst: verwijderen zonder bevestiging
await click('[data-action="new-list"]');
await page.waitForSelector('#nl-name');
await click('.sheet [data-action="quick-name"]');
await click('.sheet [data-action="save"]');
await page.waitForSelector('.list-title');
await sleep(300);
assert((await text('.list-title h1')) === 'Weekend', 'snelle naam');
await click('[data-action="edit-list"]');
await click('.sheet [data-action="delete"]');
await sleep(400);
assert(!(await page.$('.sheet')) && (await page.$$('.list-btn')).length === 1, 'lege lijst direct verwijderd');
// laatste lijst blijft
await click('[data-action="open-list"]');
await click('[data-action="edit-list"]');
await click('.sheet [data-action="delete"]');
await sleep(300);
assert((await text('#toast-root')).includes('minstens één lijst'), 'laatste lijst kan niet weg');

// 8c. Versie 1.3: delen, trillen, scherm aan, afvinken zonder internet
await click('[data-action="share-list"]');
await sleep(200);
const shared = await page.evaluate(() => window.__shared[0]);
assert(shared && shared.title === 'Boodschappenlijst' && shared.text.includes('- Bananen'), 'lijst gedeeld als tekst');
assert(shared.text.split('\n').filter((l) => l.startsWith('- ')).length === 5, 'alle 5 regels gedeeld (winkelvolgorde)');
await click('[data-action="qty-up"]');
await click('[data-action="sort"][data-mode="categorie"]');
await click('[data-action="share-list"]');
await sleep(200);
const shared2 = await page.evaluate(() => window.__shared[1]);
assert(/\(2×\)/.test(shared2.text) && shared2.text.includes('Groente & fruit\n- Bananen'), 'gedeelde tekst met aantal en categorie');
console.log('   gedeelde tekst:\n' + shared2.text.split('\n').map((l) => '     ' + l).join('\n'));
await click('.nav [data-tab="winkelen"]');
await sleep(200);
assert(await page.evaluate(() => window.__wake.active), 'scherm blijft aan in Winkelen');
const v0 = await page.evaluate(() => window.__vibrations);
// zonder internet afvinken
await page.setOfflineMode(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await sleep(200);
assert((await text('.banner')).includes('Afvinken werkt gewoon'), 'melding: geen verbinding, afvinken werkt');
const offOrder = await page.$$eval('.shop .row .name', (els) => els.map((e) => e.textContent));
await click('.shop [data-action="to-cart"]');
await sleep(450);
await click('.shop [data-action="to-cart"]');
await sleep(450);
assert((await page.evaluate(() => window.__vibrations)) - v0 === 2, 'trilling bij elk afvinken');
assert((await text('.banner')).includes('2 nog te versturen'), 'wachtrij telt 2');
assert((await text('.progress')).includes('In de kar 2'), 'afgevinkt zonder internet');
await shot('21-offline-afvinken');
await click('[data-action="finish"]');
await sleep(200);
assert((await text('#toast-root')).includes('pas weer met internet'), 'Klaar wacht op internet');
// herladen zonder internet: wachtrij en kar blijven
const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('bl-queue-demo')).length);
assert(queued === 2, 'wachtrij opgeslagen op het toestel');
await page.setOfflineMode(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await sleep(800);
assert(!(await page.$('.banner')), 'melding weg na verbinding');
assert((await page.evaluate(() => JSON.parse(localStorage.getItem('bl-queue-demo')).length)) === 0, 'wachtrij verstuurd');
const db = await page.evaluate(() => JSON.parse(localStorage.getItem('bl-demo-db')));
const inCart = db.list_entries.filter((e) => e.in_cart).map((e) => db.items.find((i) => i.id === e.item_id).name);
assert(inCart.length === 2 && inCart.includes(offOrder[0]) && inCart.includes(offOrder[1]), 'afgevinkte artikelen opgeslagen');
assert((await text('.progress')).includes('In de kar 2'), 'kar klopt na versturen');
await click('.nav [data-tab="lijst"]');
await sleep(200);
assert(!(await page.evaluate(() => window.__wake.active)), 'scherm-aan los bij verlaten Winkelen');

// 9. Herladen: data blijft (cache + demo-opslag)
await page.reload({ waitUntil: 'networkidle0' });
await sleep(400);
assert((await text('#app')).includes('Beheer'), 'na herladen nog ingelogd');
assert(!!(await page.$('.list-btn')), 'na herladen eerst het overzicht');
await page.screenshot({ path: out + '15-beheer-onder.png', fullPage: true });

console.log(errors.length ? 'FOUTEN IN CONSOLE:\n' + errors.join('\n') : 'geen fouten in de console');
await browser.close();
