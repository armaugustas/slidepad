// Messaging between the screen and phones, relayed through public MQTT brokers over secure WebSockets.
// Direct WebRTC needs a TURN relay on mobile and many Wi-Fi networks, and there is no working free one;
// a WebSocket to a public broker gets through practically anywhere.
//
// The brokers are public, so everything is end-to-end encrypted:
//  • Room key (AES-GCM) from the QR secret: protects broadcasts (slides) and join requests.
//  • Per-phone key (ECDH P-256 → AES-GCM): protects everything between the screen and one phone,
//    so another person in the room can't read or forge an admin's messages.
//  • Typed-code joiners have no secret yet: they knock on a lobby topic with an ECDH public key and,
//    once approved, receive the secret encrypted to that key.
// Both sides connect to several brokers and publish on all of them; receivers drop duplicates by sequence.

const BROKERS = [
  { url: "wss://broker.hivemq.com:8884/mqtt" },
  { url: "wss://public.cloud.shiftr.io", username: "public", password: "public" }, // port 443: passes strict firewalls
  { url: "wss://test.mosquitto.org:8081" },
];
const ROOT = "slidepad/v4";
const BEAT_MS = 4000;
const TIMEOUT_MS = 13000;
const RETRY_MS = 2500;

const te = new TextEncoder();
const td = new TextDecoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const sha256 = (text) => crypto.subtle.digest("SHA-256", te.encode(text));
const PUB_LEN = 65; // raw uncompressed P-256 public key

export const transportSupported = () => !!(window.isSecureContext && crypto.subtle && window.mqtt);

async function roomKeys(secret) {
  const room = hex(await sha256(`slidepad-room:${secret}`)).slice(0, 32);
  const key = await crypto.subtle.importKey("raw", await sha256(`slidepad-key:${secret}`), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { room, key };
}

async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function unseal(key, bytes) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return JSON.parse(td.decode(pt));
  } catch {
    return null; // wrong key, tampered, or not ours
  }
}

async function ecdhPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  return { privateKey: pair.privateKey, pub: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)) };
}

