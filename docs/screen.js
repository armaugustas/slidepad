// Desktop side: hosts the session, keeps the presentation library, runs the room (people + roles),
// and presents slides with a laser that phones can steer.
import {
  $, BRAND, PEER_PREFIX, ROLES, TRANSIENT_PEER_ERRORS, can, cleanName, createPeer, esc, formatCode, prefs, randomId, session,
} from "./common.js";
import { demoDeck, pdfDeck } from "./deck.js";
import { icon } from "./icons.js";
import { library } from "./library.js";
import { isNotesFile, notesFromFile } from "./notes.js";

const SESSION_KEY = "slidepad.host";
const ACTIVE_KEY = "slidepad.active";
const LASER_IDLE_MS = 1800;
const UI_IDLE_MS = 2600;
/** Phone deltas are in reference px; REF_WIDTH of them spans the screen width. */
const REF_WIDTH = 700;
const MAX_DELTA = 4000;
const DEFAULT_SETTINGS = { joinRole: "member", laser: true, locked: false };

const randomCode = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const baseName = (name) => name.replace(/\.[^.]+$/, "");
const sameBase = (a, b) => baseName(a).trim().toLowerCase() === baseName(b).trim().toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const TEMPLATE = `
<div class="app" id="shell" data-view="home">
  <header class="topbar">
    ${BRAND}
    <nav class="tabs" aria-label="View">
      <button type="button" class="tab" data-view="home">${icon("house")}Home</button>
      <button type="button" class="tab" data-view="present">${icon("presentation")}Present</button>
    </nav>
    <button type="button" class="presence" id="presence"><span class="dot"></span><span id="presenceText">No one connected</span></button>
  </header>

  <main class="home" id="home">
    <section class="library">
      <div class="section-head">
        <div>
          <h1>Presentations</h1>
          <p class="sub">The highlighted one is live. Admins can switch between them from their phone.</p>
        </div>
        <button type="button" class="btn btn-primary" id="addBtn">${icon("plus")}Add</button>
      </div>
      <div class="deck-grid" id="deckGrid"></div>
      <div class="tip">
        ${icon("sticky-note")}
        <p><b>Speaker notes:</b> drop the matching <b>.pptx</b> alongside your PDF (same file name), or use “Add notes” on a card. A <b>.txt</b> with <code>---</code> between slides works too. From Keynote, export once to PDF and once to PowerPoint.</p>
      </div>
    </section>

    <aside class="side">
      <section class="panel join-panel">
        <div class="qr" id="qr"></div>
        <div class="join-copy">
          <h2>Join on your phone</h2>
          <p>Scan with the camera, or open <b id="host"></b> and enter</p>
          <p class="code" id="code"></p>
          <p class="status" id="pairStatus"><span class="dot"></span><span id="pairStatusText">Starting…</span></p>
        </div>
        <p class="note" id="lanNote" hidden>Phones can’t open <b>localhost</b> — open this page from your computer’s network address (<code>npm run dev</code> prints it).</p>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>People</h2><span class="count" id="peopleCount"></span></div>
        <ul class="people" id="people"></ul>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Settings</h2></div>
        <div class="settings" id="settings"></div>
      </section>
    </aside>
  </main>

  <section class="present" id="present" hidden>
    <div class="stage" id="stage"></div>
    <div class="laser" id="laser" aria-hidden="true"></div>
    <footer class="present-bar" id="presentBar">
      <button type="button" class="icon-btn" data-view="home" aria-label="Home">${icon("house")}</button>
      <span class="divider"></span>
      <button type="button" class="icon-btn" id="prevBtn" aria-label="Previous slide">${icon("chevron-left")}</button>
      <span class="counter" id="counter"></span>
      <button type="button" class="icon-btn" id="nextBtn" aria-label="Next slide">${icon("chevron-right")}</button>
      <span class="divider"></span>
      <span class="deck-title" id="deckTitle"></span>
      <button type="button" class="icon-btn" id="joinBtn" aria-label="Show join code (J)">${icon("qr-code")}</button>
      <button type="button" class="icon-btn" id="fsBtn" aria-label="Fullscreen (F)">${icon("maximize")}</button>
    </footer>
    <div class="join-overlay" id="joinOverlay" hidden>
      <div class="join-overlay-card">
        <div class="qr" id="qrBig"></div>
        <div>
          <p class="join-overlay-title">Follow along on your phone</p>
          <p class="join-overlay-sub">Scan, or open <b id="hostBig"></b></p>
          <p class="code" id="codeBig"></p>
        </div>
      </div>
    </div>
  </section>

  <div class="scrim" id="approveScrim" hidden>
    <section class="card approve" role="alertdialog" aria-modal="true" aria-labelledby="approveTitle">
      <h2 id="approveTitle"><span id="approveName">Someone</span> wants to join</h2>
      <p id="approveSub">They typed the code instead of scanning it.</p>
      <div class="card-foot">
        <button type="button" class="btn btn-ghost" id="deny">Deny</button>
        <button type="button" class="btn btn-primary" id="allow">Let them in</button>
      </div>
    </section>
  </div>

  <div class="drop" id="drop" hidden><div class="drop-inner">${icon("plus")}<span>Drop PDFs — and .pptx for notes</span></div></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <input type="file" id="fileInput" accept=".pdf,.pptx,.txt,.md,application/pdf" multiple hidden>
  <input type="file" id="notesInput" accept=".pptx,.txt,.md" hidden>
</div>`;

