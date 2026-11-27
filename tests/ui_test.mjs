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
const click = async (sel) => { await page.waitForSelector(sel, { timeout: 3000 }); await page.click(sel); await sleep(150); };
const text = (sel) => page.$eval(sel, (e) => e.innerText);
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok ', m); };

// 1. Niet geconfigureerd
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE, { waitUntil: 'networkidle0' });
assert((await text('#app')).includes('Nog niet gekoppeld'), 'scherm "nog niet gekoppeld"');
await shot('01-niet-gekoppeld');
await click('[data-action="start-demo"]');
await page.waitForSelector('#new-name');
await shot('02-welkom');

// 2. Gezin starten
await page.type('#new-name', 'Raymond');
await click('[data-action="create-family"]');
await page.waitForSelector('#add-input');
assert((await text('.topbar')).match(/[A-Z]{4}/), 'gezinscode zichtbaar');
assert((await page.$$('.chip.add')).length === 12, '12 vaak gekozen artikelen');
assert((await text('.nav')).includes('1'), 'badge voor wachtend lid');
await shot('03-lijst-leeg');

// 3. Toevoegen via chips, zoeken en nieuw artikel
await click('.chip.add'); // Soja yoghurt (meest gekocht)
await click('.chip.add');
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
// categorie Schoonmaak kiezen
const chips = await page.$$('#cat-chips .chip');
for (const c of chips) if ((await c.evaluate((e) => e.textContent)) === 'Schoonmaak') await c.click();
await page.type('#ni-note', '2 stuks');
await click('[data-action="save"]');
await sleep(300);
const listText = await text('.content');
assert(listText.includes('Wc-reiniger') && listText.includes('2 stuks'), 'nieuw artikel met notitie op lijst');
assert(/5 artikelen/i.test(listText), '5 artikelen (kwark stond er al)');
await shot('06-lijst-categorie');

// 4. Notitie wijzigen
const rows = await page.$$('[data-action="edit-entry"]');
await rows[0].click();
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
for (const n of order) {
  await click('.nav [data-tab="lijst"]');
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

// 9. Herladen: data blijft (cache + demo-opslag)
await page.reload({ waitUntil: 'networkidle0' });
await sleep(400);
assert((await text('#app')).includes('Beheer'), 'na herladen nog ingelogd');
await page.screenshot({ path: out + '15-beheer-onder.png', fullPage: true });

console.log(errors.length ? 'FOUTEN IN CONSOLE:\n' + errors.join('\n') : 'geen fouten in de console');
await browser.close();
