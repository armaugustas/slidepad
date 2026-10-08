// A deck renders slide `i` into a ready-to-mount element. Both kinds share { name, count, show(i, size) }.

const DEMO_SLIDES = [
  { kicker: "Slidepad", title: "Your phone<br>is the clicker.", body: "No app. No login. You just scanned a code — that’s the whole setup." },
  { kicker: "Point", title: "Drag a finger<br>to aim the laser.", body: "Slide on the pad and a dot follows here. Move fast to cross the screen, slow for precision." },
  { kicker: "Advance", title: "Tap, flick,<br>or hit Next.", body: "A tap clicks — on a slide that means next, just like Keynote. Flick left or right to go either way." },
  { kicker: "Your deck", title: "Drop a PDF<br>anywhere.", body: "Export from Keynote, PowerPoint, Google Slides or Figma. Every page renders crisp at any size." },
  { kicker: "Any app", title: "Want Keynote<br>itself?", body: "Switch to “Control this computer” at the top. One pasted line and your phone drives the real keyboard and mouse." },
];

export const demoDeck = {
  name: "Demo deck",
  count: DEMO_SLIDES.length,
  async show(i) {
    const s = DEMO_SLIDES[i];
    const el = document.createElement("article");
    el.className = "demo-slide";
    el.innerHTML = `
      <p class="demo-kicker"><span class="demo-num">${String(i + 1).padStart(2, "0")}</span>${s.kicker}</p>
      <h2 class="demo-title">${s.title}</h2>
      <p class="demo-body">${s.body}</p>`;
    return el;
  },
};

let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}

export async function pdfDeck(file) {
  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({ data: await file.arrayBuffer() }).promise;
  // Rendered canvases for the current stage size, keyed by page index. Neighbours are prefetched.
  const cache = new Map();
  let cacheKey = "";

  async function render(i, width, height) {
    const page = await doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(width / base.width, height / base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: fit * dpr });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas;
  }

  function get(i, size) {
    if (i < 0 || i >= doc.numPages) return null;
    if (!cache.has(i)) {
      const job = render(i, size.width, size.height);
      job.catch(() => cache.delete(i));
      cache.set(i, job);
    }
    return cache.get(i);
  }

  return {
    name: file.name.replace(/\.pdf$/i, ""),
    count: doc.numPages,
    async show(i, size) {
      const key = `${size.width}x${size.height}`;
      if (key !== cacheKey) { cache.clear(); cacheKey = key; }
      const current = get(i, size);
      get(i + 1, size);
      get(i - 1, size);
      for (const k of cache.keys()) if (Math.abs(k - i) > 2) cache.delete(k);
      return current;
    },
    destroy() { cache.clear(); doc.destroy(); },
  };
}
