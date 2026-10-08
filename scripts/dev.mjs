// Static dev server for docs/ that also listens on the LAN, so a phone on the same Wi-Fi can open it.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../docs/", import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  ".sh": "text/plain; charset=utf-8", ".ps1": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.endsWith("/")) path += "index.html";
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) return res.writeHead(301, { Location: `${path}/` }).end();
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i.family === "IPv4" && !i.internal);
  console.log(`\n  Slidepad dev server\n\n  This computer:  http://localhost:${PORT}/`);
  for (const i of lan) console.log(`  Phone (Wi-Fi):  http://${i.address}:${PORT}/   <- open this on the desktop so the QR works`);
  console.log("");
});
