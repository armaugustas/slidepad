// Phone side: joins a room, follows the live slide and notes, and — depending on role — drives the
// slides, steers the laser, and manages the room.
import {
  $, BRAND, CONNECT_TIMEOUT_MS, PEER_PREFIX, ROLES, TRANSIENT_PEER_ERRORS, cleanName, createPeer, deviceName, esc, formatCode, prefs, randomId,
} from "./common.js";
import { icon } from "./icons.js";

const TAP_MAX_MOVE = 10;
const TAP_MAX_MS = 280;
const FLICK_MAX_MS = 320;
const FLICK_MIN_PX = 60;
const RECONNECT_TRIES = 40;
const NOTE_SIZES = [15, 17, 19, 22, 26, 30];

const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };
/** Pointer acceleration: slow strokes stay precise, fast ones cross the screen. Input in px/ms. */
const gain = (speed) => Math.min(3.6, 0.6 + speed * 1.25);

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
  let meta = { role: "member", perms: { nav: false, laser: false }, admin: null };
  let slide = null;
  let tab = "notes";
  const savedSize = NOTE_SIZES.indexOf(Number(prefs.get("slidepad.noteSize")));
  let noteSize = savedSize >= 0 ? savedSize : 1;

  // ── Join form ────────────────────────────────────────────────────────────
  function renderJoin(error = "") {
    teardown();
    document.title = "Slidepad — join";
    root.innerHTML = `
      <main class="join">
        <header class="join-top">${BRAND}</header>
        <section class="join-body">
          <h1>Join a presentation</h1>
          <p class="lede">Enter the 6-digit code from the screen — or just scan its QR code with your camera.</p>
          <form id="joinForm" class="join-form" novalidate>
            <label class="field">
              <span>Your name</span>
              <input id="nameInput" class="input" autocomplete="given-name" maxlength="32" placeholder="${esc(deviceName())}" value="${esc(prefs.get("slidepad.name") ?? "")}">
            </label>
            <label class="field">
              <span>Code</span>
              <input id="codeInput" class="code-input" inputmode="numeric" autocomplete="one-time-code" placeholder="000 000" maxlength="7" enterkeyhint="go">
            </label>
            <button class="btn btn-primary btn-lg" type="submit">Join</button>
          </form>
          <p class="join-error" id="joinError" role="alert">${esc(error)}</p>
        </section>
        <footer class="join-foot"><a href="?as=screen">Use this device as the screen instead</a></footer>
      </main>`;
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
      if (digits.length === 6) submit();
    });
    $("#joinForm").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    (prefs.get("slidepad.name") ? input : $("#nameInput")).focus();
  }

  function saveName(value) {
    const typed = cleanName(value, "");
    if (typed) prefs.set("slidepad.name", typed);
    name = typed || name;
  }

  // ── Room ─────────────────────────────────────────────────────────────────
  function renderRoom() {
    document.title = `Slidepad — ${formatCode(code)}`;
    root.innerHTML = `
      <main class="remote" id="remote" data-state="connecting" data-role="member" data-tab="notes">
        <header class="r-top">
          <span class="dot"></span>
          <div class="r-heading">
            <p class="r-deck" id="deckName">Connecting…</p>
            <p class="r-sub" id="roleLine"></p>
          </div>
          <span class="r-count" id="count"></span>
          <button type="button" class="icon-btn" id="menuBtn" aria-label="Menu">${icon("menu")}</button>
        </header>

        <section class="r-preview" id="preview" aria-label="Current slide">
          <figure class="r-now"><img id="thumbNow" alt=""></figure>
          <figure class="r-next"><img id="thumbNext" alt=""><figcaption>Next</figcaption></figure>
        </section>

        <div class="seg r-tabs" id="tabs" role="tablist">
          <button type="button" class="seg-btn" role="tab" data-tab="notes">${icon("file-text")}Notes</button>
          <button type="button" class="seg-btn" role="tab" data-tab="laser">${icon("mouse-pointer-2")}Laser</button>
        </div>

        <section class="r-body">
          <div class="r-notes" id="notesView">
            <div class="r-notes-tools">
              <button type="button" class="icon-btn icon-btn-sm" id="smaller" aria-label="Smaller text">${icon("minus")}</button>
              <button type="button" class="icon-btn icon-btn-sm" id="bigger" aria-label="Bigger text">${icon("plus")}</button>
            </div>
            <div class="r-notes-text" id="notes"></div>
          </div>
          <div class="pad" id="pad" aria-label="Laser pad: drag to aim, tap for next slide">
            <div class="pad-hint"><p><b>Drag</b> to aim the laser</p><p><b>Tap</b> for the next slide</p></div>
          </div>
        </section>

        <nav class="remote-nav" id="nav">
          <button type="button" class="nav-btn" id="prev" aria-label="Previous slide">${icon("chevron-left")}<span>Back</span></button>
          <button type="button" class="nav-btn nav-next" id="next" aria-label="Next slide"><span>Next</span>${icon("chevron-right")}</button>
        </nav>

        <div class="r-overlay" id="overlay" hidden></div>

        <div class="sheet-scrim" id="sheet" hidden>
          <section class="sheet" role="dialog" aria-modal="true" aria-label="Menu">
            <header class="sheet-head"><h2>Menu</h2><button type="button" class="icon-btn" id="closeSheet" aria-label="Close">${icon("x")}</button></header>
            <div class="sheet-body">
              <section class="sheet-section">
                <h3>You</h3>
                <label class="field-row">
                  <input id="renameInput" class="input" maxlength="32" value="${esc(name)}" aria-label="Your name" enterkeyhint="done">
                  <span class="role-badge" id="youRole"></span>
                </label>
              </section>
              <div id="adminSections"></div>
              <button type="button" class="btn btn-ghost leave" id="leave">${icon("log-out")}Leave</button>
            </div>
          </section>
        </div>
      </main>`;

    $("#prev").addEventListener("click", () => nav("prev"));
    $("#next").addEventListener("click", () => nav("next"));
    $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
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
    bindPad($("#pad"));
    bindFlick($("#preview"));
    setNoteSize(noteSize);
    renderMeta();
  }

  function setStatus(state, overlay = "") {
    const el = $("#remote");
    if (!el) return;
    el.dataset.state = state;
    const o = $("#overlay");
    o.hidden = !overlay;
    o.innerHTML = overlay;
  }

  const overlayHtml = (title, body) => `<div class="r-overlay-card"><p class="overlay-title">${title}</p><p>${body}</p></div>`;

  function setTab(next) {
    tab = next === "laser" && meta.perms.laser ? "laser" : "notes";
    $("#remote").dataset.tab = tab;
    for (const b of document.querySelectorAll("#tabs [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  }

  function setNoteSize(i) {
    noteSize = Math.max(0, Math.min(NOTE_SIZES.length - 1, i));
    prefs.set("slidepad.noteSize", String(NOTE_SIZES[noteSize]));
    $("#notes")?.style.setProperty("--note-size", `${NOTE_SIZES[noteSize]}px`);
  }

  function renderSlide() {
    if (!slide || !$("#remote")) return;
    $("#deckName").textContent = slide.name;
    $("#count").textContent = `${slide.i + 1} / ${slide.n}`;
    const notes = $("#notes");
    if (slide.notes) { notes.textContent = slide.notes; notes.classList.remove("empty"); }
    else { notes.textContent = "No notes for this slide."; notes.classList.add("empty"); }
    notes.parentElement.scrollTop = 0;
    $("#thumbNow").classList.add("stale");
    $("#thumbNext").classList.add("stale");
    $("#remote").dataset.last = String(slide.i + 1 >= slide.n);
  }

  function renderThumbs(t) {
    if (!slide || t.deckId !== slide.deckId || t.i !== slide.i) return;
    const now = $("#thumbNow"), next = $("#thumbNext");
    if (t.thumb) { now.src = t.thumb; now.classList.remove("stale"); }
    if (t.next) { next.src = t.next; next.classList.remove("stale"); }
  }

  function renderMeta() {
    const el = $("#remote");
    if (!el) return;
    el.dataset.role = meta.role;
    el.dataset.nav = String(!!meta.perms.nav);
    el.dataset.laser = String(!!meta.perms.laser);
    const label = ROLES[meta.role]?.label ?? "Member";
    $("#roleLine").textContent = meta.perms.nav ? `${label} · you’re driving` : `${label} · following along`;
    $("#youRole").textContent = label;
    $("#youRole").dataset.role = meta.role;
    if (tab === "laser" && !meta.perms.laser) setTab("notes");
    else setTab(tab);
    renderAdmin();
  }

  // ── Admin menu ───────────────────────────────────────────────────────────
  function renderAdmin() {
    const box = $("#adminSections");
    if (!box) return;
    const a = meta.admin;
    if (!a) { box.innerHTML = ""; return; }
    const roleSelect = (p) => `
      <select class="select" data-act="role" aria-label="Role for ${esc(p.name)}">
        ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === p.role ? " selected" : ""}>${r.label}</option>`).join("")}
      </select>`;
    box.innerHTML = `
      <section class="sheet-section">
        <h3>Presentations</h3>
        <div class="list">
          ${a.decks.map((d) => `
            <button type="button" class="list-row" data-act="deck" data-id="${esc(d.id)}" aria-current="${d.id === a.activeId}">
              <span class="list-icon">${icon("presentation")}</span>
              <span class="list-text"><span class="list-title">${esc(d.name)}</span><span class="list-sub">${d.n} slides</span></span>
              ${d.id === a.activeId ? `<span class="live-pill">Live</span>` : ""}
            </button>`).join("")}
        </div>
      </section>
      <section class="sheet-section">
        <h3>People <span class="muted">${a.people.filter((p) => p.online).length} online</span></h3>
        <div class="list">
          ${a.pending.map((p) => `
            <div class="list-row person-row" data-cid="${p.cid}">
              <span class="avatar">${esc(p.name[0].toUpperCase())}</span>
              <span class="list-text"><span class="list-title">${esc(p.name)}</span><span class="list-sub">wants to join</span></span>
              <button type="button" class="btn btn-sm btn-ghost" data-act="deny">Deny</button>
              <button type="button" class="btn btn-sm btn-primary" data-act="allow">Allow</button>
            </div>`).join("")}
          ${a.people.map((p) => `
            <div class="list-row person-row" data-cid="${p.cid}" data-online="${p.online}">
              <span class="avatar" data-role="${p.role}">${esc(p.name[0].toUpperCase())}</span>
              <span class="list-text"><span class="list-title">${esc(p.name)}${p.you ? " (you)" : ""}</span><span class="list-sub"><span class="dot"></span>${esc(p.device)}</span></span>
              ${roleSelect(p)}
              ${p.you ? "" : `<button type="button" class="icon-btn icon-btn-sm" data-act="kick" aria-label="Remove ${esc(p.name)}">${icon("x")}</button>`}
            </div>`).join("")}
        </div>
      </section>
      <section class="sheet-section">
        <h3>Settings</h3>
        <div class="setting">
          <p class="setting-name">New people join as</p>
          <div class="seg">
            ${[["member", "Member"], ["teammate", "Teammate"]].map(([v, l]) => `<button type="button" class="seg-btn" data-setting="joinRole" data-value="${v}" aria-checked="${a.settings.joinRole === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting">
          <p class="setting-name">Teammates can use the laser</p>
          <button type="button" class="switch" role="switch" data-setting="laser" aria-checked="${a.settings.laser}"><span></span></button>
        </div>
        <div class="setting">
          <p class="setting-name">Lock the room</p>
          <button type="button" class="switch" role="switch" data-setting="locked" aria-checked="${a.settings.locked}"><span></span></button>
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
    if (e.target.dataset.act !== "role") return;
    send({ t: "role", cid: e.target.closest("[data-cid]").dataset.cid, role: e.target.value });
  }

  function openSheet() {
    $("#renameInput").value = name;
    $("#sheet").hidden = false;
  }
  function closeSheet() { $("#sheet").hidden = true; }

  // ── Sending ──────────────────────────────────────────────────────────────
  const send = (msg) => { try { conn?.open && conn.send(msg); } catch {} };
  function nav(k) {
    if (!meta.perms.nav) return;
    haptic(k === "next" ? 10 : 6);
    send({ t: "nav", k });
  }

  /** Flick the slide preview left/right to change slides. */
  function bindFlick(el) {
    let start = null;
    el.addEventListener("pointerdown", (e) => { start = { x: e.clientX, y: e.clientY, t: e.timeStamp }; });
    el.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = e.timeStamp - start.t;
      start = null;
      if (dt < 500 && Math.abs(dx) > FLICK_MIN_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) nav(dx < 0 ? "next" : "prev");
    });
    el.addEventListener("pointercancel", () => (start = null));
  }

  function bindPad(pad) {
    let active = null;
    let last = null;
    let acc = { dx: 0, dy: 0 };
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (!acc.dx && !acc.dy) return;
      send({ t: "move", dx: Math.round(acc.dx * 10) / 10, dy: Math.round(acc.dy * 10) / 10 });
      acc = { dx: 0, dy: 0 };
    };
    pad.addEventListener("pointerdown", (e) => {
      if (active) return; // one finger drives
      try { pad.setPointerCapture(e.pointerId); } catch {} // keep tracking if the finger leaves the pad
      active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, travel: 0 };
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      pad.classList.add("touching");
    });
    pad.addEventListener("pointermove", (e) => {
      if (!active || e.pointerId !== active.id) return;
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) {
        const dx = ev.clientX - last.x, dy = ev.clientY - last.y;
        const dist = Math.hypot(dx, dy);
        const g = gain(dist / Math.max(1, ev.timeStamp - last.t));
        acc.dx += dx * g;
        acc.dy += dy * g;
        active.travel += dist;
        last = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
      }
      raf ||= requestAnimationFrame(flush);
    });
    const end = (e, cancelled) => {
      if (!active || e.pointerId !== active.id) return;
      const dt = e.timeStamp - active.t;
      const dx = e.clientX - active.x, dy = e.clientY - active.y;
      if (!cancelled) {
        if (active.travel < TAP_MAX_MOVE && dt < TAP_MAX_MS) nav("next");
        else if (dt < FLICK_MAX_MS && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) nav(dx < 0 ? "next" : "prev");
      }
      flush();
      active = null;
      pad.classList.remove("touching");
    };
    pad.addEventListener("pointerup", (e) => end(e, false));
    pad.addEventListener("pointercancel", (e) => end(e, true));
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
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
    if (++tries > RECONNECT_TRIES) return fail("Lost the screen. Ask for the code again and rejoin.");
    setStatus("reconnecting", overlayHtml(esc(text), "Keep this page open — it reconnects on its own."));
    retryTimer = setTimeout(connect, Math.min(4000, 600 + tries * 300));
  }

  function connect() {
    teardown();
    setStatus(admitted ? "reconnecting" : "connecting", admitted ? overlayHtml("Reconnecting…", "Hang tight.") : "");
    let p;
    try { p = createPeer(); } catch { return fail("Couldn’t start. Check your internet connection and try again."); }
    peer = p;
    timeoutTimer = setTimeout(() => {
      if (p !== peer || conn?.open) return;
      if (admitted) retryLater("Reconnecting…");
      else fail("Couldn’t reach the screen. Make sure it’s still open — some strict networks block direct connections.");
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
        else fail(`No screen is showing ${formatCode(code)}. Check the number and try again.`);
      } else if (TRANSIENT_PEER_ERRORS.has(err.type)) retryLater("Connection hiccup — retrying…");
      else { console.warn("[slidepad]", err.type, err); fail("Something went wrong connecting. Try again."); }
    });
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "welcome": return onWelcome(msg);
      case "meta":
        meta = { role: msg.role, perms: msg.perms ?? {}, admin: msg.admin ?? null };
        if (msg.name) name = msg.name;
        return renderMeta();
      case "slide":
        slide = msg;
        return renderSlide();
      case "thumbs":
        return renderThumbs(msg);
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
      setStatus("waiting", overlayHtml("Almost in", "Someone at the screen needs to let you in. Hang tight."));
    } else {
      fail({
        denied: "The screen didn’t let this phone in.",
        removed: "You were removed from the presentation.",
        locked: "This room is locked — no one new can join right now.",
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
