// Shared between the screen (desktop) and remote (phone) sides.

// The mark is Lucide’s “presentation” icon (ISC), drawn bare — no container — per the house logo rule.
export const LOGO = `<svg class="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/><circle cx="15.5" cy="9.5" r="2" fill="var(--laser)" stroke="none"/>
</svg>`;

export const BRAND = `<span class="brand">${LOGO}<span class="wordmark">slidepad</span></span>`;

/** Roles, most to least powerful. */
export const ROLES = {
  admin: { label: "Admin", blurb: "Runs the room" },
  teammate: { label: "Teammate", blurb: "Can change slides and point" },
  member: { label: "Member", blurb: "Follows along" },
};

/** Admins and teammates drive (slides + laser); members follow. */
export const canDrive = (role) => role === "admin" || role === "teammate";

export const randomId = (bytes = 8) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Touch-first device with no precise pointer: treat as the remote by default. */
export const isPhone = () =>
  matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

export function deviceName(ua = navigator.userAgent) {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  return "Phone";
}

export const formatCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** Session-scoped storage; every access can throw in private modes, so failures are ignored. */
export const session = {
  get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} },
  remove(key) { try { sessionStorage.removeItem(key); } catch {} },
};

export const prefs = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};


export const cleanName = (name, fallback) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 32) || fallback;
