// Desktop side: hosts the session, shows the QR, presents slides, and forwards input to the helper.
import { $, BRAND, PEER_PREFIX, TRANSIENT_PEER_ERRORS, createPeer, esc, formatCode, prefs, session } from "./common.js";
import { demoDeck, pdfDeck } from "./deck.js";
import { createHelper } from "./helper.js";

const SESSION_KEY = "slidepad.screen";
const MODE_KEY = "slidepad.mode";
const LASER_IDLE_MS = 1800;
const UI_IDLE_MS = 2600;
/** Remote deltas are in reference px; REF_WIDTH of them spans the screen width. */
const REF_WIDTH = 700;
const MAX_DELTA = 4000;

const randomCode = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

const OS = /Win/i.test(navigator.userAgentData?.platform ?? navigator.platform) ? "windows" : "mac";
const IS_SAFARI = /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);

const TEMPLATE = `
<div class="screen" id="screen" data-mode="present">
  <main class="stage" id="stage"></main>
  <div class="blank" id="blank" hidden></div>
  <div class="laser" id="laser" aria-hidden="true"></div>
  <div class="ripples" id="ripples" aria-hidden="true"></div>

  <header class="bar bar-top">
    ${BRAND}
    <div class="seg" role="group" aria-label="Mode">
      <button type="button" class="seg-btn" data-mode="present">Present here</button>
      <button type="button" class="seg-btn" data-mode="computer">Control this computer</button>
    </div>
    <button type="button" class="chip" id="chip"><span class="dot"></span><span id="chipText">Pair phone</span></button>
  </header>

  <section class="computer" id="computer" hidden></section>

  <footer class="bar bar-bottom" id="deckBar">
    <span class="deck-name" id="deckName"></span>
    <span class="counter" id="counter"></span>
    <div class="bar-actions">
      <button type="button" class="btn" id="openPdf">Open PDF <kbd>O</kbd></button>
      <button type="button" class="btn" id="fullscreen">Fullscreen <kbd>F</kbd></button>
    </div>
  </footer>

  <div class="scrim" id="pairScrim" hidden>
    <section class="card pair" role="dialog" aria-modal="true" aria-labelledby="pairTitle">
      <div class="qr" id="qr"></div>
      <div class="pair-body">
        <h1 id="pairTitle">Pair your phone</h1>
        <ol class="steps">
          <li>Point your phone’s camera at the code.</li>
          <li>Tap the link that pops up. No app, no account.</li>
        </ol>
        <p class="or">or open <b id="host"></b> on your phone and enter</p>
        <p class="code" id="code"></p>
        <p class="status" id="pairStatus"><span class="dot"></span><span id="pairStatusText">Connecting…</span></p>
        <p class="note" id="lanNote" hidden>Phones can’t open <b>localhost</b>. Open this page from your computer’s network address instead — <code>npm run dev</code> prints it.</p>
      </div>
      <div class="card-foot">
        <button type="button" class="btn btn-ghost" id="newCode">New code</button>
        <button type="button" class="btn" id="pairClose">Close</button>
      </div>
    </section>
  </div>

  <div class="scrim" id="approveScrim" hidden>
    <section class="card approve" role="alertdialog" aria-modal="true" aria-labelledby="approveTitle">
      <h2 id="approveTitle">Let <span id="approveName">a phone</span> control this screen?</h2>
      <p>It typed the code rather than scanning it. Only allow a device you recognise — in “Control this computer” it can press keys and move your mouse.</p>
      <div class="card-foot">
        <button type="button" class="btn btn-ghost" id="deny">Deny</button>
        <button type="button" class="btn btn-primary" id="allow">Allow</button>
      </div>
    </section>
  </div>

  <div class="drop" id="drop" hidden><div class="drop-inner">Drop a PDF to present it</div></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <input type="file" id="file" accept="application/pdf,.pdf" hidden>
</div>`;

