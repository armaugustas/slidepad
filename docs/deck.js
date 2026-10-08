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
    title: ["Your Phone Is", "The Clicker"],
    body: "No app, no login. Scan the code on the screen and you’re in.",
    notes: "These are speaker notes. They show up on every phone that joins and follow the slides as you go.",
  },
  {
    kicker: "Next",
    title: ["Back And Next", "At Your Thumb"],
    body: "Two big buttons at the bottom of your phone. That’s the whole remote.",
    notes: "Try it now: tap Next on your phone.",
  },
  {
    kicker: "Point",
    title: ["Touch The Slide", "To Point"],
    body: "Put a finger on the slide preview and a laser dot appears in the same spot up here.",
    notes: "Slide your finger to move it. Lift it and the dot goes away.",
  },
  {
    kicker: "Team",
    title: ["Bring Everyone", "Along"],
    body: "Anyone who scans can follow with the notes. The admin decides who can drive.",
    notes: "The first phone to join is the admin. Change roles from the menu.",
  },
  {
    kicker: "Your decks",
    title: ["Drop In A PDF.", "Notes Come Too."],
    body: "Add the .pptx with the same name and its speaker notes come along.",
    notes: "From Keynote: export once to PDF and once to PowerPoint.",
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
  await document.fonts?.load('600 100px "Geist"').catch(() => {});
  // Fit a 16:9 slide inside w×h.
  const sw = Math.min(w, (h * 16) / 9);
  const sh = (sw * 9) / 16;
  const canvas = makeCanvas(sw, sh, dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(canvas.width / 1600, canvas.height / 900);
  const font = '"Geist", ui-sans-serif, system-ui, -apple-system, sans-serif';

  ctx.fillStyle = "#f7f7f7";
  ctx.fillRect(0, 0, 1600, 900);
  const glow = ctx.createRadialGradient(1420, 900, 0, 1420, 900, 700);
  glow.addColorStop(0, "rgba(255,77,46,0.16)");
  glow.addColorStop(1, "rgba(255,77,46,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1600, 900);

  const x = 140;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ff4d2e";
  ctx.beginPath();
  ctx.arc(x + 9, 282, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 32px ${font}`;
  ctx.fillStyle = "#666";
  ctx.fillText(`${String(i + 1).padStart(2, "0")}  ${s.kicker}`, x + 34, 293);

  ctx.font = `600 128px ${font}`;
  ctx.fillStyle = "#171717";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-7px";
  s.title.forEach((line, n) => ctx.fillText(line, x - 6, 450 + n * 140));
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-1px";

  ctx.font = `500 40px ${font}`;
  ctx.fillStyle = "#666";
  wrap(ctx, s.body, 1080).forEach((line, n) => ctx.fillText(line, x, 700 + n * 56));
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
