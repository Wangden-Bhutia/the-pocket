# The Pocket

A static, vanilla HTML/CSS/JS PWA for a guitarist/singer building rhythm and timing on a 12" practice pad:
a Web Audio metronome (tap tempo, 40–220 BPM, quarter/eighth/triplet/sixteenth), a 28-day schedule with
persisted per-day checkboxes, and five practice rules. Works offline. No build step, no dependencies, no runtime external calls.

Live: https://wangden-bhutia.github.io/the-pocket/

## Files
`index.html`, `style.css`, `app.js`, `content.js` (verbatim schedule/rules text), `manifest.webmanifest`, `sw.js` (versioned precache),
`fonts/` (self-hosted Fraunces + Karla, latin woff2), `icons/` (192, 512, maskable, apple-touch-icon, favicon).

## Run locally
```sh
python3 -m http.server 8000      # then open http://localhost:8000/
```
Opening `index.html` directly (file://) also works; the service worker is simply skipped.

## Install
Open the site in Chrome/Safari → "Add to Home Screen" / "Install app".

## Updating / cache versioning
After changing any shipped file, regenerate the precache list and version hash:
```sh
node tools/build-sw.js
```
Commit and push; browsers pick up the new `sw.js` and replace the old `pocket-*` cache.

## Deploy to GitHub Pages
```sh
git init -b main && git add -A && git commit -m "The Pocket"
gh repo create Wangden-Bhutia/the-pocket --public --source=. --push
gh api -X POST repos/Wangden-Bhutia/the-pocket/pages -f "source[branch]=main" -f "source[path]=/"
# wait until these return 200:
curl -I https://wangden-bhutia.github.io/the-pocket/index.html
curl -I https://wangden-bhutia.github.io/the-pocket/sw.js
```

## Notes
- iPhone: the ring/silent switch can mute Web Audio; keep the screen on (a wake lock is requested while running).
- Browsers throttle timers in background tabs; keep the app in the foreground for tight timing.
