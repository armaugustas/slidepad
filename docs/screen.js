// Desktop side: hosts the session, keeps the presentation library, runs the room (people + roles),
// and presents slides with a laser that phones point by touching their slide preview.
import { $, LOGO, ROLES, canDrive, cleanName, esc, formatCode, prefs, randomId, session } from "./common.js";
import { demoDeck, pdfDeck } from "./deck.js";
import { mountDither } from "./dither.js";
import { icon } from "./icons.js";
import { library } from "./library.js";
import { isNotesFile, notesFromFile } from "./notes.js";
import { hostRoom, transportSupported } from "./transport.js";

const SESSION_KEY = "slidepad.host";
const ACTIVE_KEY = "slidepad.active";
const UI_IDLE_MS = 2600;
const DEFAULT_SETTINGS = { joinRole: "member", locked: false };

const randomCode = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const baseName = (name) => name.replace(/\.[^.]+$/, "");
const sameBase = (a, b) => baseName(a).trim().toLowerCase() === baseName(b).trim().toLowerCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

const TEMPLATE = `
<div class="app" id="shell" data-view="home">
  <div class="home" id="home">
    <div class="rail">
      <header class="nav">
        <a class="brand" href="./" aria-label="Slidepad home">${LOGO}<span class="wordmark">slidepad</span></a>
        <button type="button" class="btn btn-primary" id="presentBtn">${icon("play")}Present</button>
      </header>

      <main class="home-grid">
        <section class="decks" aria-labelledby="decksTitle">
          <div class="head">
            <h1 id="decksTitle">Presentations</h1>
            <p class="sub">Drop in a PDF. Add the .pptx with the same name and its speaker notes come along.</p>
          </div>
          <div class="deck-grid" id="deckGrid"></div>
        </section>

        <aside class="side">
          <section class="card join-card" aria-labelledby="joinTitle">
            <div class="qr" id="qr"></div>
            <div class="join-copy">
              <h2 id="joinTitle">Join on your phone</h2>
              <p>Scan with the camera, or open <b id="host"></b> and enter the code.</p>
              <p class="status" id="pairStatus"><span class="dot"></span><span id="pairStatusText">Starting…</span></p>
            </div>
            <div class="join-code"><span>Code</span><p class="code" id="code"></p></div>
            <p class="note" id="lanNote" hidden>Phones can’t open <b>localhost</b>. Open this page from your computer’s Wi-Fi address instead (<code>npm run dev</code> prints it).</p>
          </section>

          <section class="card people-card" aria-labelledby="peopleTitle">
            <div class="card-head">
              <h2 id="peopleTitle">People <span class="count" id="peopleCount"></span></h2>
              <button type="button" class="icon-btn" id="settingsBtn" aria-expanded="false" aria-controls="settings" aria-label="Room settings">${icon("settings")}</button>
            </div>
            <div class="settings" id="settings" hidden></div>
            <ul class="people" id="people"></ul>
          </section>
        </aside>
      </main>
    </div>
    <canvas class="dither" id="dither" aria-hidden="true"></canvas>
  </div>

  <section class="present" id="present" hidden>
    <div class="stage" id="stage"></div>
    <div class="laser" id="laser" aria-hidden="true"></div>
    <footer class="present-bar">
      <button type="button" class="bar-btn" id="exitBtn" aria-label="Back to home (Esc)">${icon("arrow-left")}</button>
      <span class="bar-sep"></span>
      <button type="button" class="bar-btn" id="prevBtn" aria-label="Previous slide">${icon("chevron-left")}</button>
      <span class="counter" id="counter"></span>
      <button type="button" class="bar-btn" id="nextBtn" aria-label="Next slide">${icon("chevron-right")}</button>
      <span class="bar-sep"></span>
      <button type="button" class="bar-btn" id="joinBtn" aria-label="Show join code (J)">${icon("qr-code")}</button>
      <button type="button" class="bar-btn" id="fsBtn" aria-label="Fullscreen (F)">${icon("maximize")}</button>
    </footer>
    <div class="join-float" id="joinFloat" hidden>
      <div class="qr" id="qrBig"></div>
      <div>
        <p class="join-float-title">Follow along on your phone</p>
        <p class="join-float-sub">Scan, or open <b id="hostBig"></b></p>
        <p class="code" id="codeBig"></p>
      </div>
    </div>
  </section>

  <div class="scrim" id="approveScrim" hidden>
    <section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="approveTitle" aria-describedby="approveSub">
      <h2 id="approveTitle"><span id="approveName">Someone</span> wants to join</h2>
      <p id="approveSub"></p>
      <div class="dialog-foot">
        <button type="button" class="btn btn-ghost" id="deny">Not now</button>
        <button type="button" class="btn btn-primary" id="allow">Let them in</button>
      </div>
    </section>
  </div>

  <div class="drop" id="drop" hidden><div class="drop-inner">${icon("plus")}<span>Drop to add</span></div></div>
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
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges" role="img" aria-label="QR code to join on your phone"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${d}" fill="#08090c"/></svg>`;
}

