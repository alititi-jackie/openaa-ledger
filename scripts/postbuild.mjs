import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const scope = "/usa/life-ledger/";
const pages = [scope, scope + "guide/"];
const paths = new Set([
  ...pages,
  "/assets/openaa-logo.png",
  ...["manifest.json", "icon-192.png", "icon-512.png"].map(name => scope + name),
]);
for (const page of pages) {
  const html = await readFile("dist" + page + "index.html", "utf8");
  for (const match of html.matchAll(/(?:src|href)="(\/_astro\/[^"]+)"/g)) paths.add(match[1]);
}
const resources = [...paths];
const digest = createHash("sha256");
for (const path of resources) {
  const file = path.endsWith("/") ? path + "index.html" : path;
  digest.update(path).update(await readFile("dist" + file));
}
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
