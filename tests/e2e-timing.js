/* Browser checks for the timing check (section E of app.js). Same setup as e2e.js:
     NODE_PATH=../pocket-tools/node_modules node tests/e2e-timing.js   (server from README running)
   The microphone path uses Chrome's fake capture device fed from a silent WAV, and onsets are injected
   through the ?test=1 hooks, so the echo measurement and grading run end to end without real sound.
   What only a real phone can show (speaker echo, pad hits, Android mic delay) is in tests/CHECKLIST.md. */
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), os = require('os');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE || 'http://127.0.0.1:8766/the-pocket/';
let pass = 0, fail = 0;
function ok(name, cond, info) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' | ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }

// 2 s of digital silence, 48 kHz mono 16-bit, for the fake microphone.
function silentWav() {
  const sr = 48000, n = sr * 2, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  const f = path.join(os.tmpdir(), 'pocket-silence.wav'); fs.writeFileSync(f, b); return f;
}

async function newPage(b, store) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  await c.addInitScript(s => localStorage.setItem('thepocket.v2', JSON.stringify(s)), Object.assign({ hintSeen: true }, store || {}));
  const p = await c.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  await p.goto(BASE + 'index.html?test=1'); await p.waitForTimeout(300);
  return { c, p };
}
// Waits until all play beats (bars 1..bars) are scheduled, then returns the session state.
async function playBeats(p, bars) {
  const until = Date.now() + 30000; // a 4-bar run at 40 BPM lasts 30 s
  while (Date.now() < until) {
    const s = await p.evaluate(() => __pocket.tcState());
    if (s && s.beats.filter(x => x.bar >= 1 && x.bar <= bars).length === bars * 4) return s;
    await p.waitForTimeout(50);
  }
  return null;
}
async function waitResult(p) { await p.waitForSelector('#tc-result:not([hidden])', { timeout: 15000 }); return p.$eval('#tc-result', e => e.innerText); }

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + silentWav()] });

  // 1. Onset detector on a synthetic signal with known onsets.
  { const { c, p } = await newPage(b);
    const r = await p.evaluate(() => {
      const sr = 48000, n = sr * 3, x = new Float32Array(n); let seed = 7;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
      for (let i = 0; i < n; i++) x[i] = 0.002 * rnd();
      const loud = [0.31, 0.62, 0.9, 1.21, 1.5, 1.83, 2.1, 2.44], quiet = [0.45, 1.05, 1.66, 2.28];
      const burst = (t, a) => { const s = Math.round(t * sr); for (let i = 0; i < sr * 0.04; i++) x[s + i] += a * rnd() * Math.exp(-i / (sr * 0.008)); };
      loud.forEach(t => burst(t, 0.6)); quiet.forEach(t => burst(t, 0.08));
      const run = gate => { const d = __pocket.makeDetector(sr), out = []; d.cfg.gate = gate;
        for (let o = 0; o < n; o += 1024) d.process(x.subarray(o, o + 1024), o / sr, (t, v) => out.push(t)); return out; };
      const all = run(0), gated = run(0.2);
      const near = (list, want) => want.every(w => list.some(t => Math.abs(t - w) < 0.001));
      return { all: all.length, gated: gated.length, allHit: near(all, loud.concat(quiet)), gatedHit: near(gated, loud),
        worst: Math.max(...gated.map(t => Math.min(...loud.map(w => Math.abs(t - w))))) * 1000 };
    });
    ok('detector: every onset found within 1 ms, no double triggers', r.all === 12 && r.allHit, r);
    ok('detector: gate drops quieter echoes and keeps loud hits', r.gated === 8 && r.gatedHit, r);
    await c.close(); }

  // 2. Grading maths.
  { const { c, p } = await newPage(b);
    const g = await p.evaluate(() => {
      const beats = Array.from({ length: 16 }, (_, i) => 1 + i * 0.5), errs = [0, -10, 15, 30, -35, 60, -60, 0, 5, -5, 10, -10, 20, -20, 0, null];
      const hits = errs.map((e, i) => e === null ? null : beats[i] + e / 1000).filter(h => h !== null).concat([1 + 3.25]);
      return __pocket.tcGrade(beats, hits, 0.5);
    });
    ok('grade: classes, score 75%, extra hit, miss', g.n.on === 11 && g.n.close === 2 && g.n.early === 1 && g.n.late === 1 && g.n.miss === 1 && g.score === 75 && g.extra === 1, { n: g.n, score: g.score, extra: g.extra, mean: g.mean, sd: g.sd });
    await c.close(); }

  // 3. Screen taps: no calibration yet -> the button calibrates first; a play-along run stores the delay.
  { const { c, p } = await newPage(b, { bpm: 120, tc: { input: 'tap' } });
    await p.click('#tc-open');
    ok('tap without calibration: button offers calibration', /Calibrate/.test(await p.textContent('#tc-go')));
    await p.click('#tc-go');
    const s = await playBeats(p, 2);
    await p.evaluate(s => s.beats.filter(x => x.bar >= 1).forEach((x, i) => __pocket.tcHit(x.t + 0.050 + [0, 4, -3, 6, -5, 2, -2, 1][i] / 1000)), s);
    const txt = await waitResult(p);
    const cal = await p.evaluate(() => __pocket.raw().tc.cal.tap);
    ok('calibration stores ~50 ms delay', cal && Math.abs(cal.ms - 50) <= 2, { cal, txt });
    ok('after calibration the button starts a check', (await p.textContent('#tc-go')) === 'Start timing check');
    await c.close(); }

  // 4. Screen taps, calibrated: full run graded with the stored delay subtracted.
  const today = new Date(); const iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  { const { c, p } = await newPage(b, { bpm: 120, tc: { input: 'tap', cal: { tap: { ms: 40, d: iso } } } });
    await p.click('#tc-open'); await p.click('#tc-go');
    ok('tap zone shown during the run', await p.isVisible('#tc-tap'));
    const s = await playBeats(p, 4);
    const errs = [0, -10, 15, 30, -35, 60, -60, 0, 5, -5, 10, -10, 20, -20, null, 0];
    await p.evaluate(([s, errs]) => s.beats.filter(x => x.bar >= 1).forEach((x, i) => { if (errs[i] !== null) __pocket.tcHit(x.t + 0.040 + errs[i] / 1000); }), [s, errs]);
    const txt = await waitResult(p);
    ok('tap run: 75% with counts 11/2/1/1/1', /75%/.test(txt) && /11\s*in the pocket/.test(txt) && /1\s*missed/.test(txt), txt.replace(/\n/g, ' | '));
    ok('tap run: says the average is relative to calibration', /compared with your calibration/.test(txt));
    ok('result strip: 15 dots, 1 miss mark in column 15', await p.$$eval('#tc-result svg circle', e => e.length) === 15 && await p.$$eval('#tc-result svg path', e => e.length) === 1);
    ok('last beat graded (not dropped)', await p.evaluate(() => __pocket.raw().tc.hist.slice(-1)[0].sc) === 75);
    const h = await p.evaluate(() => __pocket.raw().tc.hist);
    ok('history saved', h.length === 1 && h[0].sc === 75 && h[0].in === 'tap' && h[0].bpm === 120, h);
    await p.addScriptTag({ content: AXE });
    const v = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations.map(v => v.id + ':' + v.nodes.length));
    ok('axe 0 violations: timing sheet with a result', v.length === 0, v);
    ok('no page errors (tap runs)', p.errs.length === 0, p.errs);
    await c.close(); }

  // 5. Microphone: count-in echoes give the delay, later hits graded against it; closing releases the mic.
  { const { c, p } = await newPage(b, { bpm: 100, tc: { input: 'mic' } });
    await p.click('#tc-open'); await p.click('#tc-go');
    let st = null; for (let i = 0; i < 60 && !(st = await p.evaluate(() => __pocket.tcState())); i++) await p.waitForTimeout(50);
    ok('mic opens and the run starts', !!st && st.input === 'mic', st);
    for (let i = 0; i < 100; i++) { const s = await p.evaluate(() => __pocket.tcState()); if (s && s.beats.filter(x => x.bar === 0).length === 4) { st = s; break; } await p.waitForTimeout(30); }
    await p.evaluate(s => s.beats.filter(x => x.bar === 0).forEach((x, i) => __pocket.tcOnset(x.t + 0.180 + [0, 0.004, -0.003, 0.002][i], 0.1)), st);
    const echo = await p.evaluate(() => __pocket.tcState().echo);
    ok('echo delay measured from count-in (~180 ms) and gate set', Math.abs(echo - 0.180) < 0.004 && await p.evaluate(() => __pocket.micGate()) > 0.17, { echo });
    const s = await playBeats(p, 4);
    await p.evaluate(s => s.beats.filter(x => x.bar >= 1).forEach((x, i) => __pocket.tcOnset(x.t + 0.180 - 0.020 + (i % 2 ? 4 : -4) / 1000, 0.5)), s);
    const txt = await waitResult(p);
    ok('mic run: 100% and reports rushing by ~20 ms', /100%/.test(txt) && /20 ms ahead/.test(txt) && /measured from the count-in/.test(txt), txt.replace(/\n/g, ' | '));
    ok('mic still open while the sheet is open', await p.evaluate(() => __pocket.micOn()));
    await p.click('#sheet-tc [data-close]');
    ok('closing the sheet releases the microphone', !(await p.evaluate(() => __pocket.micOn())));
    ok('no page errors (mic run)', p.errs.length === 0, p.errs);
    await c.close(); }

  // 6. Mic run where something is heard during count-in that is not the click -> clear message, nothing saved.
  { const { c, p } = await newPage(b, { bpm: 100, tc: { input: 'mic' } });
    await p.click('#tc-open'); await p.click('#tc-go');
    let st = null; for (let i = 0; i < 100; i++) { st = await p.evaluate(() => __pocket.tcState()); if (st && st.beats.filter(x => x.bar === 0).length === 4) break; await p.waitForTimeout(30); }
    await p.evaluate(s => s.beats.filter(x => x.bar === 0).forEach((x, i) => __pocket.tcOnset(x.t + [0.05, 0.2, 0.33, 0.12][i], 0.3)), st);
    const txt = await waitResult(p);
    ok('noisy count-in: explains and saves nothing', /Stay quiet for the first four clicks/.test(txt) && (await p.evaluate(() => __pocket.raw().tc.hist.length)) === 0, txt);
    await c.close(); }

  // 7. Corrupt timing-check storage falls back to defaults.
  { const { c, p } = await newPage(b, { tc: { input: 'x', sens: 99, cal: { tap: { ms: 'a' } }, hist: [{ d: 'bad' }, 5] } });
    const t = await p.evaluate(() => __pocket.raw().tc);
    ok('corrupt tc storage -> defaults', t.input === 'mic' && t.sens === 3 && t.cal.tap === null && t.hist.length === 0 && p.errs.length === 0, t);
    await c.close(); }

  // 8. Layout: the Practice row still fits at 320 px; clock label not clipped at 360.
  { const { c, p } = await newPage(b);
    for (const w of [320, 360]) {
      await p.setViewportSize({ width: w, height: 640 }); await p.waitForTimeout(100);
      const r = await p.evaluate(() => [...document.querySelectorAll('.ctbtn')].map(e => ({ fits: e.scrollWidth <= e.clientWidth + 1, h: e.getBoundingClientRect().height })));
      ok('Clock / Timing check buttons fit at ' + w + ' px', r.every(x => x.fits && x.h >= 44), r);
    }
    await c.close(); }

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
