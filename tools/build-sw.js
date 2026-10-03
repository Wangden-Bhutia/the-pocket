// node tools/build-sw.js -> writes versioned precache list into sw.js
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'..');const skip=new Set(['screenshots','tools','tests','node_modules','.git']);const files=[];
(function walk(d,rel){for(const n of fs.readdirSync(d)){if(rel===''&&skip.has(n))continue;const p=path.join(d,n),r=rel?rel+'/'+n:n;
 if(fs.statSync(p).isDirectory())walk(p,r);else if(!/^(README\.md|sw\.js|\.nojekyll)$/.test(n)&&!n.endsWith('.zip'))files.push(r);}})(root,'');
files.sort();const h=crypto.createHash('sha1');files.forEach(f=>{h.update(f);h.update(fs.readFileSync(path.join(root,f)));});
const ver='pocket-'+h.digest('hex').slice(0,10);let sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
sw=sw.replace(/const VERSION = '.*?';/,`const VERSION = '${ver}';`).replace(/const ASSETS = \[[\s\S]*?\];/,'const ASSETS = '+JSON.stringify(['./'].concat(files),null,2)+';');
fs.writeFileSync(path.join(root,'sw.js'),sw);console.log(ver,files.length+1,'assets');
