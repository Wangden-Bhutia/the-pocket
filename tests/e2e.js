/* Browser checks for The Pocket. Dev-only; the app itself has no dependencies.
   Needs playwright-core + axe-core installed OUTSIDE the repo and Google Chrome:
     mkdir -p ../pocket-tools && (cd ../pocket-tools && npm i playwright-core axe-core)
     (cd .. && python3 -m http.server 8766 --bind 127.0.0.1) &
     NODE_PATH=../pocket-tools/node_modules node tests/e2e.js
   Serves the parent folder so the app lives at /the-pocket/ as on GitHub Pages. */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE || 'http://127.0.0.1:8766/the-pocket/';
const SHOTS = process.env.SHOTS || '';
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, info) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' | ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }
const SEEN = () => localStorage.setItem('thepocket.v2', JSON.stringify({ hintSeen: true }));

async function page(b, opts, init) {
  const c = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, opts || {}));
  if (init !== null) await c.addInitScript(init || SEEN);
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  return { c, p };
}
async function axe(p, label) {
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations.map(v => v.id + ':' + v.nodes.length));
  ok('axe 0 violations: ' + label, r.length === 0, r);
}
const go = (p, q) => p.goto(BASE + 'index.html' + (q === undefined ? '?test=1' : q)).then(() => p.waitForTimeout(300));
const shot = (p, n) => SHOTS ? p.screenshot({ path: path.join(SHOTS, n + '.png') }) : null;

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

  // 1. Layout: Start fully above the tab bar, no scrolling, no horizontal overflow.
  for (const [w, h] of [[360, 640], [375, 667], [390, 844], [412, 915], [667, 375]]) {
    const { c, p } = await page(b, { viewport: { width: w, height: h }, isMobile: w < h });
    await go(p);
    const r = await p.evaluate(() => { const g = document.querySelector('#go').getBoundingClientRect(), t = document.querySelector('.tabbar').getBoundingClientRect(), m = document.querySelector('main');
      return { ok: g.top >= 0 && g.bottom <= t.top && g.height >= 56, noScroll: m.scrollHeight <= m.clientHeight && document.documentElement.scrollHeight <= innerHeight, sw: document.documentElement.scrollWidth <= innerWidth }; });
    ok(`layout ${w}x${h} Start visible above tab bar, no scroll, no h-overflow`, r.ok && r.noScroll && r.sw, r);
    await c.close();
  }
  { const { c, p } = await page(b); const bad = [];
    for (let w = 320; w <= 768; w += 16) { await p.setViewportSize({ width: w, height: 800 }); await go(p);
      for (const t of ['metronome', 'schedule', 'rules']) { await p.click('#tab-' + t); if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('main *')].some(e => e.getBoundingClientRect().right > innerWidth + 0.5 && e.offsetParent))) bad.push(w + t); } }
    ok('no horizontal overflow 320-768 on all tabs', bad.length === 0, bad.join(',')); await c.close(); }

  const { c, p } = await page(b);
  await go(p);
  ok('no globals without ?test=1', await (async () => { const q = await c.newPage(); await q.goto(BASE + 'index.html'); const r = await q.evaluate(() => typeof window.__pocket); await q.close(); return r === 'undefined'; })());

  // 2. 120 BPM eighths, 10 s
  await p.evaluate(() => { __pocket.setBpm(120); __pocket.setSubdiv(2); __pocket.clearLog(); });
  await p.click('#go'); await p.waitForTimeout(10200); await p.click('#go');
  let log = await p.evaluate(() => __pocket.log.slice());
  const d = log.slice(1).map((n, i) => n.t - log[i].t);
  ok('120 BPM eighths: every interval 0.250 s +/- 1 ms', d.length >= 38 && d.every(x => Math.abs(x - 0.25) <= 0.001), { notes: log.length, min: Math.min(...d), max: Math.max(...d) });
  ok('accent on beat 1 of every bar only', log.every(n => (n.level === 2) === (n.beat === 0 && n.sub === 0)) && log.filter(n => n.level === 2).length >= 4);
  ok('no note scheduled in the past (normal run)', log.every(n => n.t >= n.at));

  // 3. 16ths -> triplets mid-beat
  await p.evaluate(() => { __pocket.setBpm(120); __pocket.setSubdiv(4); __pocket.clearLog(); });
  await p.click('#go'); await p.waitForTimeout(1130);
  await p.evaluate(() => __pocket.setSubdiv(3)); await p.waitForTimeout(1200); await p.click('#go');
  log = await p.evaluate(() => __pocket.log.slice());
  const fi = log.findIndex(n => n.n === 3), first = log[fi], t0 = log[0].t;
  const before = log.slice(0, fi), lastOld = before[before.length - 1];
  ok('subdivision change: old beat finishes at old grid', lastOld && lastOld.sub === 3, lastOld);
  ok('first triplet note lands on a beat boundary', first && first.sub === 0 && Math.abs(((first.t - t0) / 0.5) - Math.round((first.t - t0) / 0.5)) < 1e-6, first && { rel: first.t - t0 });
  const tri = log.slice(fi), tdi = tri.slice(1).map((n, i) => n.t - tri[i].t);
  ok('triplet grid even after switch', tdi.every(x => Math.abs(x - 0.5 / 3) < 0.001));

  // 4. 600 ms main-thread block at 200 BPM sixteenths
  await p.evaluate(() => { __pocket.setBpm(200); __pocket.setSubdiv(4); __pocket.clearLog(); });
  await p.click('#go'); await p.waitForTimeout(800);
  await p.evaluate(() => { const e = performance.now() + 600; while (performance.now() < e) {} });
  await p.waitForTimeout(800); await p.click('#go');
  log = await p.evaluate(() => __pocket.log.slice()); const st = await p.evaluate(() => __pocket.stats);
  const step = 60 / 200 / 4, b0 = log[0].t;
  const gridOk = log.every(n => { const k = Math.round((n.t - b0) / step); return Math.abs(n.t - b0 - k * step) < 1e-6 && n.sub === k % 4 && n.beat === Math.floor(k / 4) % 4; });
  const uniq = new Set(log.map(n => n.t.toFixed(6))).size === log.length;
  const gaps = log.slice(1).map((n, i) => n.t - log[i].t);
  ok('stall: no note started in the past', log.every(n => n.t >= n.at), { dropped: st.dropped, stalls: st.stalls });
  ok('stall: no simultaneous burst (no duplicate or sub-step times)', uniq && gaps.every(g => g >= step - 1e-6));
  ok('stall: notes were dropped and grid/beat position correct afterwards', st.dropped > 0 && gridOk);

  // 5. Stop silences: gate at 0 and all queued sources cancelled
  await p.evaluate(() => { __pocket.setBpm(220); __pocket.setSubdiv(4); });
  await p.click('#go'); await p.waitForTimeout(500); await p.click('#go'); await p.waitForTimeout(30);
  const s5 = await p.evaluate(() => __pocket.state());
  ok('Stop: gate ramped to 0 within ~10 ms and pending sources cancelled', s5.gate === 0 && s5.live === 0 && !s5.running, s5);

  // 6. Holding Space toggles once
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.evaluate(() => { const f = r => document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', repeat: r, bubbles: true })); f(false); for (let i = 0; i < 20; i++) f(true); });
  const s6 = await p.evaluate(() => __pocket.state().running); await p.evaluate(() => __pocket.stop());
  ok('holding Space toggles once', s6 === true);

  // 10. Today tags set tempo in place; timer uses wall-clock deltas
  await p.click('#tab-schedule');
  await p.click('.days li[data-day="1"] .tag');
  ok('plan tag sets tempo without leaving Plan', await p.evaluate(() => __pocket.state().bpm === 60 && __pocket.state().tab === 'schedule'));
  ok('toast announces "60 BPM set"', (await p.textContent('#toast')) === '60 BPM set');
  ok('mini player visible on Plan', await p.isVisible('#mini'));
  await shot(p, 'plan-390x844');
  await p.click('#today'); await p.waitForTimeout(200);
  await shot(p, 'today-sheet-390x844');
  await p.click('#td-tags .tag'); ok('today-sheet tag keeps current tab', await p.evaluate(() => __pocket.state().tab === 'schedule'));
  await axe(p, 'Today sheet');
  await p.keyboard.press('Escape');

  // 9. axe on tabs
  await p.click('#tab-metronome'); await axe(p, 'Practice');
  ok('mini player hidden on Practice', !(await p.isVisible('#mini')));
  await p.click('#tab-schedule'); await p.evaluate(() => document.querySelectorAll('.weekhead').forEach(h => { if (h.getAttribute('aria-expanded') === 'false') h.click(); })); await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));
  await axe(p, 'Plan (all weeks open)');
  await p.click('#tab-rules'); await axe(p, 'Guide'); await shot(p, 'guide-390x844');
  await p.click('#tab-metronome'); await p.click('#ct-open'); await p.click('[data-v="silent"]'); await axe(p, 'Clock training sheet');
  await shot(p, 'clock-sheet-390x844');
  await p.keyboard.press('Escape');
  await p.click('#tab-rules'); await p.click('#reset'); await axe(p, 'Reset dialog'); await p.click('#dlg-no');
  await p.click('#tab-metronome');

  // 11. Silent bars 2/2
  await p.evaluate(() => { __pocket.setBpm(220); __pocket.setSubdiv(1); __pocket.clearLog(); });
  await p.click('#go');
  let sawSilentUI = false, sawLitDuringSilent = false;
  for (let i = 0; i < 110; i++) { await p.waitForTimeout(80); const r = await p.evaluate(() => ({ s: !document.querySelector('#silent').hidden, lit: !!document.querySelector('#beats i.on') })); if (r.s) { sawSilentUI = true; if (r.lit) sawLitDuringSilent = true; } if (i === 30) await shot(p, 'silent-bars-390x844'); }
  await p.click('#go');
  log = await p.evaluate(() => __pocket.log.slice());
  const byBar = {}; log.forEach(n => { (byBar[n.bar] = byBar[n.bar] || []).push(n.aud); });
  const pat = Object.keys(byBar).map(Number).sort((a, x) => a - x).filter(k => byBar[k].length === 4).map(k => [k, byBar[k].every(Boolean), byBar[k].every(v => !v)]);
  ok('silent bars: count-in audible, then 2 on / 2 off repeating', pat.length >= 6 && pat.every(([k, all, none]) => k === 0 ? all : ((k - 1) % 4 < 2 ? all : none)), pat.map(x => x[0] + (x[1] ? 'A' : x[2] ? 'S' : '?')).join(' '));
  ok('silent indicator shown and visuals hidden during silence', sawSilentUI && !sawLitDuringSilent);

  // 12. Clock test with synthetic taps (steady with click, slightly slower when silent)
  await p.evaluate(() => { __pocket.setBpm(150); });
  await p.click('#ct-open'); await p.click('#test-go');
  await p.evaluate(() => { const beat = 400; let i = 0; const t0 = performance.now() + 1600; // after the 4-beat count-in
    (function loop() { const n = i++; if (n >= 32) return; const iv = n < 16 ? beat : beat * 1.03; const at = n < 16 ? t0 + n * beat : t0 + 16 * beat + (n - 16) * iv; setTimeout(() => { __pocket.testTap(at + (n % 2 ? 6 : -6)); loop(); }, Math.max(0, at - performance.now())); })(); });
  await p.waitForSelector('#test-result:not([hidden])', { timeout: 30000 });
  const res = await p.textContent('#test-result'); const hist = await p.evaluate(() => __pocket.raw().hist);
  ok('clock test shows spread for both phases and drift %', /With the click.*ms/.test(res) && /Without the click: about \d+ ms/.test(res) && /%/.test(res), res);
  ok('clock test history saved (date, bpm, sdC, sdS, drift)', hist.length === 1 && ['d', 'bpm', 'sdC', 'sdS', 'drift'].every(k => k in hist[0]), hist);
  ok('no absolute offset shown', !/offset|late by|early by/i.test(await p.evaluate(() => document.body.innerText)));
  await shot(p, 'clock-result-390x844');
  await p.keyboard.press('Escape');
  ok('no page errors in main run', p.errs.length === 0, p.errs);
  await c.close();

  // timer accuracy with a faked clock (Date/performance advanced 5 minutes)
  { const { c, p } = await page(b); await p.clock.install(); await go(p);
    await p.click('#today'); await p.click('#tm-go'); await p.clock.fastForward('05:00'); await p.waitForTimeout(50);
    const t = await p.textContent('#tm-time'); ok('timer after 5:00 of wall time reads 15:00', t === '15:00', t); await c.close(); }

  // 7. Corrupt storage
  for (const raw of ['{"done":null}', 'garbage{', '{"bpm":"fast","subdiv":9,"tab":"x","done":{"1":true,"99":true,"2":"yes"}}']) {
    const { c, p } = await page(b, {}, `localStorage.setItem('thepocket.v2', ${JSON.stringify(raw)})`); await go(p);
    const s = await p.evaluate(() => __pocket.state());
    ok('corrupt storage starts with defaults: ' + raw, p.errs.length === 0 && s.bpm === 100 && s.subdiv === 1 && s.tab === 'metronome', p.errs); await c.close();
  }
  { const { c, p } = await page(b, {}, `if(!sessionStorage.x){sessionStorage.x=1;localStorage.clear();localStorage.setItem('thepocket.v1', JSON.stringify({bpm:85,subdiv:3,tab:'schedule',done:{1:true,2:true},open:{1:true}}))}`); await go(p);
    const s = await p.evaluate(() => __pocket.raw()); ok('v1 -> v2 migration keeps bpm/subdiv/tab/done', s.bpm === 85 && s.subdiv === 3 && s.tab === 'schedule' && s.done[1] && s.done[2] && (await p.textContent('#today-day')) === 'Day 3'); await c.close(); }

  // 8. Offline reload after the service worker installs
  { const { c, p } = await page(b); await go(p, '');
    await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(500);
    await c.setOffline(true); await p.reload(); await p.waitForTimeout(800);
    const r = await p.evaluate(async () => { await document.fonts.ready; return { go: !!document.querySelector('#go'), weeks: document.querySelectorAll('.week').length, f1: document.fonts.check('800 20px Fraunces'), f2: document.fonts.check('16px Karla'), loaded: [...document.fonts].filter(f => f.status === 'loaded').length }; });
    ok('offline reload renders full app with fonts', r.go && r.weeks === 4 && r.loaded >= 2, r); await c.close(); }

  // 14. file://
  { const { c, p } = await page(b); await p.goto('file://' + path.join(ROOT, 'index.html')); await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({ weeks: document.querySelectorAll('.week').length, day: document.querySelector('#today-day').textContent }));
    ok('works from file://', r.weeks === 4 && p.errs.length === 0, Object.assign(r, { errs: p.errs })); await c.close(); }

  // Tap targets >= 44x44, text >= 13px, BPM digits fixed width, Home/End on tabs
  { const { c, p } = await page(b); await go(p); const bad = [], small = [];
    for (const t of ['metronome', 'schedule', 'rules']) { await p.click('#tab-' + t);
      const r = await p.evaluate(() => { const out = { b: [], f: [] };
        document.querySelectorAll('button, input[type=range], summary, .check, .day').forEach(e => { const q = e.getBoundingClientRect(); if (e.offsetParent && q.width && (q.width < 44 || q.height < 44)) out.b.push((e.id || e.className) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height)); });
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const el = n.parentElement; if (!n.textContent.trim() || !el.offsetParent || el.closest('.sr-only')) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 13) out.f.push(el.className + ' ' + fs); }
        return out; });
      bad.push(...r.b); small.push(...r.f); }
    ok('visible tap targets >= 44x44', bad.length === 0, bad); ok('visible text >= 13px', small.length === 0, [...new Set(small)]);
    await p.click('#tab-metronome');
    const ws = await p.evaluate(() => [100, 111, 188, 40].map(v => { __pocket.setBpm(v); return document.querySelector('#bpm').getBoundingClientRect().width; }));
    ok('BPM box width constant while stepping', ws.every(x => Math.abs(x - ws[0]) < 0.5), ws);
    await p.focus('#tab-metronome'); await p.keyboard.press('End'); const e1 = await p.evaluate(() => document.activeElement.id); await p.keyboard.press('Home'); const e2 = await p.evaluate(() => document.activeElement.id);
    ok('tabs: End/Home keys', e1 === 'tab-rules' && e2 === 'tab-metronome', [e1, e2]);
    ok('nav landmark contains tablist; Start has no aria-pressed', await p.evaluate(() => !!document.querySelector('nav[aria-label="Sections"] [role=tablist]') && !document.querySelector('#go').hasAttribute('aria-pressed')));
    await c.close(); }

  // 13. content.js unchanged is checked by tests/check-content.sh
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