function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR code to join on your phone"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0c0c0e"/></svg>`;
}

export function start(root) {
  root.innerHTML = TEMPLATE;
  const shell = $("#shell");
  const stage = $("#stage");
  const laser = $("#laser");

  // ── State ────────────────────────────────────────────────────────────────
  const saved = session.get(SESSION_KEY) ?? {};
  let code = saved.code;
  let secret = saved.secret;
  const settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  /** cid -> { cid, name, device, role, conn } — survives a refresh so roles stick. */
  const people = new Map((saved.people ?? []).map((p) => [p.cid, { ...p, conn: null }]));
  const banned = new Set(saved.banned ?? []);
  /** Typed-code joiners waiting for a yes: { cid, name, device, conn } */
  const pending = [];

  const decks = [demoDeck()];
  const records = new Map(); // deck id -> IndexedDB record
  let activeId = prefs.get(ACTIVE_KEY) ?? "demo";
  let index = 0;
  let view = "home";
  let peer = null;
  let retryTimer = 0;

  const active = () => decks.find((d) => d.id === activeId) ?? decks[0];
  const online = () => [...people.values()].filter((p) => p.conn?.open);
  const send = (p, msg) => { try { p.conn?.open && p.conn.send(msg); } catch {} };

  function persist() {
    session.set(SESSION_KEY, {
      code, secret, settings,
      banned: [...banned],
      people: [...people.values()].map(({ cid, name, device, role }) => ({ cid, name, device, role })),
    });
  }

  // ── Toast ────────────────────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ── Session & pairing ────────────────────────────────────────────────────
  function newSession() {
    code = randomCode();
    secret = randomId(12);
    persist();
    renderJoin();
  }

  function renderJoin() {
    const url = new URL(location.pathname, location.origin);
    url.search = new URLSearchParams({ join: code, k: secret }).toString();
    const svg = qrSvg(url.href);
    const host = location.host + location.pathname.replace(/\/(index\.html)?$/, "");
    $("#qr").innerHTML = svg;
    $("#qrBig").innerHTML = svg;
    $("#code").textContent = $("#codeBig").textContent = formatCode(code);
    $("#host").textContent = $("#hostBig").textContent = host;
    $("#lanNote").hidden = !/^(localhost|127\.|\[::1\])/.test(location.hostname);
  }

  function setPairStatus(state) {
    $("#pairStatus").dataset.state = state;
    $("#pairStatusText").textContent = {
      connecting: "Starting…",
      ready: "Ready for phones",
      reconnecting: "Reconnecting…",
      error: "Can’t reach the pairing service — check your internet.",
    }[state];
  }

  function startPeer() {
    clearTimeout(retryTimer);
    peer?.destroy();
    setPairStatus("connecting");
    let p;
    try { p = createPeer(PEER_PREFIX + code); } catch { return setPairStatus("error"); }
    peer = p;
    p.on("open", () => p === peer && setPairStatus("ready"));
    p.on("connection", onConnection);
    p.on("disconnected", () => {
      if (p !== peer || p.destroyed) return;
      setPairStatus("reconnecting");
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => p.disconnected && !p.destroyed && p.reconnect(), 1500);
    });
    p.on("error", (err) => {
      if (p !== peer) return;
      if (err.type === "unavailable-id") { newSession(); startPeer(); }
      else if (TRANSIENT_PEER_ERRORS.has(err.type)) {
        setPairStatus("reconnecting");
        clearTimeout(retryTimer);
        // reconnect() keeps live phone connections; only rebuild if the peer is gone entirely.
        retryTimer = setTimeout(() => (p.destroyed ? startPeer() : p.disconnected && p.reconnect()), 3000);
      } else console.warn("[slidepad]", err.type, err);
    });
  }

  // ── Phones joining ───────────────────────────────────────────────────────
  function onConnection(conn) {
    conn.on("data", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "hello" && !conn.slidepad) return hello(conn, msg);
      const p = conn.slidepad?.person;
      if (p && p.conn === conn) handle(p, msg);
    });
    const gone = () => {
      const s = conn.slidepad;
      if (!s) return;
      if (s.person?.conn === conn) { s.person.conn = null; syncRoom(); }
      if (s.pending) dropPending(s.pending);
      conn.slidepad = null;
    };
    conn.on("close", gone);
    conn.on("error", gone);
  }

  function reject(conn, status) {
    try { conn.send({ t: "welcome", status }); } catch {}
    setTimeout(() => conn.close(), 300);
  }

  function hello(conn, msg) {
    const cid = typeof msg.cid === "string" && /^[0-9a-f]{16}$/.test(msg.cid) ? msg.cid : null;
    if (!cid || banned.has(cid)) return reject(conn, "denied");
    const name = cleanName(msg.name, "Guest");
    const device = cleanName(msg.device, "Phone");
    const trusted = typeof msg.k === "string" && msg.k === secret;
    const known = people.has(cid);
    if (!known && settings.locked) return reject(conn, "locked");
    if (trusted) return admit(conn, cid, name, device);
    // Typed the code: someone must say yes (this computer, or an admin's phone).
    const pend = { cid, name, device, conn };
    conn.slidepad = { pending: pend };
    pending.push(pend);
    try { conn.send({ t: "welcome", status: "pending" }); } catch {}
    showApproval();
    syncRoom();
  }

  function admit(conn, cid, name, device) {
    let p = people.get(cid);
    if (!p) {
      const hasAdmin = [...people.values()].some((x) => x.role === "admin");
      p = { cid, name, device, role: hasAdmin ? settings.joinRole : "admin", conn: null };
      people.set(cid, p);
      toast(`${name} joined as ${ROLES[p.role].label}`);
    } else {
      p.name = name;
      p.device = device;
    }
    if (p.conn && p.conn !== conn) { try { p.conn.close(); } catch {} }
    p.conn = conn;
    conn.slidepad = { person: p };
    // Hand over the session secret so this phone reconnects without asking — same trust as scanning.
    send(p, { t: "welcome", status: "ok", k: secret });
    sendSlide(p);
    syncRoom();
    return p;
  }

  function dropPending(pend) {
    const i = pending.indexOf(pend);
    if (i < 0) return;
    pending.splice(i, 1);
    showApproval();
    syncRoom();
  }

  function answer(cid, allow) {
    const pend = pending.find((x) => x.cid === cid);
    if (!pend) return;
    pending.splice(pending.indexOf(pend), 1);
    if (allow && pend.conn.open) admit(pend.conn, pend.cid, pend.name, pend.device);
    else { pend.conn.slidepad = null; reject(pend.conn, "denied"); }
    showApproval();
    syncRoom();
  }

  function showApproval() {
    const next = pending[0];
    $("#approveScrim").hidden = !next;
    if (!next) return;
    $("#approveName").textContent = next.name;
    $("#approveSub").textContent = `${next.device} typed the code instead of scanning it. They’ll join as ${ROLES[settings.joinRole].label}.`;
  }

  function kick(cid) {
    const p = people.get(cid);
    if (!p) return;
    banned.add(cid);
    people.delete(cid);
    if (p.conn) { p.conn.slidepad = null; reject(p.conn, "removed"); }
    toast(`${p.name} was removed`);
    syncRoom();
  }

  // ── Messages from phones ─────────────────────────────────────────────────
  function handle(p, msg) {
    const admin = p.role === "admin";
    switch (msg.t) {
      case "nav":
        if (!can(p.role, "nav", settings)) return;
        if (msg.k === "next") go(index + 1);
        else if (msg.k === "prev") go(index - 1);
        else if (msg.k === "goto" && Number.isInteger(msg.i)) go(msg.i);
        setView("present");
        break;
      case "move": {
        if (!can(p.role, "laser", settings)) return;
        const dx = Number(msg.dx), dy = Number(msg.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > MAX_DELTA || Math.abs(dy) > MAX_DELTA) return;
        setView("present");
        moveLaser(dx, dy);
        break;
      }
      case "deck":
        if (admin && decks.some((d) => d.id === msg.id)) { setActive(msg.id); setView("present"); }
        break;
      case "role": {
        const target = people.get(msg.cid);
        if (admin && target) setRole(target, msg.role);
        break;
      }
      case "kick":
        if (admin && msg.cid !== p.cid) kick(msg.cid);
        break;
      case "approve":
        if (admin) answer(msg.cid, !!msg.allow);
        break;
      case "settings":
        if (admin) updateSettings(msg.settings);
        break;
      case "rename":
        p.name = cleanName(msg.name, p.name);
        syncRoom();
        break;
    }
  }

  function setRole(p, role) {
    if (!ROLES[role] || p.role === role) return;
    p.role = role;
    syncRoom();
    sendSlide(p); // previews differ by role (members don't get the next slide)
    toast(`${p.name} is now ${ROLES[role].label}`);
  }

  function updateSettings(next = {}) {
    if (ROLES[next.joinRole] && next.joinRole !== "admin") settings.joinRole = next.joinRole;
    if (typeof next.laser === "boolean") settings.laser = next.laser;
    if (typeof next.locked === "boolean") settings.locked = next.locked;
    syncRoom();
  }

  // ── Keeping phones in sync ───────────────────────────────────────────────
  function metaFor(p) {
    const meta = {
      t: "meta",
      role: p.role,
      name: p.name,
      perms: { nav: can(p.role, "nav", settings), laser: can(p.role, "laser", settings) },
    };
    if (p.role === "admin") {
      meta.admin = {
        decks: decks.map((d) => ({ id: d.id, name: d.name, n: d.count })),
        activeId: active().id,
        settings,
        people: [...people.values()].map((x) => ({ cid: x.cid, name: x.name, device: x.device, role: x.role, online: !!x.conn?.open, you: x === p })),
        pending: pending.map(({ cid, name, device }) => ({ cid, name, device })),
      };
    }
    return meta;
  }

  /** People, roles, settings or the library changed: refresh the side panel and every phone. */
  function syncRoom() {
    for (const p of online()) send(p, metaFor(p));
    renderPeople();
    renderSettings();
    persist();
  }

  const slideMsg = () => {
    const d = active();
    return { t: "slide", deckId: d.id, name: d.name, i: index, n: d.count, notes: d.notes[index] ?? "" };
  };

  async function thumbsMsg(p, d, i) {
    const [thumb, next] = await Promise.all([d.thumb(i), p.role !== "member" && i + 1 < d.count ? d.thumb(i + 1) : null]);
    return { t: "thumbs", deckId: d.id, i, thumb, next };
  }

  async function sendSlide(p) {
    send(p, slideMsg());
    send(p, metaFor(p));
    const d = active(), i = index;
    try { send(p, await thumbsMsg(p, d, i)); } catch {}
  }

  let slideToken = 0;
  async function broadcastSlide() {
    const token = ++slideToken;
    const d = active(), i = index;
    const msg = slideMsg();
    for (const p of online()) send(p, msg);
    for (const p of online()) {
      try {
        const t = await thumbsMsg(p, d, i);
        if (token !== slideToken) return;
        send(p, t);
      } catch {}
    }
  }

  // ── Library ──────────────────────────────────────────────────────────────
  async function loadLibrary() {
    for (const rec of await library.all()) {
      try {
        decks.push(await pdfDeck(rec));
        records.set(rec.id, rec);
      } catch (err) {
        console.warn("[slidepad] couldn’t restore", rec.name, err);
      }
    }
    if (!decks.some((d) => d.id === activeId)) activeId = "demo";
    renderLibrary();
    onSlideChanged();
    syncRoom();
  }

  async function addFiles(fileList) {
    const files = [...fileList];
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    const notes = files.filter((f) => isNotesFile(f) && !pdfs.includes(f));
    if (!pdfs.length && !notes.length) {
      return toast(files.some((f) => /\.(key|ppt|odp)$/i.test(f.name))
        ? "Export your deck as PDF first — Slidepad presents PDFs."
        : "Slidepad takes PDFs, plus .pptx or .txt for notes.");
    }
    const added = [];
    for (const f of pdfs) {
      try {
        const rec = { id: randomId(), name: baseName(f.name), data: await f.arrayBuffer(), notes: [], addedAt: Date.now() };
        const deck = await pdfDeck(rec);
        rec.notes = deck.notes;
        decks.push(deck);
        records.set(deck.id, rec);
        added.push(deck);
        library.put(rec);
      } catch (err) {
        console.warn("[slidepad] pdf failed", err);
        toast(`Couldn’t open ${f.name}`);
      }
    }
    for (const f of notes) {
      const target = decks.find((d) => d.kind === "pdf" && sameBase(d.name, f.name)) ?? (added.length === 1 ? added[0] : null);
      if (target) await attachNotes(target, f);
      else toast(`Couldn’t tell which deck ${f.name} belongs to — use “Add notes” on its card.`);
    }
    if (added.length) {
      if (active().kind === "demo") setActive(added[0].id);
      toast(added.length === 1 ? `Added ${added[0].name} · ${plural(added[0].count, "slide")}` : `Added ${added.length} presentations`);
    }
    renderLibrary();
    syncRoom();
  }

  async function attachNotes(deck, file) {
    try {
      const notes = await notesFromFile(file);
      deck.notes = notes;
      const rec = records.get(deck.id);
      if (rec) { rec.notes = notes; library.put(rec); }
      const filled = notes.filter(Boolean).length;
      toast(notes.length !== deck.count
        ? `Notes for ${plural(notes.length, "slide")}, but ${deck.name} has ${deck.count} — check they line up.`
        : `Added notes to ${plural(filled, "slide")} of ${deck.name}`);
      if (deck === active()) broadcastSlide();
      renderLibrary();
    } catch (err) {
      console.warn("[slidepad] notes failed", err);
      toast(`Couldn’t read notes from ${file.name}`);
    }
  }

  function removeDeck(id) {
    const i = decks.findIndex((d) => d.id === id);
    if (i <= 0) return; // the tour stays
    const [deck] = decks.splice(i, 1);
    deck.destroy();
    records.delete(id);
    library.remove(id);
    if (activeId === id) setActive("demo");
    renderLibrary();
    syncRoom();
    toast(`Removed ${deck.name}`);
  }

  function setActive(id) {
    if (activeId === id) return;
    activeId = id;
    index = 0;
    prefs.set(ACTIVE_KEY, id);
    renderLibrary();
    onSlideChanged();
    syncRoom();
  }

  function renderLibrary() {
    const grid = $("#deckGrid");
    grid.innerHTML = decks.map((d) => {
      const notes = d.notes.filter(Boolean).length;
      const live = d.id === active().id;
      return `
        <article class="deck-card" data-id="${d.id}" data-live="${live}">
          <button type="button" class="deck-thumb" data-act="present" aria-label="Present ${esc(d.name)}">
            <img alt="" decoding="async">
            ${live ? `<span class="live-badge"><span class="dot"></span>Live · ${index + 1}/${d.count}</span>` : ""}
            <span class="play">${icon("play")}Present</span>
          </button>
          <div class="deck-meta">
            <div class="deck-text">
              <p class="deck-name" title="${esc(d.name)}">${esc(d.name)}</p>
              <p class="deck-sub">${plural(d.count, "slide")} · ${notes ? `<span class="has-notes">${icon("sticky-note")}Notes</span>` : "No notes"}</p>
            </div>
            ${d.kind === "pdf" ? `
              <button type="button" class="icon-btn icon-btn-sm" data-act="notes" aria-label="Add notes to ${esc(d.name)}" title="Add notes (.pptx or .txt)">${icon("sticky-note")}</button>
              <button type="button" class="icon-btn icon-btn-sm" data-act="remove" aria-label="Remove ${esc(d.name)}" title="Remove">${icon("trash-2")}</button>` : ""}
          </div>
        </article>`;
    }).join("") + `
      <button type="button" class="deck-add" data-act="add">
        <span class="deck-add-icon">${icon("plus")}</span>
        <span><b>Add presentation</b><br>Drop PDFs here, or click to choose</span>
      </button>`;
    for (const d of decks) {
      d.thumb(0).then((url) => {
        const img = grid.querySelector(`[data-id="${d.id}"] img`);
        if (img) img.src = url;
      }, () => {});
    }
  }

  // ── People & settings panels ─────────────────────────────────────────────
  function renderPeople() {
    const list = [...people.values()].sort((a, b) => !!b.conn?.open - !!a.conn?.open);
    const on = online().length;
    $("#presenceText").textContent = on ? `${plural(on, "person")} connected`.replace("persons", "people") : "No one connected";
    $("#presence").dataset.on = String(on > 0);
    $("#peopleCount").textContent = list.length ? `${on} online` : "";
    const pendingRows = pending.map((x) => `
      <li class="person pending" data-cid="${x.cid}">
        <span class="avatar">${esc(x.name[0].toUpperCase())}</span>
        <div class="person-text"><p class="person-name">${esc(x.name)}</p><p class="person-sub">${esc(x.device)} · wants to join</p></div>
        <button type="button" class="btn btn-sm btn-ghost" data-act="deny">Deny</button>
        <button type="button" class="btn btn-sm btn-primary" data-act="allow">Allow</button>
      </li>`).join("");
    const rows = list.map((x) => `
      <li class="person" data-cid="${x.cid}" data-online="${!!x.conn?.open}">
        <span class="avatar" data-role="${x.role}">${esc(x.name[0].toUpperCase())}</span>
        <div class="person-text">
          <p class="person-name">${esc(x.name)}</p>
          <p class="person-sub"><span class="dot"></span>${esc(x.device)} · ${x.conn?.open ? "online" : "offline"}</p>
        </div>
        <select class="select" data-act="role" aria-label="Role for ${esc(x.name)}">
          ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === x.role ? " selected" : ""}>${r.label}</option>`).join("")}
        </select>
        <button type="button" class="icon-btn icon-btn-sm" data-act="kick" aria-label="Remove ${esc(x.name)}" title="Remove">${icon("x")}</button>
      </li>`).join("");
    $("#people").innerHTML = pendingRows + rows || `
      <li class="people-empty">
        ${icon("users")}
        <p>No one yet. Scan the code to join — the first phone becomes <b>Admin</b>.</p>
      </li>`;
  }

  function renderSettings() {
    const seg = (key, options) => `
      <div class="seg" role="radiogroup">
        ${options.map(([v, label]) => `<button type="button" class="seg-btn" role="radio" data-setting="${key}" data-value="${v}" aria-checked="${settings[key] === v}">${label}</button>`).join("")}
      </div>`;
    const toggle = (key) => `<button type="button" class="switch" role="switch" data-setting="${key}" aria-checked="${settings[key]}"><span></span></button>`;
    $("#settings").innerHTML = `
      <div class="setting">
        <div><p class="setting-name">New people join as</p><p class="setting-sub">${ROLES[settings.joinRole].blurb}.</p></div>
        ${seg("joinRole", [["member", "Member"], ["teammate", "Teammate"]])}
      </div>
      <div class="setting">
        <div><p class="setting-name">Teammates can use the laser</p><p class="setting-sub">Admins always can.</p></div>
        ${toggle("laser")}
      </div>
      <div class="setting">
        <div><p class="setting-name">Lock the room</p><p class="setting-sub">No one new can join. People already here can reconnect.</p></div>
        ${toggle("locked")}
      </div>
      <button type="button" class="btn btn-ghost btn-sm reset" data-act="reset">New join code — removes everyone</button>`;
  }

  // ── Presenting ───────────────────────────────────────────────────────────
  let renderToken = 0;
  async function showSlide() {
    if (view !== "present") return;
    const token = ++renderToken;
    try {
      const canvas = await active().render(index, stage.clientWidth, stage.clientHeight);
      if (token === renderToken && canvas) stage.replaceChildren(canvas);
    } catch (err) {
      console.warn("[slidepad] render failed", err);
    }
  }

  function onSlideChanged() {
    const d = active();
    $("#counter").textContent = `${index + 1} / ${d.count}`;
    $("#deckTitle").textContent = d.name;
    const badge = document.querySelector(`.deck-card[data-id="${d.id}"] .live-badge`);
    if (badge) badge.lastChild.textContent = `Live · ${index + 1}/${d.count}`;
    showSlide();
    broadcastSlide();
  }

  function go(i) {
    const next = Math.min(active().count - 1, Math.max(0, i));
    hideLaser();
    if (next === index) return;
    index = next;
    onSlideChanged();
  }

  function setView(next) {
    if (view === next) return;
    view = next;
    shell.dataset.view = view;
    $("#home").hidden = view !== "home";
    $("#present").hidden = view !== "present";
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-current", String(t.dataset.view === view));
    if (view === "present") showSlide();
    else { $("#joinOverlay").hidden = true; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
    scheduleIdle();
  }

  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  let laserTimer = 0;
  function moveLaser(dx, dy) {
    const k = innerWidth / REF_WIDTH;
    pos.x = Math.min(innerWidth - 1, Math.max(0, pos.x + dx * k));
    pos.y = Math.min(innerHeight - 1, Math.max(0, pos.y + dy * k));
    laser.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    laser.classList.add("on");
    clearTimeout(laserTimer);
    laserTimer = setTimeout(hideLaser, LASER_IDLE_MS);
  }
  function hideLaser() { laser.classList.remove("on"); }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  let idleTimer = 0;
  function scheduleIdle() {
    shell.classList.remove("idle");
    clearTimeout(idleTimer);
    if (view === "present") idleTimer = setTimeout(() => shell.classList.add("idle"), UI_IDLE_MS);
  }

  // ── Events ───────────────────────────────────────────────────────────────
  let notesTarget = null;
  shell.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const card = t.closest(".deck-card");
    const row = t.closest(".person");
    if (t.dataset.view) setView(t.dataset.view);
    else if (t.id === "presence") { setView("home"); $("#people").scrollIntoView({ behavior: "smooth", block: "center" }); }
    else if (t.id === "addBtn" || t.dataset.act === "add") $("#fileInput").click();
    else if (card && t.dataset.act === "present") { setActive(card.dataset.id); setView("present"); }
    else if (card && t.dataset.act === "notes") { notesTarget = decks.find((d) => d.id === card.dataset.id); $("#notesInput").click(); }
    else if (card && t.dataset.act === "remove") removeDeck(card.dataset.id);
    else if (row && t.dataset.act === "kick") kick(row.dataset.cid);
    else if (row && t.dataset.act === "allow") answer(row.dataset.cid, true);
    else if (row && t.dataset.act === "deny") answer(row.dataset.cid, false);
    else if (t.id === "allow") answer(pending[0]?.cid, true);
    else if (t.id === "deny") answer(pending[0]?.cid, false);
    else if (t.dataset.setting) {
      const key = t.dataset.setting;
      updateSettings({ [key]: t.dataset.value ?? !settings[key] });
    } else if (t.dataset.act === "reset") {
      for (const p of people.values()) if (p.conn) { p.conn.slidepad = null; reject(p.conn, "removed"); }
      for (const x of pending.splice(0)) reject(x.conn, "denied");
      people.clear();
      banned.clear();
      newSession();
      startPeer();
      showApproval();
      syncRoom();
      toast("New join code — everyone was disconnected");
    } else if (t.id === "prevBtn") go(index - 1);
    else if (t.id === "nextBtn") go(index + 1);
    else if (t.id === "joinBtn") $("#joinOverlay").hidden = !$("#joinOverlay").hidden;
    else if (t.id === "fsBtn") toggleFullscreen();
  });

  shell.addEventListener("change", (e) => {
    const row = e.target.closest(".person");
    if (row && e.target.dataset.act === "role") {
      const p = people.get(row.dataset.cid);
      if (p) setRole(p, e.target.value);
    }
  });

  $("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  $("#notesInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file && notesTarget) attachNotes(notesTarget, file);
  });

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, select, textarea")) return;
    if (!$("#approveScrim").hidden) {
      if (e.key === "Escape") answer(pending[0]?.cid, false);
      return;
    }
    if (view !== "present") return;
    const nav = {
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, Enter: 1,
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1,
    }[e.key];
    if (nav) { e.preventDefault(); go(index + nav); }
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(active().count - 1);
    else if (e.key === "f" || e.key === "F") toggleFullscreen();
    else if (e.key === "j" || e.key === "J") $("#joinOverlay").hidden = !$("#joinOverlay").hidden;
    else if ((e.key === "Escape" && !document.fullscreenElement) || e.key === "h" || e.key === "H") setView("home");
  });

  addEventListener("mousemove", scheduleIdle, { passive: true });

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(showSlide, 150);
  });

  const drop = $("#drop");
  addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    drop.hidden = false;
  });
  addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.hidden = true; });
  addEventListener("drop", (e) => {
    e.preventDefault();
    drop.hidden = true;
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });

  // Let the broker release our ID straight away so a refresh can reclaim the same code.
  addEventListener("pagehide", () => peer?.destroy());

  // ── Boot ─────────────────────────────────────────────────────────────────
  if (!/^\d{6}$/.test(code ?? "") || !/^[0-9a-f]{24}$/.test(secret ?? "")) newSession();
  else renderJoin();
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-current", String(t.dataset.view === view));
  renderLibrary();
  renderPeople();
  renderSettings();
  onSlideChanged();
  startPeer();
  loadLibrary();
}
