// A deck is anything that can draw slide i into a canvas. Two kinds share one interface:
//   { id, kind, name, count, notes: string[], render(i, w, h) → canvas, thumb(i) → JPEG data URL, destroy() }

const THUMB_W = 480;
const THUMB_H = 270;
const thumbOf = (canvas) => canvas.toDataURL("image/jpeg", 0.72);

function makeCanvas(cssW, cssH, dpr) {
  const canvas = document.createElement("canvas");
  canvas.className = "slide-canvas";
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = `${Math.round(cssW)}px`;
  canvas.style.height = `${Math.round(cssH)}px`;
  return canvas;
}

/** Caches full-size renders for one stage size and thumbnails forever; prefetches neighbours. */
function withCaches(deck, draw) {
  const renders = new Map();
  const thumbs = new Map();
  let renderKey = "";
  const job = (map, key, make) => {
    if (!map.has(key)) {
      const p = make();
      p.catch(() => map.delete(key));
      map.set(key, p);
    }
    return map.get(key);
  };
  deck.render = (i, w, h) => {
    const key = `${w}x${h}`;
    if (key !== renderKey) { renders.clear(); renderKey = key; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const get = (j) => j >= 0 && j < deck.count && job(renders, j, () => draw(j, w, h, dpr));
    get(i + 1);
    get(i - 1);
    for (const k of renders.keys()) if (Math.abs(k - i) > 2) renders.delete(k);
    return get(i);
  };
  deck.thumb = (i) => job(thumbs, i, () => draw(i, THUMB_W, THUMB_H, 1).then(thumbOf));
  return deck;
}

// ── Demo deck (drawn with canvas so it gets thumbnails like a PDF) ────────
const DEMO = [
  {
    kicker: "Slidepad",
    title: ["Your phone", "is the clicker."],
    body: "No app, no login. Scan the code and you’re in.",
    notes: "Welcome! This text is a speaker note.\n\nNotes show up live on every connected phone and follow the slides as you move.",
  },
  {
    kicker: "Advance",
    title: ["Next, Back,", "or flick."],
    body: "Big buttons for your thumb. Flick the slide preview left or right to move too.",
    notes: "Try it: press Next on your phone, or flick the little slide preview at the top.",
  },
  {
    kicker: "Point",
    title: ["Drag to aim", "the laser."],
    body: "Open the Laser tab and slide a finger. Slow is precise, fast crosses the screen.",
    notes: "The laser fades out on its own a moment after you stop moving.",
  },
  {
    kicker: "Together",
    title: ["Bring the", "whole team."],
    body: "Admins run the show. Teammates can drive. Members follow along with the notes.",
    notes: "Everyone who scans joins. Change roles under People — on the computer or from the admin’s phone.",
  },
  {
    kicker: "Your decks",
    title: ["Drop in PDFs.", "Notes too."],
    body: "Add the matching .pptx to bring speaker notes. Switch decks right from your phone.",
    notes: "Keynote: File → Export To → PDF for slides, and → PowerPoint for the notes.",
  },
];

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function drawDemo(i, w, h, dpr) {
  const s = DEMO[i];
  // Fit a 16:9 slide inside w×h.
  const sw = Math.min(w, (h * 16) / 9);
  const sh = (sw * 9) / 16;
  const canvas = makeCanvas(sw, sh, dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / 1600, canvas.height / 900);
  const font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  const bg = ctx.createLinearGradient(0, 0, 0, 900);
  bg.addColorStop(0, "#131316");
  bg.addColorStop(1, "#0b0b0d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1600, 900);
  const glow = ctx.createRadialGradient(1360, 140, 0, 1360, 140, 760);
  glow.addColorStop(0, "rgba(255,90,54,0.20)");
  glow.addColorStop(1, "rgba(255,90,54,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1600, 900);

  const x = 150;
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 30px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillStyle = "#6e6e76";
  ctx.fillText(String(i + 1).padStart(2, "0"), x, 300);
  ctx.font = `650 30px ${font}`;
  ctx.fillStyle = "#ff5a36";
  ctx.fillText(s.kicker.toUpperCase().split("").join(" "), x + 62, 300);

  ctx.font = `700 132px ${font}`;
  ctx.fillStyle = "#f5f5f4";
  s.title.forEach((line, n) => ctx.fillText(line, x - 4, 440 + n * 136));

  ctx.font = `400 40px ${font}`;
  ctx.fillStyle = "#a1a1a8";
  wrap(ctx, s.body, 1100).forEach((line, n) => ctx.fillText(line, x, 700 + n * 56));
  return canvas;
}

export function demoDeck() {
  return withCaches(
    { id: "demo", kind: "demo", name: "Slidepad tour", count: DEMO.length, notes: DEMO.map((s) => s.notes), destroy() {} },
    drawDemo,
  );
}

// ── PDF deck ───────────────────────────────────────────────────────────────
let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

/** Sticky-note annotations are the only notes a plain PDF can carry. */
async function annotationNotes(doc) {
  const notes = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const annots = await page.getAnnotations({ intent: "display" });
    notes.push(
      annots
        .filter((a) => a.subtype === "Text" || a.subtype === "FreeText")
        .map((a) => (a.contentsObj?.str ?? a.contents ?? "").trim())
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return notes;
}

/** `data` is an ArrayBuffer of the PDF; it is copied, so the caller can keep it. */
export async function pdfDeck({ id, name, data, notes }) {
  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const deck = {
    id,
    kind: "pdf",
    name,
    count: doc.numPages,
    notes: Array.isArray(notes) && notes.some(Boolean) ? notes : await annotationNotes(doc).catch(() => []),
    destroy() { doc.destroy(); },
  };
  return withCaches(deck, async (i, w, h, dpr) => {
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(w / base.width, h / base.height);
    const viewport = page.getViewport({ scale: fit * dpr });
    const canvas = makeCanvas(viewport.width / dpr, viewport.height / dpr, 1);
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas;
  });
}
