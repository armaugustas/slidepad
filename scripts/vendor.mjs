// Copies browser builds of third-party libs into docs/vendor so GitHub Pages serves them same-origin.
import { copyFileSync, mkdirSync } from "node:fs";

const files = {
  "node_modules/mqtt/dist/mqtt.min.js": "mqtt.min.js",
  "node_modules/qrcode-generator/qrcode.js": "qrcode.js",
  "node_modules/pdfjs-dist/build/pdf.min.mjs": "pdf.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs": "pdf.worker.min.mjs",
  "node_modules/jszip/dist/jszip.min.js": "jszip.min.js",
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2": "geist.woff2",
  "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2": "geist-mono.woff2",
};

mkdirSync("docs/vendor", { recursive: true });
for (const [from, to] of Object.entries(files)) {
  copyFileSync(from, `docs/vendor/${to}`);
  console.log(`vendored ${to}`);
}