async function sharedKey(privateKey, pubBytes) {
  const pub = await crypto.subtle.importKey("raw", pubBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: pub }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
const asBytes = (payload) => (payload instanceof Uint8Array ? payload : new Uint8Array(payload));
const parseJson = (bytes) => { try { return JSON.parse(td.decode(bytes)); } catch { return null; } };

/** One logical connection over every broker that will have us. */
function createPool({ onMessage, onStatus }) {
  const topics = new Set();
  const clients = BROKERS.map((b) => {
    const c = window.mqtt.connect(b.url, {
      username: b.username,
      password: b.password,
      clientId: `sp_${randomHex(8)}`,
      clean: true,
      keepalive: 30,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
    });
    c.on("connect", () => { if (topics.size) c.subscribe([...topics]); report(); });
    c.on("close", report);
    c.on("offline", report);
    c.on("error", () => {});
    c.on("message", (topic, payload) => onMessage(topic, asBytes(payload)));
    return c;
  });
  let last = "";
  function report() {
    const state = clients.some((c) => c.connected) ? "online" : "offline";
    if (state !== last) { last = state; onStatus(state); }
  }
  return {
    get online() { return clients.some((c) => c.connected); },
    subscribe(...ts) {
      for (const t of ts) topics.add(t);
      for (const c of clients) if (c.connected) c.subscribe(ts);
    },
    publish(topic, payload) {
      for (const c of clients) if (c.connected) c.publish(topic, payload, { qos: 0 });
    },
    end() { for (const c of clients) c.end(true); },
  };
}

// ── Screen (host) ──────────────────────────────────────────────────────────
/**
 * Callbacks:
 *  onStatus("online" | "offline")
 *  onJoin(link, { cid, name, device })  — a phone holding the room secret said hello
 *  onLobby({ cid, name, device })       — a typed-code phone is knocking (answer with lobbyAnswer)
 *  onLobbyGone(cid)                     — it stopped knocking
 * A link is { cid, open, send(msg), close(), onMessage, onClose }.
 */
export async function hostRoom({ code, secret, onStatus, onJoin, onLobby, onLobbyGone }) {
  const { room, key } = await roomKeys(secret);
  const me = await ecdhPair();
  const epoch = randomHex(4);
  const base = `${ROOT}/${room}`;
  const lobbyTopic = `${ROOT}/lobby/${code}`;
  const links = new Map();
  const lobby = new Map();
  const answered = new Map(); // cid -> when we said yes/no, so late knocks don't reopen the prompt
  const seenHellos = new Set();
  let bcastN = 0;
  let bcastQueue = Promise.resolve();

  const pool = createPool({ onStatus, onMessage });
  pool.subscribe(`${base}/hello`, `${base}/up/+`, lobbyTopic);

  function makeLink(cid, k, pub) {
    let n = 0;
    let queue = Promise.resolve();
    const link = {
      cid, pub, key: k, seen: Date.now(), lastN: -1, closed: false, dead: false, onMessage: null, onClose: null,
      get open() { return !link.closed && !link.dead; },
      send(msg) {
        if (link.closed) return;
        const body = { ...msg, _e: epoch, _n: n++ };
        queue = queue.then(async () => pool.publish(`${base}/to/${cid}`, concat(me.pub, await seal(k, body)))).catch(() => {});
      },
      close() {
        link.closed = true;
        if (links.get(cid) === link) links.delete(cid);
      },
    };
    return link;
  }

  async function onMessage(topic, bytes) {
    if (topic === `${base}/hello`) {
      const m = await unseal(key, bytes);
      if (!m || !/^[0-9a-f]{16}$/.test(m.cid ?? "") || typeof m.pub !== "string" || seenHellos.has(m.id)) return;
      seenHellos.add(m.id);
      let link = links.get(m.cid);
      if (!link || link.pub !== m.pub || link.closed) {
        link?.close();
        link = makeLink(m.cid, await sharedKey(me.privateKey, unb64(m.pub)), m.pub);
        links.set(m.cid, link);
      }
      link.seen = Date.now();
      link.dead = false;
      onJoin(link, { cid: m.cid, name: m.name, device: m.device });
    } else if (topic.startsWith(`${base}/up/`)) {
      const link = links.get(topic.slice(base.length + 4));
      if (!link || link.closed) return;
      const m = await unseal(link.key, bytes);
      if (!m || !Number.isInteger(m._n) || m._n <= link.lastN) return;
      link.lastN = m._n;
      link.seen = Date.now();
      if (link.dead) { link.send({ t: "rehello" }); return; } // came back after we gave up on it
      if (m.t === "ping") return;
      if (m.t === "bye") { link.dead = true; link.onClose?.(); return; }
      link.onMessage?.(m);
    } else if (topic === lobbyTopic) {
      const m = parseJson(bytes);
      if (!m || !/^[0-9a-f]{16}$/.test(m.cid ?? "") || typeof m.pub !== "string") return;
      if (Date.now() - (answered.get(m.cid) ?? 0) < 10000) return;
      const known = lobby.get(m.cid);
      if (known && known.pub === m.pub) { known.seen = Date.now(); return; }
      lobby.set(m.cid, { pub: m.pub, seen: Date.now(), key: await sharedKey(me.privateKey, unb64(m.pub)) });
      onLobby({ cid: m.cid, name: m.name, device: m.device });
    }
  }

  const beat = setInterval(() => {
    broadcast({ t: "beat" });
    const now = Date.now();
    for (const link of links.values()) {
      if (!link.closed && !link.dead && now - link.seen > TIMEOUT_MS) { link.dead = true; link.onClose?.(); }
    }
    for (const [cid, entry] of lobby) {
      if (now - entry.seen > TIMEOUT_MS) { lobby.delete(cid); onLobbyGone(cid); }
    }
    if (seenHellos.size > 500) seenHellos.clear();
  }, BEAT_MS);

  function broadcast(msg) {
    const body = { ...msg, _e: epoch, _n: bcastN++ };
    bcastQueue = bcastQueue.then(async () => pool.publish(`${base}/all`, await seal(key, body))).catch(() => {});
  }

  return {
    get online() { return pool.online; },
    broadcast,
    /** answer: "pending" | "allow" | "denied" | "locked" */
    async lobbyAnswer(cid, answer) {
      const entry = lobby.get(cid);
      const topic = `${lobbyTopic}/${cid}`;
      if (answer === "allow" && entry) {
        pool.publish(topic, concat(me.pub, await seal(entry.key, { status: "ok", k: secret })));
      } else {
        pool.publish(topic, te.encode(JSON.stringify({ status: answer })));
      }
      if (answer !== "pending") { lobby.delete(cid); answered.set(cid, Date.now()); }
    },
    stop() {
      clearInterval(beat);
      pool.end();
    },
  };
}

// ── Phone (guest) ──────────────────────────────────────────────────────────
/**
 * Callbacks:
 *  onState("connecting" | "pending" | "live" | "lost")
 *  onKey(secret)         — learned the room secret (typed-code join was approved)
 *  onMessage(msg)        — anything the screen sent us
 *  onFail(reason)        — "notfound" | "unreachable" | "denied" | "locked"
 */
export async function joinRoom({ code, secret, cid, name, device, onState, onKey, onMessage, onFail }) {
  const me = await ecdhPair();
  const pubB64 = b64(me.pub);
  let room = null, key = null, base = "";
  let linkKey = null, linkPub = "";
  let epoch = null, lastBeat = 0, lastAll = -1, lastTo = -1;
  let welcomed = false, ended = false, n = 0, state = "";
  let helloTimer = 0, knockTimer = 0, pingTimer = 0, watchTimer = 0, giveUpTimer = 0;
  let upQueue = Promise.resolve();

  const setState = (s) => { if (s !== state) { state = s; onState(s); } };
  const fail = (reason) => { if (!ended) { api.end(); onFail(reason); } };

  const pool = createPool({
    onStatus: (s) => { if (s === "online" && !welcomed) kick(); },
    onMessage: (topic, bytes) => handle(topic, bytes).catch(() => {}),
  });

  async function handle(topic, bytes) {
    if (ended) return;
    if (topic === `${ROOT}/lobby/${code}/${cid}`) {
      if (bytes.length > PUB_LEN && bytes[0] === 4) {
        const m = await unseal(await sharedKey(me.privateKey, bytes.subarray(0, PUB_LEN)), bytes.subarray(PUB_LEN));
        if (m?.status === "ok" && typeof m.k === "string") { clearInterval(knockTimer); onKey(m.k); await enterRoom(m.k); }
        return;
      }
      const m = parseJson(bytes);
      if (m?.status === "pending") { clearTimeout(giveUpTimer); setState("pending"); }
      else if (m?.status === "denied" || m?.status === "locked") fail(m.status);
      return;
    }
    if (!base) return;
    if (topic === `${base}/all`) {
      const m = await unseal(key, bytes);
      if (!m) return;
      if (m._e !== epoch) {
        // The screen restarted (refresh): start over with it.
        const restarted = epoch !== null;
        epoch = m._e; lastAll = -1; lastTo = -1;
        if (restarted && welcomed) { welcomed = false; linkKey = null; startHello(); }
      }
      if (m._n <= lastAll) return;
      lastAll = m._n;
      lastBeat = Date.now();
      if (welcomed) setState("live");
      if (m.t !== "beat") onMessage(m);
    } else if (topic === `${base}/to/${cid}`) {
      if (bytes.length <= PUB_LEN) return;
      const pub = b64(bytes.subarray(0, PUB_LEN));
      if (pub !== linkPub) { linkKey = await sharedKey(me.privateKey, bytes.subarray(0, PUB_LEN)); linkPub = pub; }
      const m = await unseal(linkKey, bytes.subarray(PUB_LEN));
      if (!m) return;
      if (m._e !== epoch) { epoch = m._e; lastAll = -1; lastTo = -1; }
      if (m._n <= lastTo) return;
      lastTo = m._n;
      lastBeat = Date.now();
      if (m.t === "rehello") { welcomed = false; startHello(); return; }
      if (m.t === "welcome") {
        if (m.status === "ok") { welcomed = true; clearInterval(helloTimer); clearTimeout(giveUpTimer); setState("live"); }
        else if (m.status === "pending") setState("pending");
      }
      onMessage(m);
    }
  }

  function kick() {
    if (key) startHello();
    else startKnock();
  }

  function startKnock() {
    const topic = `${ROOT}/lobby/${code}`;
    pool.subscribe(`${topic}/${cid}`);
    const knock = () => pool.publish(topic, te.encode(JSON.stringify({ cid, name, device, pub: pubB64 })));
    clearInterval(knockTimer);
    knock();
    knockTimer = setInterval(knock, RETRY_MS);
    clearTimeout(giveUpTimer);
    giveUpTimer = setTimeout(() => fail("notfound"), 9000);
  }

  async function enterRoom(s) {
    secret = s;
    ({ room, key } = await roomKeys(s));
    base = `${ROOT}/${room}`;
    pool.subscribe(`${base}/all`, `${base}/to/${cid}`);
    startHello();
  }

  function startHello() {
    if (!base || ended) return;
    const hello = async () => pool.publish(`${base}/hello`, await seal(key, { cid, name, device, pub: pubB64, id: randomHex(6) }));
    clearInterval(helloTimer);
    hello();
    helloTimer = setInterval(hello, RETRY_MS);
    if (!welcomed && state !== "lost") setState("connecting");
    clearTimeout(giveUpTimer);
    giveUpTimer = setTimeout(() => { if (!welcomed && !lastBeat) fail("unreachable"); }, 12000);
  }

  function send(msg) {
    if (!linkKey || ended) return;
    const body = { ...msg, _n: n++ };
    const k = linkKey;
    upQueue = upQueue.then(async () => pool.publish(`${base}/up/${cid}`, await seal(k, body))).catch(() => {});
  }

  pingTimer = setInterval(() => welcomed && send({ t: "ping" }), BEAT_MS);
  watchTimer = setInterval(() => {
    if (welcomed && Date.now() - lastBeat > TIMEOUT_MS) setState("lost");
  }, 1000);

  const api = {
    send,
    /** Re-announce after the phone wakes up, in case the screen gave up on us. */
    refresh() { if (welcomed) send({ t: "ping" }); else kick(); },
    end() {
      if (ended) return;
      if (welcomed) send({ t: "bye" });
      ended = true;
      for (const t of [helloTimer, knockTimer, pingTimer, watchTimer]) clearInterval(t);
      clearTimeout(giveUpTimer);
      setTimeout(() => pool.end(), 300); // let the goodbye go out
    },
  };

  setState("connecting");
  if (secret) await enterRoom(secret);
  else startKnock();
  return api;
}