export function start(root) {
  root.innerHTML = TEMPLATE;
  const shell = $("#shell");
  const stage = $("#stage");
  const laser = $("#laser");
  mountDither($("#dither"));

  // ── State ────────────────────────────────────────────────────────────────
  const saved = session.get(SESSION_KEY) ?? {};
  let code = saved.code;
  let secret = saved.secret;
  const settings = { ...DEFAULT_SETTINGS, ...saved.settings };
  /** cid -> { cid, name, device, role, conn } — survives a refresh so roles stick. */
  const people = new Map((saved.people ?? []).map((p) => [p.cid, { ...p, conn: null }]));
  const banned = new Set(saved.banned ?? []);
  /** Typed-code joiners waiting for a yes: { cid, name, device } */
  const pending = [];

  const decks = [demoDeck()];
  const records = new Map(); // deck id -> IndexedDB record
  let activeId = prefs.get(ACTIVE_KEY) ?? "demo";
  let index = 0;
  let view = "home";
  let host = null;
  let netToken = 0;

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
    $("#qr").innerHTML = $("#qrBig").innerHTML = svg;
    $("#code").textContent = $("#codeBig").textContent = formatCode(code);
    $("#host").textContent = $("#hostBig").textContent = host;
    $("#lanNote").hidden = !/^(localhost|127\.|\[::1\])/.test(location.hostname);
  }

  function setPairStatus(state) {
    $("#pairStatus").dataset.state = state;
    $("#pairStatusText").textContent = {
      connecting: "Starting…",
      ready: "Ready",
      reconnecting: "Reconnecting…",
      error: "Offline — check your internet",
      insecure: "Needs https — open the published site",
    }[state];
  }

  async function startNet() {
    const token = ++netToken;
    host?.stop();
    host = null;
    if (!transportSupported()) return setPairStatus("insecure");
    setPairStatus("connecting");
    try {
      const h = await hostRoom({
        code, secret,
        onStatus: (s) => token === netToken && setPairStatus(s === "online" ? "ready" : "reconnecting"),
        onJoin: (link, info) => token === netToken && onJoin(link, info),
        onLobby: (info) => token === netToken && onLobby(info),
        onLobbyGone: (cid) => token === netToken && dropPending(cid),
      });
      if (token !== netToken) return h.stop();
      host = h;
      if (h.online) setPairStatus("ready");
    } catch (err) {
      console.warn("[slidepad] network failed", err);
      if (token === netToken) setPairStatus("error");
    }
  }

  // ── Phones joining ───────────────────────────────────────────────────────
  function reject(link, status) {
    link.send({ t: "welcome", status });
    link.close();
  }

  /** A phone holding the room secret (scanned the QR, or was let in) said hello. */
  function onJoin(link, info) {
    const cid = info.cid;
    if (banned.has(cid)) return reject(link, "denied");
    if (!people.has(cid) && settings.locked) return reject(link, "locked");
    link.onMessage = (msg) => {
      const p = people.get(cid);
      if (p && p.conn === link) handle(p, msg);
    };
    link.onClose = () => {
      const p = people.get(cid);
      if (p && p.conn === link) syncRoom();
    };
    let p = people.get(cid);
    const name = cleanName(info.name, "Guest");
    const device = cleanName(info.device, "Phone");
    if (!p) {
      const hasAdmin = [...people.values()].some((x) => x.role === "admin");
      p = { cid, name, device, role: hasAdmin ? settings.joinRole : "admin", conn: null };
      people.set(cid, p);
      toast(`${name} joined`);
    } else {
      p.name = name;
      p.device = device;
    }
    if (p.conn && p.conn !== link) p.conn.close();
    p.conn = link;
    link.send({ t: "welcome", status: "ok" });
    sendSlide(p);
    syncRoom();
  }

  /** Typed the code: someone must say yes (this computer, or an admin's phone). */
  function onLobby(info) {
    const cid = info.cid;
    if (banned.has(cid)) return host?.lobbyAnswer(cid, "denied");
    if (!people.has(cid) && settings.locked) return host?.lobbyAnswer(cid, "locked");
    if (pending.some((x) => x.cid === cid)) return;
    pending.push({ cid, name: cleanName(info.name, "Guest"), device: cleanName(info.device, "Phone") });
    host?.lobbyAnswer(cid, "pending");
    showApproval();
    syncRoom();
  }

  function dropPending(cid) {
    const i = pending.findIndex((x) => x.cid === cid);
    if (i < 0) return;
    pending.splice(i, 1);
    showApproval();
    syncRoom();
  }

  function answer(cid, allow) {
    const i = pending.findIndex((x) => x.cid === cid);
    if (i < 0) return;
    pending.splice(i, 1);
    // Once allowed, the phone receives the room secret and says hello like a scanner would.
    host?.lobbyAnswer(cid, allow ? "allow" : "denied");
    showApproval();
    syncRoom();
  }

  function showApproval() {
    const next = pending[0];
    $("#approveScrim").hidden = !next;
    if (!next) return;
    $("#approveName").textContent = next.name;
    $("#approveSub").textContent = `They typed the code on their ${next.device.toLowerCase()} instead of scanning it.`;
  }

  function kick(cid) {
    const p = people.get(cid);
    if (!p) return;
    banned.add(cid);
    people.delete(cid);
    if (p.conn) reject(p.conn, "removed");
    toast(`Removed ${p.name}`);
    syncRoom();
  }

  function setRole(p, role) {
    if (!ROLES[role] || p.role === role) return;
    p.role = role;
    syncRoom();
    sendSlide(p);
  }

  // ── Messages from phones ─────────────────────────────────────────────────
  function handle(p, msg) {
    const admin = p.role === "admin";
    switch (msg.t) {
      case "nav":
        if (!canDrive(p.role)) return;
        if (msg.k === "next") go(index + 1);
        else if (msg.k === "prev") go(index - 1);
        setView("present");
        break;
      case "point":
        if (!canDrive(p.role)) return;
        if (msg.on && Number.isFinite(msg.x) && Number.isFinite(msg.y)) { setView("present"); pointLaser(clamp01(msg.x), clamp01(msg.y)); }
        else hideLaser();
        break;
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

  function updateSettings(next = {}) {
    if (next.joinRole === "member" || next.joinRole === "teammate") settings.joinRole = next.joinRole;
    if (typeof next.locked === "boolean") settings.locked = next.locked;
    syncRoom();
  }

  // ── Keeping phones in sync ───────────────────────────────────────────────
  function metaFor(p) {
    const meta = { t: "meta", role: p.role, name: p.name, drive: canDrive(p.role) };
    if (p.role === "admin") {
      meta.admin = {
        decks: decks.map((d) => ({ id: d.id, name: d.name, n: d.count })),
        activeId: active().id,
        settings,
        people: [...people.values()].map((x) => ({ cid: x.cid, name: x.name, role: x.role, online: !!x.conn?.open, you: x === p })),
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

  async function thumbsMsg(d, i) {
    return { t: "thumbs", deckId: d.id, i, thumb: await d.thumb(i) };
  }

  async function sendSlide(p) {
    send(p, slideMsg());
    send(p, metaFor(p));
    try { send(p, await thumbsMsg(active(), index)); } catch {}
  }

  let slideToken = 0;
  async function broadcastSlide() {
    const token = ++slideToken;
    const d = active(), i = index;
    host?.broadcast(slideMsg());
    try {
      const t = await thumbsMsg(d, i);
      if (token === slideToken) host?.broadcast(t);
    } catch {}
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
        ? "Export it as a PDF first, then drop that in."
        : "That isn’t a PDF.");
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
      else toast(`Use the notes button on a presentation to add ${f.name}`);
    }
    if (added.length) {
      if (active().kind === "demo") setActive(added[0].id);
      toast(added.length === 1 ? `Added ${added[0].name}` : `Added ${added.length} presentations`);
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
      toast(notes.length !== deck.count
        ? `Notes cover ${plural(notes.length, "slide")} but the PDF has ${deck.count} — check they match`
        : `Notes added to ${deck.name}`);
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
      const live = d.id === active().id;
      const hasNotes = d.notes.some(Boolean);
      return `
        <article class="deck" data-id="${d.id}" data-live="${live}">
          <button type="button" class="deck-thumb" data-act="present" aria-label="${live ? "Live: " : ""}Present ${esc(d.name)}">
            <img alt="" decoding="async">
            ${live ? `<span class="live-tag"><span class="dot"></span>Live</span>` : ""}
          </button>
          <div class="deck-meta">
            <div class="deck-text">
              <p class="deck-name" title="${esc(d.name)}">${esc(d.name)}</p>
              <p class="deck-sub">${plural(d.count, "slide")}${hasNotes ? " · notes" : ""}</p>
            </div>
            ${d.kind === "pdf" ? `
              <div class="deck-actions">
                <button type="button" class="icon-btn icon-btn-sm" data-act="notes" aria-label="Add speaker notes to ${esc(d.name)}" title="Add notes (.pptx or .txt)">${icon("sticky-note")}</button>
                <button type="button" class="icon-btn icon-btn-sm" data-act="remove" aria-label="Remove ${esc(d.name)}" title="Remove">${icon("trash-2")}</button>
              </div>` : ""}
          </div>
        </article>`;
    }).join("") + `
      <button type="button" class="deck-add" data-act="add">
        <span class="deck-add-icon">${icon("plus")}</span>
        <span class="deck-add-text">Add a PDF</span>
      </button>`;
    for (const d of decks) {
      d.thumb(0).then((url) => {
        const img = grid.querySelector(`[data-id="${d.id}"] img`);
        if (img) img.src = url;
      }, () => {});
    }
  }

  // ── People & settings ────────────────────────────────────────────────────
  function renderPeople() {
    const list = [...people.values()].sort((a, b) => !!b.conn?.open - !!a.conn?.open);
    $("#peopleCount").textContent = online().length || "";
    const pendingRows = pending.map((x) => `
      <li class="person" data-cid="${x.cid}" data-pending="true">
        <span class="avatar">${esc(x.name[0].toUpperCase())}</span>
        <div class="person-text"><p class="person-name">${esc(x.name)}</p><p class="person-sub">Wants to join</p></div>
        <button type="button" class="btn btn-sm btn-ghost" data-act="deny">Not now</button>
        <button type="button" class="btn btn-sm btn-primary" data-act="allow">Let in</button>
      </li>`).join("");
    const rows = list.map((x) => `
      <li class="person" data-cid="${x.cid}" data-online="${!!x.conn?.open}">
        <span class="avatar" data-role="${x.role}">${esc(x.name[0].toUpperCase())}</span>
        <div class="person-text">
          <p class="person-name">${esc(x.name)}</p>
          <p class="person-sub">${x.conn?.open ? ROLES[x.role].blurb : "Offline"}</p>
        </div>
        <select class="select" data-act="role" aria-label="Role for ${esc(x.name)}">
          ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === x.role ? " selected" : ""}>${r.label}</option>`).join("")}
        </select>
        <button type="button" class="icon-btn icon-btn-sm person-remove" data-act="kick" aria-label="Remove ${esc(x.name)}" title="Remove">${icon("x")}</button>
      </li>`).join("");
    $("#people").innerHTML = pendingRows + rows || `
      <li class="people-empty">
        <p>No one here yet.</p>
        <p>The first phone to join runs the room as <b>Admin</b>.</p>
      </li>`;
  }

  function renderSettings() {
    $("#settings").innerHTML = `
      <div class="setting">
        <p class="setting-name">New people</p>
        <div class="seg" role="radiogroup" aria-label="New people join as">
          ${[["member", "Follow"], ["teammate", "Can drive"]].map(([v, l]) => `<button type="button" class="seg-btn" role="radio" data-setting="joinRole" data-value="${v}" aria-checked="${settings.joinRole === v}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="setting">
        <p class="setting-name">Lock the room</p>
        <button type="button" class="switch" role="switch" data-setting="locked" aria-checked="${settings.locked}" aria-label="Lock the room"><span></span></button>
      </div>
      <button type="button" class="link-btn" data-act="reset">New code — disconnects everyone</button>`;
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
    $("#counter").textContent = `${index + 1} / ${active().count}`;
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
    if (view === "present") showSlide();
    else {
      $("#joinFloat").hidden = true;
      hideLaser();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    scheduleIdle();
  }

  /** x, y are 0–1 within the slide; the phone points by touching its preview of the same slide. */
  function pointLaser(x, y) {
    const slide = stage.firstElementChild?.getBoundingClientRect();
    if (!slide) return;
    laser.style.transform = `translate(${slide.left + x * slide.width}px, ${slide.top + y * slide.height}px)`;
    laser.classList.add("on");
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
    const deck = t.closest(".deck");
    const row = t.closest(".person");
    const act = t.dataset.act;
    if (t.id === "presentBtn") setView("present");
    else if (t.id === "exitBtn") setView("home");
    else if (act === "add") $("#fileInput").click();
    else if (deck && act === "present") { setActive(deck.dataset.id); setView("present"); }
    else if (deck && act === "notes") { notesTarget = decks.find((d) => d.id === deck.dataset.id); $("#notesInput").click(); }
    else if (deck && act === "remove") removeDeck(deck.dataset.id);
    else if (row && act === "kick") kick(row.dataset.cid);
    else if (row && act === "allow") answer(row.dataset.cid, true);
    else if (row && act === "deny") answer(row.dataset.cid, false);
    else if (t.id === "allow") answer(pending[0]?.cid, true);
    else if (t.id === "deny") answer(pending[0]?.cid, false);
    else if (t.id === "settingsBtn") {
      const open = $("#settings").hidden;
      $("#settings").hidden = !open;
      t.setAttribute("aria-expanded", String(open));
    } else if (t.dataset.setting) {
      const key = t.dataset.setting;
      updateSettings({ [key]: t.dataset.value ?? !settings[key] });
    } else if (act === "reset") {
      for (const p of people.values()) if (p.conn) reject(p.conn, "removed");
      for (const x of pending.splice(0)) host?.lobbyAnswer(x.cid, "denied");
      people.clear();
      banned.clear();
      newSession();
      startNet();
      showApproval();
      syncRoom();
      toast("New code — everyone was disconnected");
    } else if (t.id === "prevBtn") go(index - 1);
    else if (t.id === "nextBtn") go(index + 1);
    else if (t.id === "joinBtn") $("#joinFloat").hidden = !$("#joinFloat").hidden;
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
    const step = {
      ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, Enter: 1,
      ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1,
    }[e.key];
    if (step) { e.preventDefault(); go(index + step); }
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(active().count - 1);
    else if (e.key === "f" || e.key === "F") toggleFullscreen();
    else if (e.key === "j" || e.key === "J") $("#joinFloat").hidden = !$("#joinFloat").hidden;
    else if (e.key === "Escape" && !document.fullscreenElement) setView("home");
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

  addEventListener("pagehide", () => host?.stop());

  // ── Boot ─────────────────────────────────────────────────────────────────
  if (!/^\d{6}$/.test(code ?? "") || !/^[0-9a-f]{24}$/.test(secret ?? "")) newSession();
  else renderJoin();
  renderLibrary();
  renderPeople();
  renderSettings();
  onSlideChanged();
  startNet();
  loadLibrary();
}
