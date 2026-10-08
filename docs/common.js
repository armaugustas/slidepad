// Shared between the screen (desktop) and remote (phone) sides.

/** Namespaces our peer IDs on the public PeerJS broker. Bump when the wire protocol changes. */
export const PEER_PREFIX = "slidepad-v2-";
export const CONNECT_TIMEOUT_MS = 15000;

// The mark is Lucide’s “presentation” icon (ISC) on a laser-coral tile.
export const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="9" fill="var(--laser)"/>
  <g transform="translate(6 6.5) scale(.833)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>
  </g>
</svg>`;

export const BRAND = `<span class="brand">${LOGO}<span class="wordmark">slidepad</span></span>`;

/** Roles, most to least powerful. */
export const ROLES = {
  admin: { label: "Admin", blurb: "Controls everything and manages people" },
  teammate: { label: "Teammate", blurb: "Changes slides, sees notes, can use the laser" },
  member: { label: "Member", blurb: "Follows along with slides and notes" },
};

export const can = (role, action, settings) =>
  role === "admin" || (role === "teammate" && (action === "nav" || (action === "laser" && settings.laser)));

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

/** PeerJS error types that mean "the broker or network hiccuped" rather than a real failure. */
export const cleanName = (name, fallback) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 32) || fallback;

export const TRANSIENT_PEER_ERRORS = new Set(["network", "server-error", "socket-error", "socket-closed", "disconnected"]);

export function createPeer(id) {
  if (!window.Peer) throw new Error("PeerJS failed to load");
  return new window.Peer(id, { debug: 1 });
}
