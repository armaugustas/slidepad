// Phone side: joins a screen by code, then turns the touchscreen into a trackpad + clicker.
import { $, BRAND, CONNECT_TIMEOUT_MS, PEER_PREFIX, TRANSIENT_PEER_ERRORS, createPeer, deviceName, esc, formatCode } from "./common.js";

const TAP_MAX_MOVE = 10;
const TAP_MAX_MS = 280;
const FLICK_MAX_MS = 320;
const FLICK_MIN_PX = 70;
const RECONNECT_TRIES = 40;

const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };

/** Pointer acceleration: slow strokes stay precise, fast ones cross the screen. Input in px/ms. */
const gain = (speed) => Math.min(3.6, 0.6 + speed * 1.25);

export function start(root, params) {
  let peer = null;
  let conn = null;
  let code = null;
  let key = null;
  let wasApproved = false;
  let tries = 0;
  let timeoutTimer = 0;
  let retryTimer = 0;
  let wakeLock = null;
  let leaving = false;

  // ── Join form ────────────────────────────────────────────────────────────
  function renderJoin(error = "") {
    teardown();
    document.title = "Slidepad — join";
    root.innerHTML = `
      <main class="join">
        <header class="join-top">${BRAND}</header>
        <section class="join-body">
          <h1>Connect to a screen</h1>
          <p class="lede">Enter the 6-digit code shown on the computer you want to control.</p>
          <form id="joinForm" class="join-form" novalidate>
            <input id="codeInput" class="code-input" inputmode="numeric" autocomplete="one-time-code"
              aria-label="6-digit code" placeholder="000 000" maxlength="7" enterkeyhint="go" autofocus>
            <button class="btn btn-primary btn-lg" type="submit">Connect</button>
          </form>
          <p class="join-error" id="joinError" role="alert">${esc(error)}</p>
          <p class="fine">On the computer, open <b>${esc(location.host + location.pathname.replace(/\/(index\.html)?$/, ""))}</b> — or just scan its QR code with your camera.</p>
        </section>
        <footer class="join-foot"><a href="?as=screen">Use this device as the screen instead</a></footer>
      </main>`;
    const input = $("#codeInput");
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "").slice(0, 6);
      input.value = digits.length > 3 ? formatCode(digits) : digits;
      if (digits.length === 6) join(digits, null);
    });
    $("#joinForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const digits = input.value.replace(/\D/g, "");
      if (digits.length === 6) join(digits, null);
      else $("#joinError").textContent = "The code has 6 digits.";
    });
  }

  // ── Controller ───────────────────────────────────────────────────────────
  function renderController() {
    document.title = `Slidepad — ${formatCode(code)}`;
    root.innerHTML = `
      <main class="remote" id="remote" data-state="connecting">
        <header class="remote-top">
          <span class="status"><span class="dot"></span><span id="status">Connecting…</span></span>
          <span class="remote-count" id="count"></span>
          <button type="button" class="btn btn-sm btn-ghost" id="leave">Leave</button>
        </header>
        <section class="pad" id="pad" aria-label="Trackpad: drag to point, tap to click, flick to change slides">
          <div class="pad-hint" id="padHint">
            <p><b>Drag</b> to point</p>
            <p><b>Tap</b> to click</p>
            <p><b>Flick</b> ← → to change slides</p>
          </div>
          <div class="pad-overlay" id="overlay" hidden></div>
        </section>
        <nav class="remote-nav">
          <button type="button" class="nav-btn" id="prev" aria-label="Previous slide">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
          </button>
          <button type="button" class="nav-btn nav-blank" id="blank" aria-label="Blank the screen" aria-pressed="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/></svg>
          </button>
          <button type="button" class="nav-btn nav-next" id="next" aria-label="Next slide">
            <span>Next</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        </nav>
      </main>`;
    bindPad($("#pad"));
    $("#prev").addEventListener("click", () => sendKey("prev"));
    $("#next").addEventListener("click", () => sendKey("next"));
    $("#blank").addEventListener("click", () => sendKey("blank"));
    $("#leave").addEventListener("click", leave);
  }

  function setStatus(state, text, overlay = "") {
    const el = $("#remote");
    if (!el) return;
    el.dataset.state = state;
    $("#status").textContent = text;
    const o = $("#overlay");
    o.hidden = !overlay;
    o.innerHTML = overlay;
    $("#padHint").hidden = !!overlay;
  }

  function onState(s) {
    const count = $("#count");
    if (!count) return;
    if (s.mode === "computer") {
      count.textContent = s.helper === "ready" ? "Computer" : "";
      count.dataset.kind = "label";
    } else {
      count.textContent = `${s.i + 1} / ${s.n}`;
      count.dataset.kind = "number";
    }
    $("#blank")?.setAttribute("aria-pressed", String(!!s.blank));
    if (s.mode === "computer" && s.helper !== "ready") {
      setStatus("waiting", "Connected", `<p class="overlay-title">Almost there</p><p>Finish setting up the helper on the computer — the steps are on its screen.</p>`);
    } else if (wasApproved) {
      setStatus("live", "Connected");
    }
  }

  // ── Sending ──────────────────────────────────────────────────────────────
  const send = (msg) => { try { conn?.open && conn.send(msg); } catch {} };
  function sendKey(k) {
    haptic(k === "next" ? 10 : 6);
    send({ t: "key", k });
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
      if (active) return; // one finger drives; extra fingers are ignored
      pad.setPointerCapture(e.pointerId);
      active = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, travel: 0 };
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      pad.classList.add("touching");
      $("#padHint")?.classList.add("gone");
    });

    pad.addEventListener("pointermove", (e) => {
      if (!active || e.pointerId !== active.id) return;
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) {
        const dx = ev.clientX - last.x;
        const dy = ev.clientY - last.y;
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
      const dx = e.clientX - active.x;
      const dy = e.clientY - active.y;
      if (!cancelled) {
        if (active.travel < TAP_MAX_MOVE && dt < TAP_MAX_MS) {
          haptic(6);
          send({ t: "click" });
        } else if (dt < FLICK_MAX_MS && Math.abs(dx) > FLICK_MIN_PX && Math.abs(dx) > 2 * Math.abs(dy)) {
          sendKey(dx < 0 ? "next" : "prev");
        }
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
    wasApproved = false;
    tries = 0;
    leaving = false;
    const url = new URL(location.pathname, location.origin);
    url.search = new URLSearchParams(key ? { join: code, k: key } : { join: code }).toString();
    history.replaceState(null, "", url);
    renderController();
    connect();
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

  function fail(message) {
    renderJoin(message);
  }

  function retryLater(text) {
    teardown();
    if (leaving) return;
    if (++tries > RECONNECT_TRIES) return fail("Lost the screen. Ask for the code again and reconnect.");
    setStatus("reconnecting", text, `<p class="overlay-title">${esc(text)}</p><p>Keep this page open — it reconnects on its own.</p>`);
    retryTimer = setTimeout(connect, Math.min(4000, 600 + tries * 300));
  }

  function connect() {
    teardown();
    setStatus(wasApproved ? "reconnecting" : "connecting", wasApproved ? "Reconnecting…" : "Connecting…");
    let p;
    try {
      p = createPeer();
    } catch {
      return fail("Couldn’t start. Check your internet connection and try again.");
    }
    peer = p;
    timeoutTimer = setTimeout(() => {
      if (p !== peer || conn?.open) return;
      if (wasApproved) retryLater("Reconnecting…");
      else fail("Couldn’t reach the screen. Make sure it’s still showing the code — some strict networks block direct connections.");
    }, CONNECT_TIMEOUT_MS);

    p.on("open", () => {
      if (p !== peer) return;
      const c = p.connect(PEER_PREFIX + code, { serialization: "json", reliable: true });
      conn = c;
      c.on("open", () => {
        if (c !== conn) return;
        clearTimeout(timeoutTimer);
        c.send({ t: "hello", k: key, device: deviceName() });
        if (wasApproved) setStatus("live", "Connected");
        requestWakeLock();
      });
      c.on("data", (msg) => {
        if (c !== conn || !msg || typeof msg !== "object") return;
        if (msg.t === "approval") onApproval(msg.status, msg.k);
        else if (msg.t === "state") onState(msg);
      });
      c.on("close", () => c === conn && !leaving && (wasApproved ? retryLater("Screen disconnected") : fail("The screen closed the connection.")));
    });

    p.on("error", (err) => {
      if (p !== peer) return;
      if (err.type === "peer-unavailable") {
        if (wasApproved) retryLater("Waiting for the screen…");
        else fail(`No screen is showing ${formatCode(code)}. Check the number and try again.`);
      } else if (TRANSIENT_PEER_ERRORS.has(err.type)) {
        retryLater("Connection hiccup — retrying…");
      } else {
        console.warn("[slidepad]", err.type, err);
        fail("Something went wrong connecting. Try again.");
      }
    });
  }

  function onApproval(status, sessionKey) {
    if (status === "ok") {
      wasApproved = true;
      if (typeof sessionKey === "string" && /^[0-9a-f]{24}$/.test(sessionKey) && sessionKey !== key) {
        key = sessionKey;
        const url = new URL(location.href);
        url.searchParams.set("k", key);
        history.replaceState(null, "", url);
      }
      tries = 0;
      haptic(14);
      setStatus("live", "Connected");
    } else if (status === "pending") {
      setStatus("waiting", "Waiting for approval", `<p class="overlay-title">Check the computer</p><p>Click <b>Allow</b> on its screen to let this phone in.</p>`);
    } else if (status === "denied") {
      leaving = true;
      fail("The screen declined this phone.");
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
    if (document.visibilityState !== "visible" || !code || leaving) return;
    if (conn?.open) requestWakeLock();
    else if ($("#remote")) { tries = 0; connect(); }
  });

  // ── Boot ─────────────────────────────────────────────────────────────────
  const initial = (params.get("join") ?? "").replace(/\D/g, "");
  const initialKey = params.get("k");
  if (initial.length === 6) join(initial, /^[0-9a-f]{24}$/.test(initialKey ?? "") ? initialKey : null);
  else renderJoin();
}
