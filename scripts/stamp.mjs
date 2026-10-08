// Stamps every local asset reference with ?v=<content hash> so browsers never mix files from two
// deploys (GitHub Pages caches each file for 10 minutes). Run before committing: npm run stamp
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = "docs";
const files = readdirSync(dir).filter((f) => /\.(js|css|html)$/.test(f));
const strip = (s) => s.replace(/\?v=[0-9a-f]+/g, "");
const hash = createHash("sha256");
for (const f of files.sort()) hash.update(strip(readFileSync(`${dir}/${f}`, "utf8")));
const v = hash.digest("hex").slice(0, 10);

// ./foo.js, ./app.css, ./vendor/x.js, ./icon.svg … in imports, src/href attributes and new URL().
const ref = /(["'])(\.\/[\w./-]+\.(?:js|mjs|css|svg|webmanifest|woff2))(?:\?v=[0-9a-f]+)?\1/g;
for (const f of files) {
  const path = `${dir}/${f}`;
  const before = readFileSync(path, "utf8");
  const after = before.replace(ref, (_, q, p) => `${q}${p}?v=${v}${q}`);
  if (after !== before) writeFileSync(path, after);
}
console.log(`stamped v=${v}`);
