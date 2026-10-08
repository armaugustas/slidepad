// Phone side: follows the live slide and its notes. Drivers (admins, teammates) also change slides
// and point a laser by touching the slide preview; admins run the room from the menu.
import {
  $, CONNECT_TIMEOUT_MS, LOGO, PEER_PREFIX, ROLES, TRANSIENT_PEER_ERRORS, cleanName, createPeer, deviceName, esc, formatCode, prefs, randomId,
} from "./common.js";
import { mountDither } from "./dither.js";
import { icon } from "./icons.js";

const RECONNECT_TRIES = 40;
const NOTE_SIZES = [15, 17, 19, 22, 26];

const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };

function clientId() {
  let id = prefs.get("slidepad.cid");
  if (!/^[0-9a-f]{16}$/.test(id ?? "")) { id = randomId(8); prefs.set("slidepad.cid", id); }
  return id;
}

export function start(root, params) {
  const cid = clientId();
  let name = cleanName(prefs.get("slidepad.name"), deviceName());
  let peer = null;
  let conn = null;
  let code = null;
  let key = null;
  let admitted = false;
  let tries = 0;
  let timeoutTimer = 0;
  let retryTimer = 0;
  let wakeLock = null;
  let leaving = false;
  let meta = { role: "member", drive: false, admin: null };
  let slide = null;
  const savedSize = NOTE_SIZES.indexOf(Number(prefs.get("slidepad.noteSize")));
  let noteSize = savedSize >= 0 ? savedSize : 1;

  // ── Join ─────────────────────────────────────────────────────────────────
  function renderJoin(error = "") {
    teardown();
    document.title = "Join · Slidepad";
    root.innerHTML = `
      <main class="join">
        <header class="join-top"><span class="brand">${LOGO}<span class="wordmark">slidepad</span></span></header>
        <section class="join-body">
          <h1>Join A Presentation</h1>
          <p class="lede">Enter the code on the big screen. Scanning its QR code works too.</p>
          <form id="joinForm" class="join-form" novalidate>
            <input id="codeInput" class="code-input" inputmode="numeric" autocomplete="one-time-code" placeholder="000 000" maxlength="7" enterkeyhint="go" aria-label="6-digit code">
            <input id="nameInput" class="input" autocomplete="given-name" maxlength="32" placeholder="Your name" aria-label="Your name" value="${esc(prefs.get("slidepad.name") ?? "")}">
            <button class="btn btn-primary btn-lg" type="submit">Join</button>
          </form>
          <p class="join-error" id="joinError" role="alert">${esc(error)}</p>
        </section>
        <a class="join-switch" href="?as=screen">Use this device as the screen</a>
        <canvas class="dither" id="dither" aria-hidden="true"></canvas>
      </main>`;
    mountDither($("#dither"));
    const input = $("#codeInput");
    const submit = () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits.length !== 6) return ($("#joinError").textContent = "The code has 6 digits.");
      saveName($("#nameInput").value);
      join(digits, null);
    };
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "").slice(0, 6);
      input.value = digits.length > 3 ? formatCode(digits) : digits;
      $("#joinError").textContent = "";
    });
    $("#joinForm").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    input.focus();
  }

  function saveName(value) {
    const typed = cleanName(value, "");
    if (typed) prefs.set("slidepad.name", typed);
    name = typed || name;
  }

  // ── Room ─────────────────────────────────────────────────────────────────
  function renderRoom() {
    document.title = `${formatCode(code)} · Slidepad`;
    root.innerHTML = `
      <main class="remote" id="remote" data-state="connecting" data-drive="false">
        <header class="r-top">
          <div class="r-heading">
            <p class="r-deck" id="deckName">Connecting…</p>
            <p class="r-sub"><span class="dot"></span><span id="position"></span></p>
          </div>
          <button type="button" class="icon-btn" id="menuBtn" aria-label="Menu">${icon("menu")}</button>
        </header>

        <figure class="r-slide" id="slide">
          <img id="thumb" alt="Current slide">
          <span class="r-pointer" id="pointer" aria-hidden="true"></span>
        </figure>
        <p class="r-hint">Touch the slide to point</p>

        <section class="r-notes" aria-label="Speaker notes">
          <div class="r-notes-head">
            <span>Notes</span>
            <span class="r-notes-tools">
              <button type="button" class="icon-btn icon-btn-sm" id="smaller" aria-label="Smaller notes">${icon("minus")}</button>
              <button type="button" class="icon-btn icon-btn-sm" id="bigger" aria-label="Bigger notes">${icon("plus")}</button>
            </span>
          </div>
          <div class="r-notes-text" id="notes"></div>
        </section>

        <nav class="r-nav" aria-label="Slides">
          <button type="button" class="btn btn-secondary btn-xl" id="prev">${icon("chevron-left")}Back</button>
          <button type="button" class="btn btn-primary btn-xl" id="next">Next${icon("chevron-right")}</button>
        </nav>

        <div class="r-overlay" id="overlay" hidden></div>

        <div class="sheet-scrim" id="sheet" hidden>
          <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
            <header class="sheet-head"><h2 id="sheetTitle">Menu</h2><button type="button" class="icon-btn" id="closeSheet" aria-label="Close">${icon("x")}</button></header>
            <div class="sheet-body">
              <section class="sheet-section">
                <h3>Your name</h3>
                <div class="field-row">
                  <input id="renameInput" class="input" maxlength="32" aria-label="Your name" enterkeyhint="done">
                  <span class="role-tag" id="youRole"></span>
                </div>
              </section>
              <div id="adminSections"></div>
              <button type="button" class="link-btn leave" id="leave">${icon("log-out")}Leave</button>
            </div>
          </section>
        </div>
      </main>`;

    $("#prev").addEventListener("click", () => nav("prev"));
    $("#next").addEventListener("click", () => nav("next"));
    $("#smaller").addEventListener("click", () => setNoteSize(noteSize - 1));
    $("#bigger").addEventListener("click", () => setNoteSize(noteSize + 1));
    $("#menuBtn").addEventListener("click", openSheet);
    $("#closeSheet").addEventListener("click", closeSheet);
    $("#sheet").addEventListener("click", (e) => e.target === e.currentTarget && closeSheet());
    $("#leave").addEventListener("click", leave);
    $("#renameInput").addEventListener("change", (e) => {
      saveName(e.target.value);
      e.target.value = name;
      send({ t: "rename", name });
    });
    $("#adminSections").addEventListener("click", onAdminClick);
    $("#adminSections").addEventListener("change", onAdminChange);
    bindPointer($("#slide"));
    setNoteSize(noteSize);
    renderMeta();
  }

  function setStatus(state, overlay = "") {
    const el = $("#remote");
    if (!el) return;
    el.dataset.state = state;
    $("#overlay").hidden = !overlay;
    $("#overlay").innerHTML = overlay;
  }
  const overlayHtml = (title, body) => `<div class="r-overlay-card"><p class="overlay-title">${title}</p><p>${body}</p></div>`;

  function setNoteSize(i) {
    noteSize = Math.max(0, Math.min(NOTE_SIZES.length - 1, i));
    prefs.set("slidepad.noteSize", String(NOTE_SIZES[noteSize]));
    $("#notes")?.style.setProperty("--note-size", `${NOTE_SIZES[noteSize]}px`);
  }

  function renderSlide() {
    if (!slide || !$("#remote")) return;
    $("#deckName").textContent = slide.name;
    $("#position").textContent = `Slide ${slide.i + 1} of ${slide.n}`;
    const notes = $("#notes");
    notes.textContent = slide.notes || "No notes for this slide.";
    notes.classList.toggle("empty", !slide.notes);
    notes.scrollTop = 0;
    $("#thumb").classList.add("stale");
    $("#prev").disabled = slide.i === 0;
    $("#next").disabled = slide.i + 1 >= slide.n;
  }

  function renderThumb(t) {
    if (!slide || t.deckId !== slide.deckId || t.i !== slide.i || !t.thumb) return;
    const img = $("#thumb");
    img.src = t.thumb;
    img.classList.remove("stale");
  }

  function renderMeta() {
    const el = $("#remote");
    if (!el) return;
    el.dataset.drive = String(!!meta.drive);
    $("#youRole").textContent = ROLES[meta.role]?.label ?? "Member";
    renderAdmin();
  }

  // ── Admin menu ───────────────────────────────────────────────────────────
  function renderAdmin() {
    const box = $("#adminSections");
    if (!box) return;
    const a = meta.admin;
    if (!a) { box.innerHTML = ""; return; }
    box.innerHTML = `
      <section class="sheet-section">
        <h3>Presentations</h3>
        <div class="list">
          ${a.decks.map((d) => `
            <button type="button" class="list-row" data-act="deck" data-id="${esc(d.id)}" aria-current="${d.id === a.activeId}">
              <span class="list-text"><span class="list-title">${esc(d.name)}</span><span class="list-sub">${d.n} slides</span></span>
              ${d.id === a.activeId ? `<span class="live-tag"><span class="dot"></span>Live</span>` : ""}
            </button>`).join("")}
        </div>
      </section>
      <section class="sheet-section">
        <h3>People</h3>
        <div class="list">
          ${a.pending.map((p) => `
            <div class="list-row" data-cid="${p.cid}">
              <span class="avatar">${esc(p.name[0].toUpperCase())}</span>
              <span class="list-text"><span class="list-title">${esc(p.name)}</span><span class="list-sub">Wants to join</span></span>
              <button type="button" class="btn btn-sm btn-ghost" data-act="deny">Not now</button>
              <button type="button" class="btn btn-sm btn-primary" data-act="allow">Let in</button>
            </div>`).join("")}
          ${a.people.map((p) => `
            <div class="list-row" data-cid="${p.cid}" data-online="${p.online}">
              <span class="avatar" data-role="${p.role}">${esc(p.name[0].toUpperCase())}</span>
              <span class="list-text"><span class="list-title">${esc(p.name)}${p.you ? " (you)" : ""}</span><span class="list-sub">${p.online ? ROLES[p.role].blurb : "Offline"}</span></span>
              ${p.you ? "" : `
                <select class="select" data-act="role" aria-label="Role for ${esc(p.name)}">
                  ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === p.role ? " selected" : ""}>${r.label}</option>`).join("")}
                </select>
                <button type="button" class="icon-btn icon-btn-sm" data-act="kick" aria-label="Remove ${esc(p.name)}">${icon("x")}</button>`}
            </div>`).join("")}
        </div>
      </section>
      <section class="sheet-section">
        <h3>Room</h3>
        <div class="setting">
          <p class="setting-name">New people</p>
          <div class="seg" role="radiogroup" aria-label="New people join as">
            ${[["member", "Follow"], ["teammate", "Can drive"]].map(([v, l]) => `<button type="button" class="seg-btn" role="radio" data-setting="joinRole" data-value="${v}" aria-checked="${a.settings.joinRole === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting">
          <p class="setting-name">Lock the room</p>
          <button type="button" class="switch" role="switch" data-setting="locked" aria-checked="${a.settings.locked}" aria-label="Lock the room"><span></span></button>
        </div>
      </section>`;
  }

  function onAdminClick(e) {
    const t = e.target.closest("button");
    if (!t) return;
    const cidOf = () => t.closest("[data-cid]")?.dataset.cid;
    if (t.dataset.act === "deck") { send({ t: "deck", id: t.dataset.id }); haptic(10); closeSheet(); }
    else if (t.dataset.act === "allow") send({ t: "approve", cid: cidOf(), allow: true });
    else if (t.dataset.act === "deny") send({ t: "approve", cid: cidOf(), allow: false });
    else if (t.dataset.act === "kick") send({ t: "kick", cid: cidOf() });
    else if (t.dataset.setting) {
      const k = t.dataset.setting;
      send({ t: "settings", settings: { [k]: t.dataset.value ?? !meta.admin.settings[k] } });
    }
  }

  function onAdminChange(e) {
    if (e.target.dataset.act === "role") send({ t: "role", cid: e.target.closest("[data-cid]").dataset.cid, role: e.target.value });
  }

  function openSheet() {
    $("#renameInput").value = name;
    $("#sheet").hidden = false;
  }
  function closeSheet() { $("#sheet").hidden = true; }

  // ── Input ────────────────────────────────────────────────────────────────
  const send = (msg) => { try { conn?.open && conn.send(msg); } catch {} };

  function nav(k) {
    if (!meta.drive) return;
    haptic(k === "next" ? 10 : 6);
    send({ t: "nav", k });
  }

  /** Touching the preview points the laser at the same spot on the big screen. */
  function bindPointer(fig) {
    const dot = $("#pointer");
    let id = null;
    let pending = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending) send({ t: "point", on: true, x: pending.x, y: pending.y });
    };
    const at = (e) => {
      const r = $("#thumb").getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      dot.style.left = `${x * 100}%`;
      dot.style.top = `${y * 100}%`;
      pending = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      raf ||= requestAnimationFrame(flush);
    };
    fig.addEventListener("pointerdown", (e) => {
      if (!meta.drive || id !== null) return;
      id = e.pointerId;
      try { fig.setPointerCapture(id); } catch {}
      fig.classList.add("pointing");
      at(e);
    });
    fig.addEventListener("pointermove", (e) => { if (e.pointerId === id) at(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      pending = null;
      fig.classList.remove("pointing");
      send({ t: "point", on: false });
    };
    fig.addEventListener("pointerup", end);
    fig.addEventListener("pointercancel", end);
    fig.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ── Connection ───────────────────────────────────────────────────────────
  function join(nextCode, nextKey) {
    code = nextCode;
    key = nextKey;
    admitted = false;
    tries = 0;
    leaving = false;
    slide = null;
    updateUrl();
    renderRoom();
    connect();
  }

  function updateUrl() {
    const url = new URL(location.pathname, location.origin);
    url.search = new URLSearchParams(key ? { join: code, k: key } : { join: code }).toString();
    history.replaceState(null, "", url);
  }

  function teardown() {
    clearTimeout(timeoutTimer);
    clearTimeout(retryTimer);
    try { conn?.close(); } catch {}
    try { peer?.destroy(); } catch {}
    conn = null;
    peer = null;
    releaseWakeLock();
  }

  const fail = (message) => { leaving = true; renderJoin(message); };

  function retryLater(text) {
    teardown();
    if (leaving) return;
    if (++tries > RECONNECT_TRIES) return fail("Lost the screen. Ask for the code and join again.");
    setStatus("reconnecting", overlayHtml(esc(text), "Keep this page open. It reconnects on its own."));
    retryTimer = setTimeout(connect, Math.min(4000, 600 + tries * 300));
  }

  function connect() {
    teardown();
    setStatus(admitted ? "reconnecting" : "connecting", admitted ? overlayHtml("Reconnecting…", "Hang tight.") : "");
    let p;
    try { p = createPeer(); } catch { return fail("Couldn’t start. Check your internet and try again."); }
    peer = p;
    timeoutTimer = setTimeout(() => {
      if (p !== peer || conn?.open) return;
      if (admitted) retryLater("Reconnecting…");
      else fail("Couldn’t reach the screen. Check it’s still open — some strict networks block direct connections.");
    }, CONNECT_TIMEOUT_MS);

    p.on("open", () => {
      if (p !== peer) return;
      // Default (binary) serialization chunks large messages like slide thumbnails; JSON caps at ~16 KB.
      const c = p.connect(PEER_PREFIX + code, { reliable: true });
      conn = c;
      c.on("open", () => {
        if (c !== conn) return;
        clearTimeout(timeoutTimer);
        c.send({ t: "hello", cid, k: key, name, device: deviceName() });
      });
      c.on("data", (msg) => c === conn && onMessage(msg));
      c.on("close", () => {
        if (c !== conn || leaving) return;
        if (admitted) retryLater("Screen disconnected");
        else fail("The screen closed the connection.");
      });
    });
    p.on("error", (err) => {
      if (p !== peer) return;
      if (err.type === "peer-unavailable") {
        if (admitted) retryLater("Waiting for the screen…");
        else fail(`No screen is showing ${formatCode(code)}. Check the code and try again.`);
      } else if (TRANSIENT_PEER_ERRORS.has(err.type)) retryLater("Connection hiccup, retrying…");
      else { console.warn("[slidepad]", err.type, err); fail("Something went wrong. Try again."); }
    });
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "welcome": return onWelcome(msg);
      case "meta":
        meta = { role: msg.role, drive: !!msg.drive, admin: msg.admin ?? null };
        if (msg.name) name = msg.name;
        return renderMeta();
      case "slide":
        slide = msg;
        return renderSlide();
      case "thumbs":
        return renderThumb(msg);
    }
  }

  function onWelcome({ status, k }) {
    if (status === "ok") {
      const first = !admitted;
      admitted = true;
      tries = 0;
      if (typeof k === "string" && /^[0-9a-f]{24}$/.test(k) && k !== key) { key = k; updateUrl(); }
      setStatus("live");
      requestWakeLock();
      if (first) haptic(14);
    } else if (status === "pending") {
      setStatus("waiting", overlayHtml("Almost in", "Someone at the screen needs to let you in."));
    } else {
      fail({
        denied: "The screen didn’t let this phone in.",
        removed: "You were removed from the presentation.",
        locked: "This room is locked. No one new can join right now.",
      }[status] ?? "Couldn’t join.");
    }
  }

  function leave() {
    leaving = true;
    teardown();
    history.replaceState(null, "", location.pathname);
    renderJoin();
  }

  // ── Keep the phone awake while connected; reconnect when it comes back ──
  async function requestWakeLock() {
    try {
      if (document.visibilityState === "visible" && navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      }
    } catch {}
  }
  function releaseWakeLock() {
    try { wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !code || leaving || !$("#remote")) return;
    if (conn?.open) requestWakeLock();
    else { tries = 0; connect(); }
  });

  // ── Boot ─────────────────────────────────────────────────────────────────
  const initial = (params.get("join") ?? "").replace(/\D/g, "");
  const initialKey = params.get("k");
  if (initial.length === 6) join(initial, /^[0-9a-f]{24}$/.test(initialKey ?? "") ? initialKey : null);
  else renderJoin();
}
