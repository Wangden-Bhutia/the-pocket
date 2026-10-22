// node tools/build-sw.js -> writes the versioned precache list into sw.js and prints the version.
// Version = hash of every shipped file, so the cache name changes only when a shipped file changes.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const SKIP_TOP = new Set(['screenshots', 'tools', 'tests', 'node_modules']);
const SKIP_FILE = /^(README\.md|sw\.js)$/;
const files = [];
(function walk(dir, rel) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;                 // all dotfiles/dirs: .git, .github, .nojekyll ...
    if (rel === '' && SKIP_TOP.has(name)) continue;
    const p = path.join(dir, name), r = rel ? rel + '/' + name : name;
    if (fs.statSync(p).isDirectory()) walk(p, r);
    else if (!(rel === '' && SKIP_FILE.test(name)) && !name.endsWith('.zip')) files.push(r);
  }
})(root, '');
files.sort();
const h = crypto.createHash('sha1');
files.forEach(f => { h.update(f); h.update(fs.readFileSync(path.join(root, f))); });
const ver = 'pocket-' + h.digest('hex').slice(0, 10);
let sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
sw = sw.replace(/const VERSION = '.*?';/, `const VERSION = '${ver}';`)
  .replace(/const ASSETS = \[[\s\S]*?\];/, 'const ASSETS = ' + JSON.stringify(['./'].concat(files), null, 2) + ';');
fs.writeFileSync(path.join(root, 'sw.js'), sw);
console.log(ver, files.length + 1, 'assets');
