// Slidepad's signature field: an ordered (Bayer 8×8) dither of a soft drifting glow, drawn once per
// resize at 2 CSS-px cells. Static on purpose — it is ambient texture, never competing with slides.

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64);

const CELL = 2;

/** Paints the field into `canvas`, filling its CSS box. `tone` is the ink colour as [r, g, b]. */
export function paintDither(canvas, { tone = [255, 77, 46], seed = 0.37 } = {}) {
  const w = Math.max(1, Math.round(canvas.clientWidth / CELL));
  const h = Math.max(1, Math.round(canvas.clientHeight / CELL));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const [r, g, b] = tone;
  // Two soft blobs plus a gentle wave, rising from the bottom edge.
  const blobs = [
    { x: 0.18 + seed * 0.1, y: 1.05, rx: 0.45, ry: 1.2, k: 0.95 },
    { x: 0.82 - seed * 0.1, y: 1.1, rx: 0.4, ry: 1.0, k: 0.8 },
  ];
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let field = 0;
      for (const o of blobs) {
        const dx = (u - o.x) / o.rx, dy = (v - o.y) / o.ry;
        field += o.k * Math.exp(-(dx * dx + dy * dy) * 1.6);
      }
      field += 0.18 * Math.sin(u * 9 + seed * 6) * v * v;
      field *= Math.min(1, v * 1.4); // fade out towards the top
      if (field > BAYER[(y & 7) * 8 + (x & 7)]) {
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Keeps a canvas painted at its current size. */
export function mountDither(canvas, options) {
  let raf = 0;
  const paint = () => { raf = 0; paintDither(canvas, options); };
  new ResizeObserver(() => { raf ||= requestAnimationFrame(paint); }).observe(canvas);
}