function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR code that opens the remote on your phone"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0c0c0e"/></svg>`;
}

export function start(root) {
  root.innerHTML = TEMPLATE;
  const screen = $("#screen");
  const stage = $("#stage");
  const laser = $("#laser");

  let { code, secret } = session.get(SESSION_KEY) ?? {};
  let peer = null;
  let retryTimer = 0;
  let mode = prefs.get(MODE_KEY) === "computer" ? "computer" : "present";
  let deck = demoDeck;
  let index = 0;
  let renderToken = 0;
  let blanked = false;

  /** peerId -> { conn, approved, device } */
  const remotes = new Map();
  const approvals = [];
  const approved = () => [...remotes.values()].filter((r) => r.approved);

  const helper = createHelper((status) => {
    renderComputer(status);
    broadcastState();
  });

  // ── Toast ────────────────────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ── Pairing session ──────────────────────────────────────────────────────
  function newSession() {
    code = randomCode();
    secret = randomSecret();
    session.set(SESSION_KEY, { code, secret });
    renderPair();
  }

  function renderPair() {
    const url = new URL(location.pathname, location.origin);
    url.search = new URLSearchParams({ join: code, k: secret }).toString();
    $("#qr").innerHTML = qrSvg(url.href);
    $("#code").textContent = formatCode(code);
    $("#host").textContent = location.host + location.pathname.replace(/\/(index\.html)?$/, "");
    $("#lanNote").hidden = !/^(localhost|127\.|\[::1\])/.test(location.hostname);
  }

  function setPairStatus(state) {
    const text = {
      connecting: "Starting session…",
      ready: "Waiting for your phone",
      reconnecting: "Reconnecting to the pairing service…",
      error: "Can’t reach the pairing service. Check your internet connection.",
    }[state];
    $("#pairStatus").dataset.state = state;
    $("#pairStatusText").textContent = text;
  }

  function startPeer() {
    clearTimeout(retryTimer);
    peer?.destroy();
    setPairStatus("connecting");
    let p;
    try {
      p = createPeer(PEER_PREFIX + code);
    } catch {
      setPairStatus("error");
      return;
    }
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
      if (err.type === "unavailable-id") {
        newSession();
        startPeer();
      } else if (TRANSIENT_PEER_ERRORS.has(err.type)) {
        setPairStatus("reconnecting");
        clearTimeout(retryTimer);
        // reconnect() keeps live phone connections; only rebuild when the peer is gone entirely.
        retryTimer = setTimeout(() => (p.destroyed ? startPeer() : p.disconnected && p.reconnect()), 3000);
      } else {
        console.warn("[slidepad]", err.type, err);
      }
    });
  }

  // ── Phones ───────────────────────────────────────────────────────────────
  function onConnection(conn) {
    const remote = { conn, approved: false, device: "Phone" };
    remotes.set(conn.peer, remote);
    conn.on("data", (msg) => onRemoteMessage(remote, msg));
    const gone = () => {
      if (remotes.get(conn.peer) !== remote) return;
      remotes.delete(conn.peer);
      const i = approvals.indexOf(remote);
      if (i >= 0) approvals.splice(i, 1);
      if (i === 0) showNextApproval();
      if (remote.approved) toast(`${remote.device} disconnected`);
      updatePresence();
    };
    conn.on("close", gone);
    conn.on("error", gone);
  }

  const send = (remote, msg) => { try { remote.conn.open && remote.conn.send(msg); } catch {} };

  function onRemoteMessage(remote, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "hello") {
      remote.device = String(msg.device || "Phone").slice(0, 40);
      if (remote.approved) return sendState(remote);
      if (typeof msg.k === "string" && msg.k === secret) approve(remote);
      else requestApproval(remote);
      return;
    }
    if (!remote.approved) return;
    if (msg.t === "move") {
      const dx = Number(msg.dx), dy = Number(msg.dy);
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.abs(dx) < MAX_DELTA && Math.abs(dy) < MAX_DELTA) onMove(dx, dy);
    } else if (msg.t === "click") onClick();
    else if (msg.t === "key") onKey(msg.k);
  }

  function approve(remote) {
    remote.approved = true;
    // Hand over the session secret so this phone reconnects without asking again — same trust as scanning the QR.
    send(remote, { t: "approval", status: "ok", k: secret });
    sendState(remote);
    toast(`${remote.device} connected`);
    updatePresence();
  }

  function requestApproval(remote) {
    send(remote, { t: "approval", status: "pending" });
    approvals.push(remote);
    if (approvals.length === 1) showNextApproval();
  }

  function showNextApproval() {
    const next = approvals[0];
    $("#approveScrim").hidden = !next;
    if (next) {
      $("#approveName").textContent = next.device;
      $("#allow").focus();
    }
  }

  function answerApproval(allow) {
    const remote = approvals.shift();
    if (remote) {
      if (allow) approve(remote);
      else {
        send(remote, { t: "approval", status: "denied" });
        setTimeout(() => remote.conn.close(), 300);
      }
    }
    showNextApproval();
  }

  function updatePresence() {
    const list = approved();
    const chip = $("#chip");
    chip.dataset.connected = String(list.length > 0);
    $("#chipText").textContent = !list.length
      ? "Pair phone"
      : list.length === 1 ? `${list[0].device} connected` : `${list.length} phones connected`;
    if (list.length && pairOpenedAutomatically) closePair();
    scheduleIdle();
  }

  function stateMessage() {
    return {
      t: "state",
      mode,
      helper: mode === "computer" ? helper.status : null,
      i: index,
      n: deck.count,
      name: deck.name,
      blank: blanked,
    };
  }
  const sendState = (remote) => send(remote, stateMessage());
  function broadcastState() {
    for (const r of approved()) sendState(r);
  }

  // ── Input from the phone ─────────────────────────────────────────────────
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  let laserTimer = 0;
  let laserVisible = false;

  function onMove(dx, dy) {
    if (mode === "computer") return helper.send({ t: "move", dx, dy });
    const k = innerWidth / REF_WIDTH;
    pos.x = Math.min(innerWidth - 1, Math.max(0, pos.x + dx * k));
    pos.y = Math.min(innerHeight - 1, Math.max(0, pos.y + dy * k));
    laser.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    laserVisible = true;
    laser.classList.add("on");
    clearTimeout(laserTimer);
    laserTimer = setTimeout(hideLaser, LASER_IDLE_MS);
  }

  function hideLaser() {
    laserVisible = false;
    laser.classList.remove("on");
  }

  function ripple(x, y) {
    const r = document.createElement("span");
    r.className = "ripple";
    r.style.transform = `translate(${x}px, ${y}px)`;
    $("#ripples").append(r);
    r.addEventListener("animationend", () => r.remove());
  }

  function onClick() {
    if (mode === "computer") return helper.send({ t: "click" });
    // With the laser hidden there is no visible aim, so a tap simply advances — like clicking a slide.
    if (!laserVisible) return go(index + 1);
    ripple(pos.x, pos.y);
    const target = document.elementFromPoint(pos.x, pos.y)?.closest("button, a[href], input, label, summary");
    if (target && !stage.contains(target)) target.click();
    else go(index + 1);
  }

  function onKey(k) {
    if (mode === "computer") {
      if (["next", "prev", "first", "last", "blank", "escape"].includes(k)) helper.send({ t: "key", k });
      return;
    }
    if (k === "next") go(index + 1);
    else if (k === "prev") go(index - 1);
    else if (k === "first") go(0);
    else if (k === "last") go(deck.count - 1);
    else if (k === "blank") toggleBlank();
  }

  // ── Deck ─────────────────────────────────────────────────────────────────
  function stageSize() {
    return { width: stage.clientWidth, height: stage.clientHeight };
  }

  async function show() {
    const token = ++renderToken;
    $("#deckName").textContent = deck.name;
    $("#counter").textContent = `${index + 1} / ${deck.count}`;
    broadcastState();
    try {
      const node = await deck.show(index, stageSize());
      if (token === renderToken && node) stage.replaceChildren(node);
    } catch (err) {
      console.warn("[slidepad] render failed", err);
      if (token === renderToken) toast("Couldn’t render that page");
    }
  }

  function go(i) {
    const next = Math.min(deck.count - 1, Math.max(0, i));
    if (blanked) toggleBlank(false);
    hideLaser();
    if (next === index) return;
    index = next;
    show();
  }

  function toggleBlank(force = !blanked) {
    blanked = force;
    $("#blank").hidden = !blanked;
    broadcastState();
  }

  async function openPdf(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return toast("Slidepad presents PDFs — export your deck as PDF first.");
    toast(`Opening ${file.name}…`);
    try {
      const next = await pdfDeck(file);
      deck.destroy?.();
      deck = next;
      index = 0;
      setMode("present");
      await show();
      toast(`${deck.name} · ${deck.count} slide${deck.count === 1 ? "" : "s"}`);
    } catch (err) {
      console.warn("[slidepad] pdf failed", err);
      toast("That file couldn’t be opened as a PDF.");
    }
  }

  // ── Modes & the helper panel ─────────────────────────────────────────────
  function setMode(next) {
    mode = next;
    prefs.set(MODE_KEY, mode);
    screen.dataset.mode = mode;
    for (const b of screen.querySelectorAll(".seg-btn")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    $("#computer").hidden = mode !== "computer";
    $("#deckBar").hidden = mode !== "present";
    stage.hidden = mode !== "present";
    hideLaser();
    if (mode === "computer") helper.start();
    else helper.stop();
    scheduleIdle();
    broadcastState();
  }

  function commandBlock(label, cmd) {
    return `<div class="cmd">
      <div class="cmd-label">${label}</div>
      <div class="cmd-row"><code>${esc(cmd)}</code><button type="button" class="btn btn-sm" data-copy="${esc(cmd)}">Copy</button></div>
    </div>`;
  }

  function renderComputer(status) {
    const base = new URL("./", location.href).href;
    const machine = OS === "windows" ? "PC" : "Mac";
    const mac = commandBlock("Mac — open <b>Terminal</b> and paste", `curl -fsSL ${base}mac.sh | sh`);
    const win = commandBlock("Windows — open <b>PowerShell</b> and paste", `irm ${base}win.txt | iex`);
    const views = {
      checking: `<div class="panel-state"><span class="spinner"></span><p>Looking for the Slidepad helper on this computer…</p></div>`,
      absent: `
        <p class="eyebrow">Control this computer</p>
        <h2>One line, and your phone drives your real keyboard and mouse.</h2>
        <p class="lede">Keynote, PowerPoint, Google Slides, anything. Paste the line below — this page picks it up on its own.</p>
        <div class="cmds">${OS === "windows" ? win + mac : mac + win}</div>
        <ul class="fine">
          <li>Nothing gets installed. It runs only while that window is open — close it or press <kbd>Ctrl</kbd> <kbd>C</kbd> and it’s gone.</li>
          <li>If your browser asks to <b>access devices on your local network</b>, click Allow — that’s how this tab reaches the helper.</li>
          ${IS_SAFARI ? `<li class="warn">Safari blocks pages from talking to local apps. Use Chrome, Edge, Arc or Firefox for this mode.</li>` : ""}
        </ul>`,
      permission: `
        <p class="eyebrow">Almost there</p>
        <h2>Allow Terminal to control your Mac.</h2>
        <p class="lede">macOS asks once. Without it, the helper can’t press keys for you.</p>
        <ol class="steps steps-lg">
          <li>Open <b>System Settings → Privacy &amp; Security → Accessibility</b>.</li>
          <li>Turn on <b>Terminal</b> (or iTerm, if that’s where you pasted).</li>
          <li>Come back here — it continues automatically.</li>
        </ol>
        <a class="btn btn-primary" href="x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility">Open Accessibility settings</a>`,
      ready: `
        <p class="eyebrow ok"><span class="dot"></span>Helper connected</p>
        <h2>Your phone now controls this ${machine}.</h2>
        <p class="lede">Open Keynote, PowerPoint or Google Slides and start presenting. Leave this tab open — it’s fine in the background.</p>
        <dl class="mapping">
          <div><dt>Next / Prev</dt><dd><kbd>→</kbd> <kbd>←</kbd></dd></div>
          <div><dt>Drag on the pad</dt><dd>Moves the mouse</dd></div>
          <div><dt>Tap</dt><dd>Clicks</dd></div>
          <div><dt>Blank</dt><dd><kbd>B</kbd> — black screen in Keynote &amp; PowerPoint</dd></div>
        </dl>
        <p class="fine">Done? Close the Terminal window to stop the helper.</p>`,
    };
    $("#computer").innerHTML = `<div class="panel">${views[status] ?? views.checking}</div>`;
  }

  // ── Pair dialog ──────────────────────────────────────────────────────────
  let pairOpenedAutomatically = false;
  function openPair(auto = false) {
    pairOpenedAutomatically = auto;
    $("#pairScrim").hidden = false;
    $("#pairClose").textContent = approved().length ? "Done" : "Close";
  }
  function closePair() {
    pairOpenedAutomatically = false;
    $("#pairScrim").hidden = true;
  }

  // ── Idle chrome (hide bars + cursor while presenting) ────────────────────
  let idleTimer = 0;
  function scheduleIdle() {
    screen.classList.remove("idle");
    clearTimeout(idleTimer);
    const dialogs = !$("#pairScrim").hidden || !$("#approveScrim").hidden;
    if (mode === "present" && !dialogs) idleTimer = setTimeout(() => screen.classList.add("idle"), UI_IDLE_MS);
  }

  // ── Events ───────────────────────────────────────────────────────────────
  screen.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.mode) setMode(t.dataset.mode);
    else if (t.dataset.copy) {
      navigator.clipboard?.writeText(t.dataset.copy).then(
        () => { t.textContent = "Copied"; setTimeout(() => (t.textContent = "Copy"), 1600); },
        () => toast("Select the line and copy it manually"),
      );
    } else if (t.id === "chip") openPair();
    else if (t.id === "pairClose") closePair();
    else if (t.id === "newCode") {
      for (const r of remotes.values()) r.conn.close();
      newSession();
      startPeer();
    } else if (t.id === "allow") answerApproval(true);
    else if (t.id === "deny") answerApproval(false);
    else if (t.id === "openPdf") $("#file").click();
    else if (t.id === "fullscreen") toggleFullscreen();
    scheduleIdle();
  });
  $("#pairScrim").addEventListener("click", (e) => e.target === e.currentTarget && closePair());
  $("#file").addEventListener("change", (e) => { openPdf(e.target.files[0]); e.target.value = ""; });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (!$("#approveScrim").hidden) return answerApproval(false);
      if (!$("#pairScrim").hidden) return closePair();
    }
    if (!$("#approveScrim").hidden || !$("#pairScrim").hidden || mode !== "present") return;
    const map = {
      ArrowRight: "next", ArrowDown: "next", PageDown: "next", " ": "next", Enter: "next",
      ArrowLeft: "prev", ArrowUp: "prev", PageUp: "prev", Backspace: "prev",
      Home: "first", End: "last", b: "blank", B: "blank", ".": "blank",
    };
    if (map[e.key]) { e.preventDefault(); onKey(map[e.key]); }
    else if (e.key === "f" || e.key === "F") toggleFullscreen();
    else if (e.key === "o" || e.key === "O") $("#file").click();
  });

  addEventListener("mousemove", scheduleIdle, { passive: true });

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => mode === "present" && show(), 150);
  });

  // Drag & drop a PDF anywhere on the window.
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
    openPdf(e.dataTransfer?.files[0]);
  });

  // Let the broker release our ID immediately so a refresh can reclaim the same code.
  addEventListener("pagehide", () => peer?.destroy());

  // ── Boot ─────────────────────────────────────────────────────────────────
  if (!/^\d{6}$/.test(code ?? "") || !/^[0-9a-f]{24}$/.test(secret ?? "")) newSession();
  else renderPair();
  renderComputer(helper.status);
  setMode(mode);
  show();
  openPair(true);
  startPeer();
}
