// Copies browser builds of third-party libs into docs/vendor so GitHub Pages serves them same-origin.
import { copyFileSync, mkdirSync } from "node:fs";

const files = {
  "node_modules/peerjs/dist/peerjs.min.js": "peerjs.min.js",
  "node_modules/qrcode-generator/qrcode.js": "qrcode.js",
  "node_modules/pdfjs-dist/build/pdf.min.mjs": "pdf.min.mjs",
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs": "pdf.worker.min.mjs",
};

mkdirSync("docs/vendor", { recursive: true });
for (const [from, to] of Object.entries(files)) {
  copyFileSync(from, `docs/vendor/${to}`);
  console.log(`vendored ${to}`);
}
