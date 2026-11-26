# The Pocket

A static, vanilla HTML/CSS/JS PWA for a guitarist/singer building rhythm and timing on a 12" practice pad:
a Web Audio metronome (tap tempo, 40–220 BPM, quarter/eighth/triplet/sixteenth, three click sounds, volume),
clock-training modes (silent bars, beat 1 only, backbeat, random silence) with a tap-along clock test,
a timing check that grades every hit as in the pocket / close / early / late (microphone or screen taps),
a 28-day plan with a Today strip, tempo tags and a session timer, and five practice rules.
Works offline. No frameworks, no dependencies, no runtime network calls.

Live: https://wangden-bhutia.github.io/the-pocket/

## Files
- `index.html`, `style.css`, `app.js` – the app (classic scripts, so `file://` works).
- `content.js` – verbatim schedule/rules text. **Never edit without explicit approval** (hash in tests/check-content.sh).
- `plan-data.js` – structured tempo/subdivision/timer data per day, taken only from what the text states.
  Entries under `suggest` are editorial and are shown with a dashed outline and the word "suggested".
- `manifest.webmanifest`, `sw.js` (generated precache), `tools/build-sw.js`, `fonts/`, `icons/`.
- `tests/` – browser checks (`e2e.js`), `check-content.sh`, and `CHECKLIST.md` (manual acceptance checks).

## Run locally
```sh
cd ..                                   # serve the parent so the app is at /the-pocket/ like on Pages
python3 -m http.server 8766 --bind 127.0.0.1
# open http://127.0.0.1:8766/the-pocket/   (add ?test=1 to expose window.__pocket test hooks)
```
Opening `index.html` directly (file://) also works; the service worker is simply skipped.

## After changing any shipped file: rebuild the service worker
```sh
node tools/build-sw.js        # prints the new cache version, e.g. pocket-d40fc4a8b6 14 assets
```
The version is a hash of every shipped file, so it changes only when a shipped file changes. Dotfiles,
`README.md`, `sw.js`, `tools/`, `tests/`, `screenshots/` and `*.zip` are not shipped.
CI (`.github/workflows/sw-check.yml`) reruns the script and fails if `sw.js` would change (stale precache).

## Running the checks
```sh
./tests/check-content.sh                                   # content.js matches the approved text (sha256)
mkdir -p ../pocket-tools && (cd ../pocket-tools && npm i playwright-core axe-core)   # dev-only, outside the repo
NODE_PATH=../pocket-tools/node_modules node tests/e2e.js   # needs Google Chrome and the server above
```
`e2e.js` covers layout at 360x640/375x667/390x844/412x915/667x375, overflow 320–768, scheduler timing,
subdivision switching, a forced 600 ms main-thread stall, Stop, Space, corrupt storage, v1 migration,
offline reload, file://, axe-core (WCAG 2.1 A/AA + best practice), tags, timer, silent bars and the clock test.
`e2e-timing.js` (same setup) covers the onset detector on a synthetic signal, grading, tap calibration and runs,
the microphone path with a silent fake device (count-in echo, gate, release on close) and the Practice row at 320/360 px.
Things only a real phone can show (audible clicks, iOS silent switch, interruptions) are in `tests/CHECKLIST.md`.

## Timing check
Practice > Timing check. One count-in bar, then 16 beats with the click at the current tempo. Each hit is graded:
in the pocket (within 25 ms), close (within 50 ms), early, late or missed. Score = in the pocket + half of close,
over 16. 85% or more: move up a tempo; 60% or more: hold this tempo (constants `TC_*` in app.js).
- Microphone: a ScriptProcessor feeds an onset detector; hit times come from the audio clock, not the main thread.
  The phone's delay is measured on every run from the count-in: the mic hears the app's own click through the
  speaker (output + input latency together). That echo's level sets a gate so later click echoes are not counted.
  Stay quiet during the count-in. With headphones there is no echo, so a play-along calibration is used instead.
- Screen taps: a one-time play-along calibration (8 clicks) learns the touch delay. It treats your average as on
  time, so the result shows steadiness, not overall rushing or dragging.
- The 25/50 ms bands and the sensitivity steps are starting values; tune them against real pad hits.
- ScriptProcessorNode is deprecated but still supported everywhere and works from file://; an AudioWorklet port is
  the upgrade path if a browser drops it.

## Storage
`localStorage['thepocket.v2']`, migrated once from `thepocket.v1`. Timing check data lives under `tc`
(input, sensitivity, per-input calibration, last 50 results). Every key is whitelisted and type-checked on
load and on import; bad data falls back to defaults. Export/Import/Reset live at the bottom of the Guide tab.

## Colour notes (WCAG ratios, computed)
- Done `#8a9c63`: 6.17:1 on `#171310` (text), 5.69:1 on walnut `#241a13` (checkbox fill vs surroundings).
- Track / inactive beat segments `#7f705a`: 3.84:1 on `#171310`, 3.54:1 on `#241a13`.

## Notes
- iPhone: the ring/silent switch can mute Web Audio; a wake lock is requested while running.
- Browsers throttle timers in background tabs; keep the app in the foreground for tight timing. If the
  main thread stalls, missed clicks are dropped (never played late) and the beat position stays correct.
