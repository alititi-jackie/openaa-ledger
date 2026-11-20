import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const scope = "/usa/life-ledger/";
const html = await readFile("dist" + scope + "index.html", "utf8");
const resources = [
  scope,
  ...Array.from(
    html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g),
    (m) => m[1],
  ),
  "/assets/openaa-logo.png",
  ...["manifest.json", "icon-192.png", "icon-512.png"].map(
    (name) => scope + name,
  ),
];
const digest = createHash("sha256");
for (const path of resources)
  digest.update(
    await readFile("dist" + (path === scope ? scope + "index.html" : path)),
  );
const name = "openaa-life-ledger-" + digest.digest("hex").slice(0, 16);
await writeFile(
  "dist" + scope + "sw.js",
  `
const name=${JSON.stringify(name)};
const urls=${JSON.stringify(resources)};
self.addEventListener("install",event=>event.waitUntil(caches.open(name).then(cache=>cache.addAll(urls)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("openaa-life-ledger-")&&key!==name).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=="GET"||url.origin!==location.origin||!urls.includes(url.pathname))return;
 event.respondWith(caches.open(name).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)));
});
`,
);
