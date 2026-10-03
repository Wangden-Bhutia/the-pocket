/* The Pocket: metronome, 28-day schedule, practice rules. Vanilla JS, offline. */
(function () {
  'use strict';
  var C = window.POCKET_CONTENT;
  var KEY = 'thepocket.v1';
  var MIN_BPM = 40, MAX_BPM = 220, BEATS = 4;
  var LOOKAHEAD_MS = 25, SCHEDULE_AHEAD = 0.1;
  var PRESETS = [60, 70, 100, 120, 130];
  var SUBDIVS = [
    { n: 1, name: 'Quarter', hint: '1 / beat' },
    { n: 2, name: 'Eighth', hint: '2 / beat' },
    { n: 3, name: 'Triplets', hint: '3 / beat' },
    { n: 4, name: 'Sixteenth', hint: '4 / beat' }
  ];
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- state ---------- */
  var S = { bpm: 100, subdiv: 1, tab: 'metronome', done: {}, open: {} };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) { var o = JSON.parse(raw); for (var k in o) S[k] = o[k]; }
  } catch (e) { /* private mode etc. */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  S.bpm = clamp(Math.round(+S.bpm) || 100, MIN_BPM, MAX_BPM);
  if ([1, 2, 3, 4].indexOf(+S.subdiv) < 0) S.subdiv = 1; S.subdiv = +S.subdiv;
  if (['metronome', 'schedule', 'rules'].indexOf(S.tab) < 0) S.tab = 'metronome';

  /* ---------- test hook / stats ---------- */
  var LOG = [];
  var stats = { scheduled: 0, pulses: 0 };

  /* ---------- tabs ---------- */
  function setTab(name, focus) {
    S.tab = name; save();
    ['metronome', 'schedule', 'rules'].forEach(function (t) {
      var p = $('#panel-' + t), b = $('#tab-' + t), on = t === name;
      p.hidden = !on; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    updateMini();
    window.scrollTo(0, 0);
    if (focus) $('#tab-' + name).focus();
  }
  $$('.tabbar button').forEach(function (b, i, all) {
    b.addEventListener('click', function () { setTab(b.dataset.tab); });
    b.addEventListener('keydown', function (e) {
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (j >= 0) { e.preventDefault(); var t = all[(j + all.length) % all.length]; setTab(t.dataset.tab, true); }
    });
  });

  /* ---------- pad drawing ---------- */
  function octa(r, rot) {
    var pts = [];
    for (var i = 0; i < 8; i++) {
      var a = (rot + 45 * i) * Math.PI / 180;
      pts.push((150 + r * Math.cos(a)).toFixed(1) + ',' + (150 + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }
  (function drawPad() {
    $('#pad-rim').setAttribute('points', octa(140, 22.5));
    $('#pad-head').setAttribute('points', octa(128, 22.5));
    $('#pad-grain1').setAttribute('points', octa(106, 22.5));
    $('#pad-grain2').setAttribute('points', octa(118, 22.5));
    $('#pad-inner').setAttribute('points', octa(92, 22.5));
    $('#pad-flash').setAttribute('points', octa(128, 22.5));
    $('#ring-beat').setAttribute('points', octa(142, 22.5));
    $('#ring-sub').setAttribute('points', octa(142, 22.5));
    var g = $('#pad-lugs'), ns = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 8; i++) {
      var a = (22.5 + 45 * i) * Math.PI / 180, c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', (150 + 134 * Math.cos(a)).toFixed(1)); c.setAttribute('cy', (150 + 134 * Math.sin(a)).toFixed(1)); c.setAttribute('r', 4.2);
      g.appendChild(c);
    }
  })();

  /* ---------- BPM / subdivision UI ---------- */
  var elBpm = $('#bpm'), elSlider = $('#slider'), elGo = $('#go');
  function setBpm(v, quiet) {
    v = clamp(Math.round(+v) || S.bpm, MIN_BPM, MAX_BPM);
    S.bpm = v; elBpm.textContent = v; elSlider.value = v;
    elSlider.style.setProperty('--fill', ((v - MIN_BPM) / (MAX_BPM - MIN_BPM) * 100) + '%');
    elSlider.setAttribute('aria-valuetext', v + ' BPM');
    $$('#presets .chip').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.bpm === v ? 'true' : 'false'); });
    $('#mini-bpm').textContent = v;
    if (!quiet) save();
    return v;
  }
  elSlider.addEventListener('input', function () { setBpm(elSlider.value); });

  PRESETS.forEach(function (p) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = p; b.dataset.bpm = p;
    b.setAttribute('aria-label', 'Set tempo to ' + p + ' BPM'); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setBpm(p); });
    $('#presets').appendChild(b);
  });

  // hold-to-repeat steppers
  function holdRepeat(btn, delta) {
    var t0 = null, t1 = null;
    function step() { setBpm(S.bpm + delta); }
    function stop() { clearTimeout(t0); clearInterval(t1); t0 = t1 = null; btn.classList.remove('held'); }
    btn.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return; e.preventDefault(); btn.classList.add('held'); step();
      var n = 0;
      t0 = setTimeout(function () { t1 = setInterval(function () { n++; setBpm(S.bpm + delta * (n > 12 ? 5 : 1)); }, 90); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (ev) { btn.addEventListener(ev, stop); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); step(); } });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  holdRepeat($('#dec'), -1); holdRepeat($('#inc'), 1);

  // subdivision radiogroup
  var sdWrap = $('#subdiv');
  SUBDIVS.forEach(function (s) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'sd'; b.setAttribute('role', 'radio'); b.dataset.n = s.n;
    b.setAttribute('aria-label', s.name + ', ' + s.hint);
    b.innerHTML = '<b>' + s.name + '</b><span>' + s.hint + '</span>';
    b.addEventListener('click', function () { setSubdiv(s.n); });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (d) { e.preventDefault(); var n = clamp(S.subdiv + d, 1, 4); setSubdiv(n); $('.sd[data-n="' + n + '"]').focus(); }
    });
    sdWrap.appendChild(b);
  });
  function setSubdiv(n) {
    var old = S.subdiv; n = +n; S.subdiv = n;
    $$('.sd').forEach(function (b) { var on = +b.dataset.n === n; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    if (running && old !== n) {
      // finish the current beat at the old grid, then start the new grid on a beat boundary
      if (subIdx !== 0) { nextTime += (old - subIdx) * (60 / S.bpm / old); beatIdx = (beatIdx + 1) % BEATS; }
      subIdx = 0;
    }
    save();
  }

  /* ---------- tap tempo ---------- */
  var taps = [];
  function tap(now) {
    now = now == null ? performance.now() : now;
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now); if (taps.length > 6) taps.shift();
    if (taps.length >= 2) {
      var iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(60000 / iv);
    }
    return taps.length;
  }
  var tapBtn = $('#tap');
  tapBtn.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return; e.preventDefault(); tapBtn.classList.add('hit'); tap();
    setTimeout(function () { tapBtn.classList.remove('hit'); }, 90);
  });
  tapBtn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tap(); } });

  /* ---------- audio engine ---------- */
  var ctx = null, running = false, timer = null, rafId = 0, nextTime = 0, beatIdx = 0, subIdx = 0, queue = [], wake = null, unlocked = false;

  function ensureAudio() {
    if (!ctx) {
      var A = window.AudioContext || window.webkitAudioContext;
      if (!A) return false;
      try { ctx = new A({ latencyHint: 'interactive' }); } catch (e) { ctx = new A(); }
    }
    if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} }
    if (ctx.state !== 'running') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    if (!unlocked) { // iOS unlock: play one silent sample inside the gesture
      try { var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); unlocked = true; } catch (e) {}
    }
    return true;
  }
  // level: 2 accent (beat 1), 1 beat, 0 subdivision
  function click(time, level) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    var f = level === 2 ? 1568 : level === 1 ? 1046 : 784;
    var peak = level === 2 ? 0.95 : level === 1 ? 0.6 : 0.22;
    o.type = 'sine'; o.frequency.setValueAtTime(f, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + (level === 2 ? 0.07 : 0.05));
    o.connect(g); g.connect(ctx.destination);
    o.start(time); o.stop(time + 0.09);
  }
  function scheduleNote() {
    var level = subIdx === 0 ? (beatIdx === 0 ? 2 : 1) : 0;
    click(nextTime, level);
    queue.push({ time: nextTime, beat: beatIdx, sub: subIdx, level: level });
    stats.scheduled++;
    LOG.push({ t: nextTime, beat: beatIdx, sub: subIdx, level: level, n: S.subdiv, bpm: S.bpm }); if (LOG.length > 4000) LOG.shift();
  }
  function advance() {
    nextTime += 60 / S.bpm / S.subdiv;
    subIdx++;
    if (subIdx >= S.subdiv) { subIdx = 0; beatIdx = (beatIdx + 1) % BEATS; }
  }
  function scheduler() {
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) { scheduleNote(); advance(); }
    timer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  /* ---------- visuals (rAF against audio clock) ---------- */
  var ringBeat = $('#ring-beat'), ringSub = $('#ring-sub'), flash = $('#pad-flash'), dots = $$('#beats i');
  function pulse(n) {
    stats.pulses++;
    if (n.sub === 0) {
      var acc = n.level === 2;
      dots.forEach(function (d, i) { d.classList.toggle('on', i === n.beat); });
      ringBeat.style.stroke = acc ? '#e0b45c' : '#c9633a';
      ringBeat.style.strokeWidth = acc ? 7 : 4;
      if (reduceMotion) { ringBeat.animate([{ opacity: acc ? 1 : .7 }, { opacity: 0 }], { duration: 200 }); }
      else ringBeat.animate([{ transform: 'scale(1)', opacity: acc ? 1 : .8 }, { transform: 'scale(' + (acc ? 1.32 : 1.18) + ')', opacity: 0 }], { duration: acc ? 560 : 420, easing: 'ease-out' });
      flash.style.fill = acc ? '#e0b45c' : '#b0522e';
      flash.animate([{ opacity: acc ? .5 : .28 }, { opacity: 0 }], { duration: acc ? 260 : 200, easing: 'ease-out' });
    } else if (!reduceMotion) {
      ringSub.animate([{ transform: 'scale(1)', opacity: .45 }, { transform: 'scale(1.07)', opacity: 0 }], { duration: 240, easing: 'ease-out' });
    }
  }
  function draw() {
    if (!running) return;
    var now = ctx.currentTime - (ctx.outputLatency || 0);
    while (queue.length && queue[0].time <= now) {
      var n = queue.shift();
      if (now - n.time < 0.25) pulse(n); // skip stale pulses (e.g. after tab was hidden)
    }
    rafId = requestAnimationFrame(draw);
  }

  /* ---------- wake lock ---------- */
  function lockScreen() {
    if (!('wakeLock' in navigator) || wake) return;
    navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {});
  }
  function unlockScreen() { if (wake) { wake.release().catch(function () {}); wake = null; } }
  document.addEventListener('visibilitychange', function () { if (running && !document.hidden) { lockScreen(); cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); } });

  /* ---------- start / stop ---------- */
  function start() {
    if (running) return;
    if (!ensureAudio()) { alert('Web Audio is not available in this browser.'); return; }
    running = true; beatIdx = 0; subIdx = 0; queue = [];
    nextTime = ctx.currentTime + 0.08;
    scheduler(); rafId = requestAnimationFrame(draw); lockScreen();
    elGo.textContent = 'Stop'; elGo.setAttribute('aria-pressed', 'true'); updateMini();
  }
  function stop() {
    if (!running) return;
    running = false; clearTimeout(timer); cancelAnimationFrame(rafId); queue = []; unlockScreen();
    dots.forEach(function (d) { d.classList.remove('on'); });
    elGo.textContent = 'Start'; elGo.setAttribute('aria-pressed', 'false'); updateMini();
  }
  function toggle() { running ? stop() : start(); }
  elGo.addEventListener('click', toggle);
  $('#mini-stop').addEventListener('click', stop);
  function updateMini() { $('#mini').hidden = !(running && S.tab !== 'metronome'); }
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return;
    e.preventDefault(); toggle();
  });

  /* ---------- schedule ---------- */
  var BPM_RE = /\d{2,3}(?:(?:\/|, and |, then |, | and )\d{2,3})*\s*BPM/g;
  function tempoHints(text) {
    var found = [], m;
    BPM_RE.lastIndex = 0;
    while ((m = BPM_RE.exec(text))) { (m[0].match(/\d{2,3}/g) || []).forEach(function (n) { n = +n; if (n >= MIN_BPM && n <= MAX_BPM && found.indexOf(n) < 0) found.push(n); }); }
    return found;
  }
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function weekCounts(w) { var base = (w.n - 1) * 7, c = 0; for (var i = 1; i <= 7; i++) if (S.done[base + i]) c++; return c; }
  function totalDone() { var c = 0; for (var i = 1; i <= 28; i++) if (S.done[i]) c++; return c; }
  function refreshProgress() {
    C.weeks.forEach(function (w) {
      var c = weekCounts(w), card = $('.week[data-week="' + w.n + '"]');
      $('.wprog', card).textContent = c + '/7 days complete';
      $('.wbar i', card).style.width = (c / 7 * 100) + '%';
    });
    var t = totalDone();
    $('#overall-text').textContent = t + '/28 days complete';
    $('#overall-bar').style.width = (t / 28 * 100) + '%';
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function renderSchedule() {
    var host = $('#weeks'); host.innerHTML = '';
    C.weeks.forEach(function (w) {
      var open = !!S.open[w.n];
      var card = el('article', 'week' + (open ? ' open' : '')); card.dataset.week = w.n;
      var h = el('h3'); var head = el('button', 'weekhead'); head.type = 'button';
      head.setAttribute('aria-expanded', open ? 'true' : 'false'); head.setAttribute('aria-controls', 'week-body-' + w.n);
      head.appendChild(el('span', 'wtitle', w.title));
      if (w.subtitle) head.appendChild(el('span', 'wsub', w.subtitle));
      head.appendChild(el('span', 'wprog', '0/7 days complete'));
      var chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); chev.setAttribute('viewBox', '0 0 24 24'); chev.setAttribute('class', 'chev'); chev.setAttribute('aria-hidden', 'true');
      chev.innerHTML = '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'; head.appendChild(chev);
      var bar = el('span', 'wbar'); bar.appendChild(document.createElement('i')); head.appendChild(bar);
      h.appendChild(head); card.appendChild(h);

      var body = el('div', 'weekbody'); body.id = 'week-body-' + w.n; body.hidden = !open; body.setAttribute('role', 'region'); body.setAttribute('aria-label', w.title);
      body.appendChild(el('h4', 'sechead', w.structureHeading));
      var list = el(w.structureOrdered ? 'ol' : 'ul', 'structure');
      w.structure.forEach(function (s) { list.appendChild(el('li', '', s)); });
      body.appendChild(list);
      body.appendChild(el('h4', 'sechead', w.pacingHeading));
      var ul = el('ul', 'days');
      w.days.forEach(function (text, i) {
        var n = (w.n - 1) * 7 + i + 1;
        var li = el('li'); var lab = el('label', 'day');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'day-' + n; cb.checked = !!S.done[n];
        cb.addEventListener('change', function () { if (cb.checked) S.done[n] = true; else delete S.done[n]; save(); refreshProgress(); });
        var box = el('span', 'box'); box.innerHTML = CHECK;
        var tx = el('span', 'daytext'); tx.appendChild(el('strong', '', 'Day ' + n)); tx.appendChild(el('span', 'dtext', text));
        lab.appendChild(cb); lab.appendChild(box); lab.appendChild(tx); li.appendChild(lab);
        var hints = tempoHints(text);
        if (hints.length) {
          var chips = el('div', 'chips');
          hints.forEach(function (b) {
            var c = el('button', 'tchip', 'Set ' + b + ' BPM'); c.type = 'button'; c.setAttribute('aria-label', 'Set metronome to ' + b + ' BPM');
            c.addEventListener('click', function () { setBpm(b); setTab('metronome'); }); chips.appendChild(c);
          });
          li.appendChild(chips);
        }
        ul.appendChild(li);
      });
      body.appendChild(ul); card.appendChild(body);
      head.addEventListener('click', function () {
        var o = body.hidden; body.hidden = !o; card.classList.toggle('open', o); head.setAttribute('aria-expanded', o ? 'true' : 'false');
        if (o) S.open[w.n] = true; else delete S.open[w.n]; save();
      });
      host.appendChild(card);
    });
    refreshProgress();
  }

  /* ---------- rules ---------- */
  function renderRules() {
    $('#rules-title').textContent = C.rulesHeading;
    var ol = $('#rules'); ol.innerHTML = '';
    C.rules.forEach(function (r) { var li = el('li'); li.appendChild(el('h3', '', r.h)); li.appendChild(el('p', '', r.t)); ol.appendChild(li); });
  }

  /* ---------- service worker (http/https only) ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function (e) { console.info('SW not registered', e && e.message); }); });
  }

  /* ---------- init ---------- */
  renderSchedule(); renderRules();
  setBpm(S.bpm, true); setSubdiv(S.subdiv); setTab(S.tab);
  window.__pocket = {
    log: LOG, stats: stats, tap: tap, setBpm: setBpm, setSubdiv: setSubdiv, start: start, stop: stop,
    state: function () { return { bpm: S.bpm, subdiv: S.subdiv, tab: S.tab, running: running, taps: taps.length }; },
    resetTaps: function () { taps = []; }, clearLog: function () { LOG.length = 0; }
  };
})();
