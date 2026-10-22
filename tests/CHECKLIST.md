# Acceptance checklist

Automated = `node tests/e2e.js` (see README). Manual = needs a real phone/ears.

| # | Check | How it is met | Verified by |
|---|-------|---------------|-------------|
| 1 | Start visible above tab bar without scrolling at 360x640, 375x667, 390x844, 412x915, 667x375; no h-overflow 320–768 | Practice is a fixed-height flex column; pad flexes, controls are fixed rows; Start is docked (fixed) above the tab bar; landscape is two panes | Automated (layout + overflow sweep) |
| 2 | 120 BPM eighths 10 s: intervals 0.250 s ±1 ms; accent on beat 1 | Lookahead scheduler on `ctx.currentTime`; level 2 only on beat 0 / sub 0 | Automated (scheduled times); audible accent: Manual |
| 3 | 16ths → triplets mid-beat: old beat finishes, new grid starts on a beat boundary | `pendingSub` applied only when `subIdx` wraps to 0 | Automated |
| 4 | 600 ms block at 200 BPM 16ths: no notes in the past, no burst, grid/beat correct | Missed steps are dropped and the grid advanced by k = ceil(late/step) | Automated |
| 5 | Stop leaves no clicks after ~10 ms | Gate gain ramps to 0 over 10 ms; queued sources are `stop()`ped | Automated (gate = 0, queue cleared); audible: Manual |
| 6 | Holding Space toggles once | `e.repeat` ignored | Automated |
| 7 | Corrupt storage never throws | `sanitize()` whitelist + try/catch | Automated (3 cases) |
| 8 | Offline reload with fonts; cache name changes only with shipped files; CI fails on stale sw.js | Hash-based version; `cache:'reload'`; sw-check workflow | Automated (offline); script run twice = same version; CI: on GitHub |
| 9 | axe-core 0 violations on Practice, Plan (all open), Guide, Today sheet, Clock sheet | | Automated |
| 10 | Today strip = first unchecked day; tags set tempo in place; timer accurate over 5 min | `currentDay()`; toast; timer uses `Date.now()` deltas | Automated (faked clock 5:00) |
| 11 | Silent bars 2/2: count-in, 2 audible, 2 silent with visuals hidden, repeating | `barIsSilent()` per bar | Automated (schedule + UI) ; audible: Manual |
| 12 | Clock test gives SD + drift % for both phases, stores history, no absolute offset | `phaseStats()` on tap intervals | Automated (synthetic taps); real taps: Manual |
| 13 | content.js byte-identical | | `tests/check-content.sh` |
| 14 | Works from file:// | Classic scripts; SW registration skipped off http(s) | Automated |

## Manual (phone on a stand)
- [ ] iPhone Safari + installed PWA: clicks audible with silent switch off; Wood / Click / Beep sound distinct; accent clear.
- [ ] 220 BPM sixteenths at 100% volume: no distortion.
- [ ] Phone call / Siri during playback: app stops and shows "Audio was interrupted. Tap Start to resume."
- [ ] Screen stays on while running; sleeps normally after Stop.
- [ ] Day 20 timer: soft chime at 10:00 (Pad → Guitar) and at the end.
- [ ] Clock test with real taps at 70 BPM gives sensible numbers.
- [ ] Landscape on a real phone: Start and controls reachable; safe areas respected (notch).
- [ ] Reduced motion on: no pulse ring on Stop, no pad scale animation.
