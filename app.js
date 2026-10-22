/* The Pocket: metronome, 28-day plan, clock training. Vanilla JS (ES2017, classic script), offline. */
(function () {
  'use strict';
  var C = window.POCKET_CONTENT, PLAN = window.POCKET_PLAN;
  var KEY = 'thepocket.v2', OLD_KEY = 'thepocket.v1';
  var MIN_BPM = 40, MAX_BPM = 220, BEATS = 4;
  var LOOKAHEAD_MS = 25, SCHEDULE_AHEAD = 0.1;
  var PRESETS = [60, 70, 85, 100, 130];
  var SUBDIVS = [{ n: 1, name: 'Quarter' }, { n: 2, name: 'Eighth' }, { n: 3, name: 'Triplets' }, { n: 4, name: 'Sixteenth' }];
  var SUB_NAME = { 1: 'Quarter', 2: 'Eighth', 3: 'Triplets', 4: 'Sixteenth' };
  var TABS = ['metronome', 'schedule', 'rules'];
  var SOUNDS = ['wood', 'click', 'beep'], SOUND_NAME = { wood: 'Wood', click: 'Click', beep: 'Beep' };
  var MODES = ['off', 'silent', 'beat1', 'backbeat', 'random'];
  var MODE_NAME = { off: 'Off', silent: 'Silent bars', beat1: 'Beat 1 only', backbeat: 'Backbeat', random: 'Random' };
  var TEST = /[?&]test=1(&|$)/.test(location.search);
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtDate(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!p) return '';
    return +p[3] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[2] - 1] + ' ' + p[1];
  }

  /* ---------- storage (schema v2) ---------- */
  function defaults() {
    return { v: 2, bpm: 100, subdiv: 1, tab: 'metronome', done: {}, open: {}, vol: 80, sound: 'wood',
      mode: { type: 'off', on: 2, off: 2, chance: 25, keepVis: false },
      base: { before: '', final: '' }, hist: [], hintSeen: false };
  }
  function dayMap(o) { var r = {}; if (!isObj(o)) return r; for (var d = 1; d <= 28; d++) if (o[d] === true) r[d] = true; return r; }
  function weekMap(o) { var r = {}; if (!isObj(o)) return r; for (var w = 1; w <= 4; w++) if (o[w] === true) r[w] = true; return r; }
  function intIn(v, a, b) { return typeof v === 'number' && isFinite(v) && v >= a && v <= b; }
  function isoOrEmpty(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
  // Whitelist + type-check every key; anything unknown or malformed falls back to the default. Never throws.
  function sanitize(o) {
    var s = defaults();
    if (!isObj(o)) return s;
    if (intIn(o.bpm, MIN_BPM, MAX_BPM)) s.bpm = Math.round(o.bpm);
    if ([1, 2, 3, 4].indexOf(o.subdiv) >= 0) s.subdiv = o.subdiv;
    if (TABS.indexOf(o.tab) >= 0) s.tab = o.tab;
    s.done = dayMap(o.done); s.open = weekMap(o.open);
    if (intIn(o.vol, 0, 100)) s.vol = Math.round(o.vol);
    if (SOUNDS.indexOf(o.sound) >= 0) s.sound = o.sound;
    if (isObj(o.mode)) {
      var m = o.mode;
      if (MODES.indexOf(m.type) >= 0) s.mode.type = m.type;
      if (intIn(m.on, 1, 4)) s.mode.on = Math.round(m.on);
      if (intIn(m.off, 1, 4)) s.mode.off = Math.round(m.off);
      if (intIn(m.chance, 10, 50)) s.mode.chance = Math.round(m.chance / 5) * 5;
      if (typeof m.keepVis === 'boolean') s.mode.keepVis = m.keepVis;
    }
    if (isObj(o.base)) { s.base.before = isoOrEmpty(o.base.before); s.base.final = isoOrEmpty(o.base.final); }
    if (Array.isArray(o.hist)) {
      s.hist = o.hist.filter(function (h) {
        return isObj(h) && isoOrEmpty(h.d) && intIn(h.bpm, MIN_BPM, MAX_BPM) && intIn(h.sdC, 0, 5000) && intIn(h.sdS, 0, 5000) && intIn(h.drift, -100, 100);
      }).slice(-50).map(function (h) { return { d: h.d, bpm: h.bpm, sdC: h.sdC, sdS: h.sdS, drift: h.drift }; });
    }
    if (typeof o.hintSeen === 'boolean') s.hintSeen = o.hintSeen;
    return s;
  }
  function readJSON(k) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function load() {
    var cur = readJSON(KEY);
    if (cur) return sanitize(cur);
    var old = readJSON(OLD_KEY); // one-time migration from v1 ({bpm, subdiv, tab, done, open})
    var s = sanitize(old);
    if (old) { s.hintSeen = true; writeNow(s); }
    return s;
  }
  function writeNow(s) { try { localStorage.setItem(KEY, JSON.stringify(s || S)); } catch (e) { /* private mode / quota */ } }
  var S = load();
  var saveT = 0;
  // Trailing debounce: change events only, never per slider input.
  function save() { clearTimeout(saveT); saveT = setTimeout(function () { writeNow(); }, 150); }
  window.addEventListener('pagehide', function () { clearTimeout(saveT); writeNow(); });

  /* ---------- live region + toast ---------- */
  var toastT = 0;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); t.textContent = ''; }, 1800);
  }
  function announce(msg) { var l = $('#live'); l.textContent = ''; setTimeout(function () { l.textContent = msg; }, 30); }

  /* ---------- viewport height fallback for browsers without dvh (iOS < 15.4) ---------- */
  if (!(window.CSS && CSS.supports && CSS.supports('height', '100dvh'))) {
    var setVh = function () { document.documentElement.style.setProperty('--vh', window.innerHeight + 'px'); };
    setVh(); window.addEventListener('resize', setVh);
  }

  /* ---------- tabs ---------- */
  function setTab(name, focus) {
    S.tab = name; save();
    TABS.forEach(function (t) {
      var p = $('#panel-' + t), b = $('#tab-' + t), on = t === name;
      p.hidden = !on; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    document.body.setAttribute('data-tab', name);
    $('#mini').hidden = name === 'metronome';
    $('#main').scrollTop = 0;
    if (name === 'schedule') revealToday();
    if (focus) $('#tab-' + name).focus();
  }
  $$('.tablist button').forEach(function (b, i, all) {
    b.addEventListener('click', function () { setTab(b.dataset.tab); });
    b.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
      if (j >= 0) { e.preventDefault(); setTab(all[(j + all.length) % all.length].dataset.tab, true); }
    });
  });

  /* ---------- pad drawing ---------- */
  function octa(r, rot) {
    var pts = [];
    for (var i = 0; i < 8; i++) { var a = (rot + 45 * i) * Math.PI / 180; pts.push((150 + r * Math.cos(a)).toFixed(1) + ',' + (150 + r * Math.sin(a)).toFixed(1)); }
    return pts.join(' ');
  }
  (function drawPad() {
    [['#pad-rim', 140], ['#pad-head', 128], ['#pad-grain1', 106], ['#pad-grain2', 118], ['#pad-inner', 92], ['#pad-flash', 128], ['#ring-beat', 142], ['#ring-sub', 142]]
      .forEach(function (p) { $(p[0]).setAttribute('points', octa(p[1], 22.5)); });
    var g = $('#pad-lugs'), ns = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 8; i++) {
      var a = (22.5 + 45 * i) * Math.PI / 180, c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', (150 + 134 * Math.cos(a)).toFixed(1)); c.setAttribute('cy', (150 + 134 * Math.sin(a)).toFixed(1)); c.setAttribute('r', 4.2);
      g.appendChild(c);
    }
  })();

  /* ---------- BPM / subdivision UI ---------- */
  var elBpm = $('#bpm'), elSlider = $('#slider');
  function setBpm(v) {
    v = clamp(Math.round(+v) || S.bpm, MIN_BPM, MAX_BPM);
    S.bpm = v; elBpm.textContent = v; elSlider.value = v;
    elSlider.style.setProperty('--fill', ((v - MIN_BPM) / (MAX_BPM - MIN_BPM) * 100) + '%');
    elSlider.setAttribute('aria-valuetext', v + ' BPM');
    $$('#presets .chip').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.bpm === v ? 'true' : 'false'); });
    $('#mini-bpm').textContent = v;
    return v;
  }
  elSlider.addEventListener('input', function () { setBpm(elSlider.value); });
  elSlider.addEventListener('change', save);

  PRESETS.forEach(function (p) {
    var b = el('button', 'chip', String(p)); b.type = 'button'; b.dataset.bpm = p; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setBpm(p); save(); });
    $('#presets').appendChild(b);
  });

  // Hold-to-repeat: 400 ms delay, then every 90 ms; 5x step after 12 repeats.
  function holdRepeat(btn, onStep) {
    var t0 = null, t1 = null;
    function stop() { if (t0 === null && t1 === null && !btn.classList.contains('held')) return; clearTimeout(t0); clearInterval(t1); t0 = t1 = null; btn.classList.remove('held'); save(); }
    btn.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return; e.preventDefault(); btn.classList.add('held'); onStep(1);
      var n = 0;
      t0 = setTimeout(function () { t1 = setInterval(function () { n++; onStep(n > 12 ? 5 : 1); }, 90); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ev) { btn.addEventListener(ev, stop); });
    btn.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); onStep(1); save(); } });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function bpmStepper(d) { return function (mult) { setBpm(S.bpm + d * mult); }; }
  holdRepeat($('#dec'), bpmStepper(-1)); holdRepeat($('#inc'), bpmStepper(1));
  holdRepeat($('#mini-dec'), bpmStepper(-1)); holdRepeat($('#mini-inc'), bpmStepper(1));

  var sdWrap = $('#subdiv');
  SUBDIVS.forEach(function (s) {
    var b = el('button', 'sd', s.name); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.n = s.n;
    b.addEventListener('click', function () { setSubdiv(s.n); save(); });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (d) { e.preventDefault(); var n = ((S.subdiv - 1 + d + 4) % 4) + 1; setSubdiv(n); save(); $('.sd[data-n="' + n + '"]').focus(); }
    });
    sdWrap.appendChild(b);
  });
  function setSubdiv(n) {
    n = +n; if ([1, 2, 3, 4].indexOf(n) < 0) return;
    S.subdiv = n;
    $$('.sd').forEach(function (b) { var on = +b.dataset.n === n; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    // While running, the grid change waits for the next beat boundary (see advance()).
    if (running && n !== curSub) pendingSub = n; else if (running) pendingSub = 0;
  }

  /* ---------- tap tempo: average of last 6 taps, reset after a 2 s gap ---------- */
  var taps = [];
  function tap(now) {
    now = now == null ? performance.now() : now;
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
    return taps.length;
  }
  var tapBtn = $('#tap');
  tapBtn.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return; e.preventDefault(); tapBtn.classList.add('hit'); tap(); save();
    setTimeout(function () { tapBtn.classList.remove('hit'); }, 90);
  });
  tapBtn.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); tap(); save(); } });

  /* ---------- audio graph ----------
     click sources -> bus (gate: ramped to 0 on Stop) -> master (volume) -> limiter -> destination.
     The timer chime connects straight to master, so it respects volume but not the metronome gate. */
  var ctx = null, bus = null, master = null, unlocked = false, buffers = null, ctxState = '';
  function ensureAudio() {
    if (!ctx) {
      var A = window.AudioContext || window.webkitAudioContext;
      if (!A) return false;
      try { ctx = new A({ latencyHint: 'interactive' }); } catch (e) { ctx = new A(); }
      master = ctx.createGain(); master.gain.value = S.vol / 100;
      var lim = ctx.createDynamicsCompressor();
      // Limiter settings: only engages near full scale, fast attack so peaks never clip.
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.05;
      bus = ctx.createGain(); bus.gain.value = 0;
      bus.connect(master); master.connect(lim); lim.connect(ctx.destination);
      ctxState = ctx.state;
      ctx.onstatechange = onCtxState;
      buffers = makeBuffers(ctx.sampleRate);
    }
    if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} }
    if (ctx.state !== 'running') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    if (!unlocked) { // iOS unlock: play one silent sample inside the user gesture
      try { var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); unlocked = true; } catch (e) {}
    }
    return true;
  }
  /* Click sounds are rendered ONCE into AudioBuffers, so each click costs a single BufferSourceNode
     (<= 2 nodes rule) and no synthesis work happens during playback. Each buffer is <= 45 ms, shorter
     than the 68 ms step at 220 BPM sixteenths, so clicks never overlap and cannot sum past their peak. */
  var PEAK = [0.32, 0.6, 0.9]; // level 0 subdivision, 1 beat, 2 accent
  function makeBuffers(sr) {
    function render(fn, dur, peak) {
      var n = Math.round(sr * dur), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), max = 0, i, seed = 12345;
      var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
      for (i = 0; i < n; i++) { d[i] = fn(i / sr, rnd); if (Math.abs(d[i]) > max) max = Math.abs(d[i]); }
      var k = max ? peak / max : 0;
      for (i = 0; i < n; i++) d[i] *= k;
      return b;
    }
    var F = { wood: [1900, 1250, 900], click: [4200, 3000, 2200], beep: [1568, 1046, 784] };
    var out = {};
    SOUNDS.forEach(function (snd) {
      out[snd] = [0, 1, 2].map(function (lvl) {
        var f = F[snd][2 - lvl], peak = PEAK[lvl];
        if (snd === 'wood') return render(function (t, r) { // woodblock: two damped partials + tiny noise transient
          var a = Math.min(1, t / 0.0008);
          return a * (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.012) + 0.45 * Math.sin(2 * Math.PI * f * 2.7 * t) * Math.exp(-t / 0.005) + 0.25 * r() * Math.exp(-t / 0.0015));
        }, 0.045, peak);
        if (snd === 'click') return render(function (t, r) { // sharp tick: filtered-noise burst with a high partial
          return Math.min(1, t / 0.0003) * (0.6 * r() * Math.exp(-t / 0.0025) + Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.004));
        }, 0.025, peak);
        return render(function (t) { // beep: the original sine, 2 ms attack, exponential decay
          return Math.min(1, t / 0.002) * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (lvl === 2 ? 0.012 : 0.009));
        }, 0.045, peak);
      });
    });
    return out;
  }
  var live = []; // sources scheduled but maybe not yet finished, so Stop can cancel them
  function click(time, level) {
    var s = ctx.createBufferSource(); s.buffer = buffers[S.sound][level]; s.connect(bus); s.start(time);
    live.push({ s: s, t: time });
  }
  function chime() {
    if (!ensureAudio()) return;
    var t = ctx.currentTime + 0.02, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(660, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.25);
  }

  /* ---------- scheduler (lookahead model: setTimeout every 25 ms, schedule 100 ms ahead of ctx.currentTime) ---------- */
  var running = false, timer = null, rafId = 0, nextTime = 0, beatIdx = 0, subIdx = 0, barIdx = 0, curSub = 1, pendingSub = 0;
  var barSilent = false, queue = [], LOG = [], stats = { scheduled: 0, dropped: 0, stalls: 0, pulses: 0 };
  var test = null; // clock test session, see section D

  function stepDur() { return 60 / S.bpm / curSub; }
  // Called at the start of each bar to decide whether the bar is muted (pattern modes only).
  function barIsSilent(bar) {
    if (test) return bar >= 5;            // test: count-in (0), bars 1-4 with click, bars 5-8 silent
    var m = S.mode;
    if (bar === 0) return false;          // count-in is always audible
    if (m.type === 'silent') return ((bar - 1) % (m.on + m.off)) >= m.on;
    if (m.type === 'random') return bar >= 2 && Math.random() * 100 < m.chance;
    return false;
  }
  function noteAudible(beat, sub) {
    if (barSilent) return false;
    if (test) return sub === 0;           // test clicks on beats only
    if (barIdx === 0) return true;
    var t = S.mode.type;
    if (t === 'beat1') return beat === 0 && sub === 0;
    if (t === 'backbeat') return (beat === 1 || beat === 3) && sub === 0;
    return true;
  }
  function scheduleNote() {
    var level = subIdx === 0 ? (beatIdx === 0 ? 2 : 1) : 0;
    var aud = noteAudible(beatIdx, subIdx);
    if (aud) click(nextTime, level);
    queue.push({ time: nextTime, beat: beatIdx, sub: subIdx, level: level, aud: aud, silent: barSilent, bar: barIdx });
    stats.scheduled++;
    if (TEST) { LOG.push({ t: nextTime, at: ctx.currentTime, beat: beatIdx, sub: subIdx, level: level, aud: aud, bar: barIdx, n: curSub, bpm: S.bpm }); if (LOG.length > 6000) LOG.shift(); }
  }
  function advance() {
    nextTime += stepDur();
    subIdx++;
    if (subIdx >= curSub) {
      subIdx = 0; beatIdx = (beatIdx + 1) % BEATS;
      // A pending subdivision takes effect only here, on a beat boundary, so the old beat plays out at the old grid.
      if (pendingSub) { curSub = pendingSub; pendingSub = 0; }
      if (beatIdx === 0) { barIdx++; barSilent = barIsSilent(barIdx); if (test && barIdx >= 9) test.endAt = nextTime; }
    }
  }
  function scheduler() {
    var now = ctx.currentTime;
    if (nextTime < now) {
      // Stall (tab throttled, main thread blocked): drop the missed notes instead of bursting them late.
      // k missed steps advance the grid so beat/bar position stays correct; never start a note in the past.
      if (nextTime < now - 0.05) stats.stalls++;
      var k = Math.ceil((now - nextTime) / stepDur());
      for (var i = 0; i < k; i++) { advance(); stats.dropped++; }
      while (nextTime < now) { advance(); stats.dropped++; } // a pending subdivision may have changed the step
    }
    while (nextTime < now + SCHEDULE_AHEAD && !(test && test.endAt)) { scheduleNote(); advance(); }
    if (test && test.endAt && now > test.endAt) { finishTest(); return; }
    timer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  /* ---------- visuals (rAF against the audio clock, compensated by outputLatency) ---------- */
  var ringBeat = $('#ring-beat'), ringSub = $('#ring-sub'), flash = $('#pad-flash'), segs = $$('#beats i');
  var silentShown = false;
  function hideVisual(n) { return !n.aud && (test ? n.silent : !S.mode.keepVis); }
  function pulse(n) {
    var silentNow = n.silent && (!!test || S.mode.type === 'silent' || S.mode.type === 'random');
    if (n.sub === 0) setSilentUI(silentNow, n);
    if (hideVisual(n)) { if (n.sub === 0) segs.forEach(function (d) { d.classList.remove('on'); }); return; }
    stats.pulses++;
    if (n.sub === 0) {
      var acc = n.level === 2;
      segs.forEach(function (d, i) { d.classList.toggle('on', i === n.beat); });
      ringBeat.style.stroke = acc ? '#e0b45c' : '#c9633a';
      ringBeat.style.strokeWidth = acc ? 7 : 4;
      if (reduceMotion) ringBeat.animate([{ opacity: acc ? 1 : .7 }, { opacity: 0 }], { duration: 200 });
      else ringBeat.animate([{ transform: 'scale(1)', opacity: acc ? 1 : .8 }, { transform: 'scale(' + (acc ? 1.32 : 1.18) + ')', opacity: 0 }], { duration: acc ? 560 : 420, easing: 'ease-out' });
      flash.style.fill = acc ? '#e0b45c' : '#b0522e';
      flash.animate([{ opacity: acc ? .5 : .28 }, { opacity: 0 }], { duration: acc ? 260 : 200, easing: 'ease-out' });
    } else if (!reduceMotion) {
      ringSub.animate([{ transform: 'scale(1)', opacity: .45 }, { transform: 'scale(1.07)', opacity: 0 }], { duration: 240, easing: 'ease-out' });
    }
  }
  function setSilentUI(on, n) {
    var box = $('#silent');
    if (on) {
      var label;
      if (test) label = 'beat ' + ((n.bar - 5) * 4 + n.beat + 1) + ' of 16';
      else if (S.mode.type === 'silent') label = 'bar ' + (((n.bar - 1) % (S.mode.on + S.mode.off)) - S.mode.on + 1) + ' of ' + S.mode.off;
      else label = '';
      $('#silent-bar').textContent = label;
    }
    if (on !== silentShown) {
      silentShown = on; box.hidden = !on; document.body.classList.toggle('is-silent', on);
      if (!test) announce(on ? 'Silent: hold the tempo' : 'Click is back');
    }
  }
  function draw() {
    if (!running) return;
    var now = ctx.currentTime - (ctx.outputLatency || 0);
    while (queue.length && queue[0].time <= now) {
      var n = queue.shift();
      if (now - n.time < 0.25) pulse(n); // skip stale pulses (e.g. after the tab was hidden)
    }
    if (test) updateTestStatus(now);
    rafId = requestAnimationFrame(draw);
  }

  /* ---------- wake lock (tracks intent so a late-resolving request after Stop is released) ---------- */
  var wake = null, wantWake = false;
  function lockScreen() {
    wantWake = true;
    if (!('wakeLock' in navigator) || wake) return;
    navigator.wakeLock.request('screen').then(function (w) {
      if (!wantWake) { w.release().catch(function () {}); return; }
      wake = w; w.addEventListener('release', function () { if (wake === w) wake = null; });
    }).catch(function () {});
  }
  function unlockScreen() { wantWake = false; if (wake) { var w = wake; wake = null; w.release().catch(function () {}); } }
  document.addEventListener('visibilitychange', function () {
    if (running && !document.hidden) { lockScreen(); cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); }
  });

  /* ---------- start / stop ---------- */
  function start() {
    if (running) return;
    if (!ensureAudio()) { showBanner('Web Audio is not available in this browser.'); return; }
    hideBanner();
    running = true; beatIdx = 0; subIdx = 0; barIdx = 0; queue = []; live = [];
    curSub = test ? 1 : S.subdiv; pendingSub = 0; barSilent = false;
    var t0 = ctx.currentTime;
    bus.gain.cancelScheduledValues(t0); bus.gain.setValueAtTime(1, t0); // restore the gate after a Stop ramp
    nextTime = t0 + 0.08;
    if (test) test.t0 = nextTime;
    scheduler(); rafId = requestAnimationFrame(draw); lockScreen();
    renderGo();
  }
  function stop() {
    if (!running) return;
    running = false; clearTimeout(timer); cancelAnimationFrame(rafId); queue = [];
    if (ctx) {
      var t = ctx.currentTime;
      // ~10 ms ramp to silence avoids a click artefact; then cancel every queued source.
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + 0.01);
      live.forEach(function (x) { try { x.s.stop(Math.max(t + 0.012, x.t)); } catch (e) {} });
      live = [];
    }
    unlockScreen();
    segs.forEach(function (d) { d.classList.remove('on'); });
    setSilentUI(false, null); silentShown = false;
    if (test && !test.done) abortTest();
    renderGo();
  }
  function toggle() { running ? stop() : start(); }
  function renderGo() {
    var lab = running ? 'Stop' : 'Start';
    $('#go-label').textContent = lab; $('#mini-go').textContent = lab;
    document.body.classList.toggle('running', running);
  }
  $('#go').addEventListener('click', toggle);
  $('#mini-go').addEventListener('click', toggle);
  // Prune finished sources every few seconds (cheap; keeps the cancel list short).
  setInterval(function () { if (ctx && live.length) { var t = ctx.currentTime - 0.1; live = live.filter(function (x) { return x.t > t; }); } }, 3000);

  function onCtxState() {
    var prev = ctxState; ctxState = ctx.state;
    if (running && prev === 'running' && (ctx.state === 'interrupted' || ctx.state === 'suspended')) {
      stop(); showBanner();
    }
  }
  function showBanner(msg) { var b = $('#banner'); if (msg) $('p', b).textContent = msg; b.hidden = false; }
  function hideBanner() { $('#banner').hidden = true; $('#banner p').textContent = 'Audio was interrupted. Tap Start to resume.'; }
  $('#banner-x').addEventListener('click', hideBanner);

  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (openSheet) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return;
    e.preventDefault();
    if (e.repeat) return; // holding Space toggles once only
    toggle();
  });

  /* ---------- sheets / dialogs ---------- */
  var openSheet = null, lastFocus = null;
  function showSheet(id) {
    if (openSheet) closeSheet(true);
    lastFocus = document.activeElement;
    openSheet = $('#' + id); openSheet.hidden = false; $('#scrim').hidden = false;
    $('#app').setAttribute('aria-hidden', 'true'); $('#app').inert = true;
    var f = $('[data-close]', openSheet) || $('button', openSheet); if (f) f.focus();
  }
  function closeSheet(keepFocus) {
    if (!openSheet) return;
    openSheet.hidden = true; $('#scrim').hidden = true; openSheet = null;
    $('#app').removeAttribute('aria-hidden'); $('#app').inert = false;
    if (!keepFocus && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeSheet(); }); });
  $('#scrim').addEventListener('click', function () { if (openSheet && openSheet.id !== 'dlg') closeSheet(); });
  document.addEventListener('keydown', function (e) {
    if (!openSheet) return;
    if (e.key === 'Escape') { e.preventDefault(); if (openSheet.id === 'dlg') dlgAnswer(false); else closeSheet(); return; }
    if (e.key === 'Tab') { // keep focus inside the open sheet
      var f = $$('button:not([hidden]), input:not([hidden]), summary, [tabindex="0"]', openSheet).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  var dlgCb = null, dlgReturn = null, dlgOpener = null;
  function confirmDlg(title, body, yes, cb) {
    dlgReturn = openSheet ? openSheet.id : null; dlgOpener = openSheet ? lastFocus : null;
    $('#dlg-title').textContent = title;
    var b = $('#dlg-body'); b.innerHTML = '';
    if (typeof body === 'string') b.appendChild(el('p', '', body)); else b.appendChild(body);
    $('#dlg-yes').textContent = yes; dlgCb = cb;
    var prevFocus = document.activeElement;
    showSheet('dlg'); if (dlgReturn) lastFocus = prevFocus;
    $('#dlg-no').focus();
  }
  function dlgAnswer(ok) {
    var cb = dlgCb, back = dlgReturn, f = lastFocus; dlgCb = null;
    closeSheet(true);
    if (back) { showSheet(back); lastFocus = dlgOpener; }
    if (f && f.focus && document.contains(f) && f.offsetParent !== null) f.focus();
    if (cb) cb(ok);
  }
  $('#dlg-yes').addEventListener('click', function () { dlgAnswer(true); });
  $('#dlg-no').addEventListener('click', function () { dlgAnswer(false); });

  /* ---------- plan: current day, tags, timer ---------- */
  function currentDay() { for (var d = 1; d <= 28; d++) if (!S.done[d]) return d; return 0; }
  function weekOf(d) { return C.weeks[Math.ceil(d / 7) - 1]; }
  function dayText(d) { return weekOf(d).days[(d - 1) % 7]; }

  function tagButtons(d, host) {
    var p = PLAN[d];
    p.bpm.forEach(function (b) {
      var t = el('button', 'tag', b + ' BPM'); t.type = 'button';
      t.addEventListener('click', function () { setBpm(b); save(); toast(b + ' BPM set'); });
      host.appendChild(t);
    });
    if (p.subdiv && p.subdiv.length) {
      var list = p.subdiv;
      var t = el('button', 'tag', list.map(function (n) { return SUB_NAME[n]; }).join(' / ')); t.type = 'button';
      t.addEventListener('click', function () {
        var i = list.indexOf(S.subdiv), n = list[(i + 1) % list.length]; // cycles; starts at the first if current isn't listed
        if (list.length === 1) n = list[0];
        setSubdiv(n); save(); toast(SUB_NAME[n] + ' set');
      });
      host.appendChild(t);
    }
    if (p.suggest) {
      var sg = p.suggest, s = el('button', 'tag sugg', SUB_NAME[sg.subdiv] + ' (' + sg.note + ') suggested'); s.type = 'button';
      s.title = 'Editorial suggestion, not from the plan text';
      s.addEventListener('click', function () { setSubdiv(sg.subdiv); save(); toast(SUB_NAME[sg.subdiv] + ' set'); });
      host.appendChild(s);
    }
  }
  function renderToday() {
    var d = currentDay(), tg = $('#today-tags'); tg.innerHTML = '';
    if (!d) { $('#today-day').textContent = 'Plan complete'; return; }
    $('#today-day').textContent = 'Day ' + d;
    var p = PLAN[d];
    p.bpm.forEach(function (b) { tg.appendChild(el('span', 'ttag', String(b))); });
    if (p.bpm.length) tg.appendChild(el('span', 'tunit', 'BPM'));
    if (p.subdiv) tg.appendChild(el('span', 'ttag', p.subdiv.map(function (n) { return SUB_NAME[n]; }).join('/')));
  }
  function fillTodaySheet() {
    var d = currentDay();
    $('#td-complete').hidden = !!d; $('#td-done').hidden = !d; $('#timer').hidden = !d;
    $('#td-text').hidden = !d; $('#td-struct').hidden = !d; $('#td-week').hidden = !d;
    $('#td-tags').innerHTML = '';
    if (!d) { $('#td-title').textContent = 'Plan complete'; return; }
    var w = weekOf(d);
    $('#td-title').textContent = 'Day ' + d;
    $('#td-week').textContent = w.title;
    $('#td-text').textContent = dayText(d);
    tagButtons(d, $('#td-tags'));
    $('#td-struct-h').textContent = w.structureHeading;
    var list = el(w.structureOrdered ? 'ol' : 'ul', 'structure');
    w.structure.forEach(function (s) { list.appendChild(el('li', '', s)); });
    var host = $('#td-struct-list'); host.innerHTML = ''; host.appendChild(list);
    timerForDay(d);
  }
  $('#today').addEventListener('click', function () { fillTodaySheet(); showSheet('sheet-today'); });
  $('#td-done').addEventListener('click', function () {
    var d = currentDay(); if (!d) return;
    confirmDlg('Mark Day ' + d + ' done?', 'Day ' + d + ' will be checked off in the plan.', 'Mark done', function (ok) {
      if (!ok) return;
      S.done[d] = true; save(); syncChecks(); renderToday(); fillTodaySheet(); toast('Day ' + d + ' done');
    });
  });

  // Session timer: wall-clock deltas (Date.now), never tick counting, so it stays right when throttled.
  var T = { day: 0, len: 20, running: false, endAt: 0, left: 1200000, segIdx: 0, iv: 0 };
  function segs4(d) { var p = PLAN[d]; return p.seg || null; }
  function timerForDay(d) {
    if (T.day === d) { renderTimer(); return; }
    timerReset(); T.day = d; T.len = PLAN[d].min; T.left = T.len * 60000; renderTimer();
  }
  function timerLeft() { return T.running ? Math.max(0, T.endAt - Date.now()) : T.left; }
  function segIndexAt(elapsedMs) {
    var sg = segs4(T.day); if (!sg) return -1;
    var acc = 0; for (var i = 0; i < sg.length; i++) { acc += sg[i].min * 60000; if (elapsedMs < acc) return i; }
    return sg.length - 1;
  }
  function renderTimer() {
    var left = timerLeft(), s = Math.ceil(left / 1000);
    $('#tm-time').textContent = ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
    $('#tm-len').textContent = T.len + ' min';
    var sg = segs4(T.day), segEl = $('#tm-seg');
    if (sg) {
      var i = segIndexAt(T.len * 60000 - left);
      segEl.textContent = sg.map(function (x) { return x.label + ' ' + x.min; }).join(' / ') + ' min. Now: ' + sg[i].label;
    } else segEl.textContent = '';
    $('#tm-go').textContent = T.running ? 'Pause' : (left < T.len * 60000 && left > 0 ? 'Resume' : 'Start timer');
    var lock = !!sg; $('#tm-dec').disabled = lock || T.running; $('#tm-inc').disabled = lock || T.running;
  }
  function timerTick() {
    var left = timerLeft(), i = segIndexAt(T.len * 60000 - left);
    if (i > T.segIdx) { T.segIdx = i; chime(); announce(segs4(T.day)[i].label + ' segment'); }
    if (left <= 0) { T.running = false; T.left = 0; clearInterval(T.iv); chime(); announce('Session time is up'); }
    renderTimer();
  }
  function timerReset() { T.running = false; clearInterval(T.iv); T.left = T.len * 60000; T.segIdx = 0; }
  $('#tm-go').addEventListener('click', function () {
    if (T.running) { T.left = timerLeft(); T.running = false; clearInterval(T.iv); }
    else { if (T.left <= 0) timerReset(); ensureAudio(); T.endAt = Date.now() + T.left; T.running = true; clearInterval(T.iv); T.iv = setInterval(timerTick, 250); }
    renderTimer();
  });
  $('#tm-reset').addEventListener('click', function () { timerReset(); renderTimer(); });
  function lenStep(d) { return function () { if (T.running || segs4(T.day)) return; T.len = clamp(T.len + 5 * d, 5, 60); T.left = T.len * 60000; T.segIdx = 0; renderTimer(); }; }
  $('#tm-dec').addEventListener('click', lenStep(-1)); $('#tm-inc').addEventListener('click', lenStep(1));

  /* ---------- plan tab ---------- */
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function weekCount(n) { var c = 0; for (var i = 1; i <= 7; i++) if (S.done[(n - 1) * 7 + i]) c++; return c; }
  function totalDone() { var c = 0; for (var i = 1; i <= 28; i++) if (S.done[i]) c++; return c; }
  function refreshProgress() {
    C.weeks.forEach(function (w) {
      var c = weekCount(w.n), card = $('.week[data-week="' + w.n + '"]');
      $('.wprog', card).textContent = c + '/7 days complete';
      $('.wbar i', card).style.width = (c / 7 * 100) + '%';
    });
    var t = totalDone();
    $('#overall-text').textContent = t + '/28 days complete';
    $('#overall-bar').style.width = (t / 28 * 100) + '%';
  }
  function syncChecks() {
    for (var d = 1; d <= 28; d++) { var cb = $('#day-' + d); if (cb) cb.checked = !!S.done[d]; }
    var cur = currentDay();
    $$('.days > li').forEach(function (li) { li.classList.toggle('is-today', +li.dataset.day === cur); });
    refreshProgress();
  }
  function setWeekOpen(card, open) {
    var body = $('.weekbody', card), head = $('.weekhead', card);
    body.hidden = !open; card.classList.toggle('open', open); head.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function renderSchedule() {
    var host = $('#weeks'); host.innerHTML = '';
    var curW = currentDay() ? Math.ceil(currentDay() / 7) : 0;
    C.weeks.forEach(function (w) {
      var card = el('article', 'week'); card.dataset.week = w.n;
      var h = el('h3'); var head = el('button', 'weekhead'); head.type = 'button'; head.setAttribute('aria-controls', 'week-body-' + w.n);
      // Verbatim title split at " — " for presentation; the separator stays in the DOM (visually hidden).
      var cut = w.title.indexOf(' — '), tt = el('span', 'wtitle');
      if (cut > 0) { tt.appendChild(el('span', 'weyebrow', w.title.slice(0, cut))); tt.appendChild(el('span', 'sr-only', ' — ')); tt.appendChild(el('span', 'wname', w.title.slice(cut + 3))); }
      else tt.textContent = w.title;
      head.appendChild(tt);
      if (w.subtitle) head.appendChild(el('span', 'wsub', w.subtitle));
      head.appendChild(el('span', 'wprog', '0/7 days complete'));
      var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('class', 'chev'); chev.setAttribute('aria-hidden', 'true');
      chev.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'; head.appendChild(chev);
      var bar = el('span', 'wbar'); bar.appendChild(document.createElement('i')); head.appendChild(bar);
      h.appendChild(head); card.appendChild(h);

      var body = el('div', 'weekbody'); body.id = 'week-body-' + w.n;
      var det = el('details', 'struct'); if (w.n === curW) det.open = true;
      det.appendChild(el('summary', '', w.structureHeading));
      var list = el(w.structureOrdered ? 'ol' : 'ul', 'structure');
      w.structure.forEach(function (s) { list.appendChild(el('li', '', s)); });
      det.appendChild(list); body.appendChild(det);
      body.appendChild(el('h4', 'sechead', w.pacingHeading));
      var ul = el('ul', 'days');
      w.days.forEach(function (text, i) {
        var n = (w.n - 1) * 7 + i + 1;
        var li = el('li'); li.dataset.day = n;
        var lab = el('label', 'day');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'day-' + n; cb.checked = !!S.done[n];
        cb.addEventListener('change', function () { if (cb.checked) S.done[n] = true; else delete S.done[n]; save(); syncChecks(); renderToday(); });
        var box = el('span', 'box'); box.innerHTML = CHECK; box.setAttribute('aria-hidden', 'true');
        var tx = el('span', 'daytext'); tx.appendChild(el('strong', '', 'Day ' + n)); tx.appendChild(document.createTextNode(' ')); tx.appendChild(el('span', 'dtext', text));
        lab.appendChild(cb); lab.appendChild(box); lab.appendChild(tx); li.appendChild(lab);
        var tags = el('div', 'tags'); tagButtons(n, tags); if (tags.childNodes.length) li.appendChild(tags);
        ul.appendChild(li);
      });
      body.appendChild(ul); card.appendChild(body);
      head.addEventListener('click', function () {
        var o = body.hidden; setWeekOpen(card, o);
        if (o) S.open[w.n] = true; else delete S.open[w.n]; save();
      });
      setWeekOpen(card, !!S.open[w.n] || w.n === curW);
      host.appendChild(card);
    });
    syncChecks();
  }
  function revealToday() {
    var d = currentDay(); if (!d) return;
    var card = $('.week[data-week="' + Math.ceil(d / 7) + '"]'); setWeekOpen(card, true);
    var row = $('.days > li[data-day="' + d + '"]');
    if (row) requestAnimationFrame(function () { row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); });
  }

  /* ---------- baseline card (app-level, not content.js) ---------- */
  function renderBase() {
    ['before', 'final'].forEach(function (k) {
      $('#base-' + k).checked = !!S.base[k];
      $('#base-' + k + '-date').textContent = S.base[k] ? '(done ' + fmtDate(S.base[k]) + ')' : '';
    });
  }
  ['before', 'final'].forEach(function (k) {
    $('#base-' + k).addEventListener('change', function (e) { S.base[k] = e.target.checked ? todayISO() : ''; save(); renderBase(); });
  });

  /* ---------- guide: rules, sound, settings ---------- */
  function renderRules() {
    $('#rules-title').textContent = C.rulesHeading;
    var ol = $('#rules'); ol.innerHTML = '';
    C.rules.forEach(function (r) { var li = el('li'); li.appendChild(el('h3', '', r.h)); li.appendChild(el('p', '', r.t)); ol.appendChild(li); });
  }
  var vol = $('#vol');
  function setVol(v) {
    S.vol = clamp(Math.round(+v), 0, 100); vol.value = S.vol; $('#vol-out').textContent = S.vol + '%';
    vol.style.setProperty('--fill', S.vol + '%'); vol.setAttribute('aria-valuetext', S.vol + '%');
    if (master) master.gain.setTargetAtTime(S.vol / 100, ctx.currentTime, 0.01);
  }
  vol.addEventListener('input', function () { setVol(vol.value); });
  vol.addEventListener('change', save);
  function radioGroup(host, items, get, set) {
    items.forEach(function (it, i) {
      var b = el('button', 'opt', it.label); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = it.v;
      b.addEventListener('click', function () { set(it.v); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (d) { e.preventDefault(); var n = items[(i + d + items.length) % items.length]; set(n.v); $('[data-v="' + n.v + '"]', host).focus(); }
      });
      host.appendChild(b);
    });
    return function () { $$('.opt', host).forEach(function (b) { var on = b.dataset.v === get(); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }); };
  }
  var syncSound = radioGroup($('#sound'), SOUNDS.map(function (s) { return { v: s, label: SOUND_NAME[s] }; }),
    function () { return S.sound; },
    function (v) { S.sound = v; save(); syncSound(); if (!running && ensureAudio()) { var t = ctx.currentTime + 0.03; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(1, t); click(t, 2); bus.gain.setValueAtTime(0, t + 0.1); } });

  // Export / import / reset
  $('#export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'the-pocket-progress-' + todayISO() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    $('#settings-msg').textContent = 'Progress exported.';
  });
  $('#import').addEventListener('click', function () { $('#import-file').click(); });
  $('#import-file').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var o = null; try { o = JSON.parse(r.result); } catch (err) { o = null; }
      if (!isObj(o)) { $('#settings-msg').textContent = 'That file is not a Pocket progress file. Nothing changed.'; return; }
      var n = sanitize(o), days = Object.keys(n.done).length;
      confirmDlg('Import progress?', 'This replaces your current progress with the file: ' + days + ' checked days, ' + n.hist.length + ' clock tests.', 'Import', function (ok) {
        if (!ok) return;
        n.tab = S.tab; S = n; writeNow(); applyAll(); $('#settings-msg').textContent = 'Progress imported.';
      });
    };
    r.readAsText(f); e.target.value = '';
  });
  $('#reset').addEventListener('click', function () {
    var days = totalDone(), base = (S.base.before ? 1 : 0) + (S.base.final ? 1 : 0), wrap = el('div');
    wrap.appendChild(el('p', '', 'Choose what to clear. This cannot be undone.'));
    var opts = [['r-days', 'Checked days (' + days + ' of 28 will be cleared)'], ['r-base', 'Recording checklist (' + base + ' checked)'], ['r-hist', 'Clock test history (' + S.hist.length + ' results)']];
    opts.forEach(function (o) {
      var l = el('label', 'check'), c = document.createElement('input'); c.type = 'checkbox'; c.id = o[0]; c.checked = true;
      l.appendChild(c); var bx = el('span', 'box'); bx.setAttribute('aria-hidden', 'true'); l.appendChild(bx); l.appendChild(el('span', '', o[1])); wrap.appendChild(l);
    });
    confirmDlg('Reset progress?', wrap, 'Reset', function (ok) {
      if (!ok) return;
      if ($('#r-days').checked) { S.done = {}; }
      if ($('#r-base').checked) S.base = { before: '', final: '' };
      if ($('#r-hist').checked) S.hist = [];
      writeNow(); applyAll(); $('#settings-msg').textContent = 'Progress reset.';
    });
  });

  /* ---------- D. clock training ---------- */
  var syncModes = radioGroup($('#modes'), MODES.map(function (m) { return { v: m, label: MODE_NAME[m] }; }),
    function () { return S.mode.type; },
    function (v) { S.mode.type = v; save(); renderMode(); announce(MODE_NAME[v]); });
  function renderMode() {
    syncModes();
    var m = S.mode;
    $('#opt-silent').hidden = m.type !== 'silent'; $('#opt-random').hidden = m.type !== 'random';
    $('#on-val').textContent = m.on; $('#off-val').textContent = m.off; $('#ch-val').textContent = m.chance + '%';
    $('#keepvis').checked = m.keepVis;
    $('#ct-mode').textContent = MODE_NAME[m.type] + (m.type === 'silent' ? ' ' + m.on + '/' + m.off : m.type === 'random' ? ' ' + m.chance + '%' : '');
    document.body.classList.toggle('mode-on', m.type !== 'off');
  }
  function numStep(id, key, d, lo, hi) { $(id).addEventListener('click', function () { S.mode[key] = clamp(S.mode[key] + d, lo, hi); save(); renderMode(); }); }
  numStep('#on-dec', 'on', -1, 1, 4); numStep('#on-inc', 'on', 1, 1, 4);
  numStep('#off-dec', 'off', -1, 1, 4); numStep('#off-inc', 'off', 1, 1, 4);
  numStep('#ch-dec', 'chance', -5, 10, 50); numStep('#ch-inc', 'chance', 5, 10, 50);
  $('#keepvis').addEventListener('change', function (e) { S.mode.keepVis = e.target.checked; save(); });
  $('#ct-open').addEventListener('click', function () { renderMode(); renderHist(); showSheet('sheet-ct'); });

  // Clock test: same scheduler, beats only. Bar 0 count-in, bars 1-4 = 16 beats with click, bars 5-8 = 16 silent beats.
  function startTest() {
    stop();
    test = { t0: 0, taps: [], done: false, endAt: 0 };
    $('#test-result').hidden = true; $('#tapzone').hidden = false; $('#test-go').textContent = 'Cancel test';
    start();
    $('#tapzone').focus();
  }
  function abortTest() { test = null; $('#tapzone').hidden = true; $('#test-go').textContent = 'Start clock test'; $('#test-status').textContent = ''; }
  $('#test-go').addEventListener('click', function () { if (test) { stop(); abortTest(); } else startTest(); });
  function testTap(perfMs) {
    if (!test || !running) return;
    // Phase is decided on the audio clock; intervals use the event timestamps (latency cancels out in intervals).
    test.taps.push({ ms: perfMs, at: ctx.currentTime - (ctx.outputLatency || 0) });
    var z = $('#tapzone'); z.classList.add('hit'); setTimeout(function () { z.classList.remove('hit'); }, 80);
  }
  $('#tapzone').addEventListener('pointerdown', function (e) { if (e.button > 0) return; e.preventDefault(); testTap(e.timeStamp || performance.now()); });
  $('#tapzone').addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); testTap(e.timeStamp || performance.now()); } else if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); });
  $('#tapzone').addEventListener('click', function (e) { e.preventDefault(); });
  var lastStatus = '';
  function updateTestStatus(now) {
    var beat = 60 / S.bpm, b = Math.floor((now - test.t0) / beat), s;
    if (b < 4) s = 'Count-in: listen';
    else if (b < 20) s = 'With click: tap along (' + (b - 3) + '/16)';
    else s = 'Silent: keep tapping (' + Math.min(16, b - 19) + '/16)';
    if (s !== lastStatus) { var phase = s.split(':')[0]; if (phase !== lastStatus.split(':')[0]) announce(phase); lastStatus = s; $('#test-status').textContent = s; }
  }
  function phaseStats(times, beatMs) {
    var iv = [], extra = 0;
    for (var i = 1; i < times.length; i++) {
      var d = times[i] - times[i - 1], r = d / beatMs;
      if (r < 0.5) extra++;          // a double tap, not a beat
      else if (r <= 1.5) iv.push(d); // gaps over 1.5 beats are missed taps, kept out of the spread
    }
    var mean = iv.length ? iv.reduce(function (a, b) { return a + b; }, 0) / iv.length : 0;
    var sd = iv.length > 1 ? Math.sqrt(iv.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (iv.length - 1)) : 0;
    return { n: times.length, iv: iv.length, mean: mean, sd: sd, missed: Math.max(0, 16 - (times.length - extra)), extra: extra };
  }
  function finishTest() {
    var t = test; t.done = true;
    var beat = 60 / S.bpm, half = beat / 2, a = t.t0 + 4 * beat, b = t.t0 + 20 * beat, e = t.t0 + 36 * beat;
    var click = t.taps.filter(function (x) { return x.at >= a - half && x.at < b - half; }).map(function (x) { return x.ms; });
    var sil = t.taps.filter(function (x) { return x.at >= b - half && x.at < e + half; }).map(function (x) { return x.ms; });
    stop(); test = null; abortTest();
    var pc = phaseStats(click, beat * 1000), ps = phaseStats(sil, beat * 1000), box = $('#test-result');
    box.innerHTML = ''; box.hidden = false;
    if (pc.iv < 4 || ps.iv < 4) {
      box.appendChild(el('p', '', 'Not enough steady taps to measure (' + click.length + ' with click, ' + sil.length + ' silent). Try again and tap on every beat.'));
      return;
    }
    var drift = (ps.mean - pc.mean) / pc.mean * 100, r = { d: todayISO(), bpm: S.bpm, sdC: Math.round(pc.sd), sdS: Math.round(ps.sd), drift: Math.round(drift * 10) / 10 };
    box.appendChild(el('h3', 'cardh', 'Result at ' + r.bpm + ' BPM'));
    box.appendChild(el('p', '', 'With the click, your taps varied by about ' + r.sdC + ' ms from one to the next (standard deviation).'));
    box.appendChild(el('p', '', 'Without the click: about ' + r.sdS + ' ms.' + (r.sdS > r.sdC ? ' Your spacing got looser on your own.' : ' You held your spacing on your own.')));
    var dir = Math.abs(r.drift) < 1 ? 'You held the tempo (drift ' + r.drift + '%).' : r.drift > 0 ? 'You slowed down by ' + r.drift + '% without the click.' : 'You sped up by ' + Math.abs(r.drift) + '% without the click.';
    box.appendChild(el('p', '', dir));
    if (pc.missed + ps.missed + pc.extra + ps.extra) box.appendChild(el('p', 'help', 'Missed taps: ' + (pc.missed + ps.missed) + '. Extra taps: ' + (pc.extra + ps.extra) + '.'));
    box.appendChild(el('p', 'help', 'Lower numbers are steadier. Compare results at the same tempo.'));
    S.hist.push(r); if (S.hist.length > 50) S.hist = S.hist.slice(-50); save(); renderHist();
    announce('Clock test finished');
  }
  function renderHist() {
    var host = $('#hist'); host.innerHTML = '';
    var h = S.hist.slice(-10); if (!h.length) return;
    host.appendChild(el('h3', 'cardh', 'Last ' + h.length + ' tests'));
    if (h.length > 1) {
      var max = Math.max.apply(null, h.map(function (x) { return x.sdS; })) || 1, W = 200, H = 40;
      var pts = h.map(function (x, i) { return (i / (h.length - 1) * W).toFixed(1) + ',' + (H - 4 - x.sdS / max * (H - 8)).toFixed(1); }).join(' ');
      var wrap = el('div', 'spark');
      wrap.innerHTML = '<svg viewBox="-4 0 208 40" role="img" aria-label="Silent-phase spread across the last ' + h.length + ' tests"><polyline points="' + pts + '" fill="none" stroke="#e0b45c" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg><span>Silent-phase spread, oldest to newest</span>';
      host.appendChild(wrap);
    }
    var ul = el('ul', 'histlist');
    h.slice().reverse().forEach(function (x) { ul.appendChild(el('li', '', fmtDate(x.d) + ' · ' + x.bpm + ' BPM · click ' + x.sdC + ' ms · silent ' + x.sdS + ' ms · drift ' + (x.drift > 0 ? '+' : '') + x.drift + '%')); });
    host.appendChild(ul);
  }

  /* ---------- first-run hint ---------- */
  if (!S.hintSeen) $('#hint').hidden = false;
  $('#hint-x').addEventListener('click', function () { $('#hint').hidden = true; S.hintSeen = true; save(); });

  /* ---------- service worker (http/https only; file:// just skips it) ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function (e) { console.info('SW not registered', e && e.message); }); });
  }

  /* ---------- init ---------- */
  function applyAll() {
    renderSchedule(); renderBase(); renderToday(); renderMode();
    setBpm(S.bpm); setSubdiv(S.subdiv); setVol(S.vol); syncSound(); setTab(S.tab); renderHist();
  }
  renderRules(); applyAll(); renderGo();

  if (TEST) {
    window.__pocket = {
      log: LOG, stats: stats, tap: tap, start: start, stop: stop,
      setBpm: function (v) { var r = setBpm(v); save(); return r; },
      setSubdiv: function (n) { setSubdiv(n); save(); },
      state: function () { return { bpm: S.bpm, subdiv: S.subdiv, curSub: curSub, pendingSub: pendingSub, tab: S.tab, running: running, taps: taps.length, beat: beatIdx, bar: barIdx, mode: S.mode.type, ctxTime: ctx ? ctx.currentTime : 0, gate: bus ? bus.gain.value : null, live: live.length }; },
      resetTaps: function () { taps = []; }, clearLog: function () { LOG.length = 0; },
      testTap: function (ms) { testTap(ms); }, timer: T, raw: function () { return S; }
    };
  }
})();
