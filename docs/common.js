// Shared between the screen (desktop) and remote (phone) sides.

/** Namespaces our peer IDs on the public PeerJS broker. Bump if the wire protocol changes. */
export const PEER_PREFIX = "slidepad-v1-";
export const CONNECT_TIMEOUT_MS = 15000;

export const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" rx="16" fill="#141417"/>
  <rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>
  <circle cx="40" cy="23" r="13" fill="var(--laser)" fill-opacity=".16"/>
  <circle cx="40" cy="23" r="6.5" fill="var(--laser)"/>
  <path d="M15 44h25" stroke="#f5f5f4" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M34 37.5 40.5 44 34 50.5" fill="none" stroke="#f5f5f4" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const BRAND = `<span class="brand">${LOGO}<span class="wordmark">slidepad</span></span>`;

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
export const TRANSIENT_PEER_ERRORS = new Set(["network", "server-error", "socket-error", "socket-closed", "disconnected"]);

export function createPeer(id) {
  if (!window.Peer) throw new Error("PeerJS failed to load");
  return new window.Peer(id, { debug: 1 });
}
