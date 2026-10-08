// Bridge from this page to the optional local helper (127.0.0.1:7421), which presses real keys
// and moves the real mouse. The phone talks to this page; this page talks to the helper.

export const HELPER_URL = "http://127.0.0.1:7421";

/**
 * status: "checking" | "absent" | "permission" (macOS Accessibility not granted yet) | "ready"
 */
export function createHelper(onStatus) {
  let status = "checking";
  let info = null;
  let probeTimer = 0;
  let running = false;
  let inFlight = false;
  let queue = [];
  let move = { dx: 0, dy: 0 };

  const set = (next, nextInfo = info) => {
    info = nextInfo;
    if (next !== status) { status = next; onStatus(status, info); }
  };

  async function probe() {
    clearTimeout(probeTimer);
    if (!running) return;
    try {
      const res = await fetch(`${HELPER_URL}/status`, { cache: "no-store" });
      const data = await res.json();
      set(data.trusted ? "ready" : "permission", data);
    } catch {
      set("absent", null);
    }
    if (running) probeTimer = setTimeout(probe, status === "ready" ? 5000 : 1500);
  }

  // Moves are summed while a request is in flight, so a slow round-trip never builds a backlog.
  async function pump() {
    if (inFlight || status !== "ready") return;
    const batch = queue;
    queue = [];
    if (move.dx || move.dy) {
      batch.unshift({ t: "move", dx: Math.round(move.dx * 10) / 10, dy: Math.round(move.dy * 10) / 10 });
      move = { dx: 0, dy: 0 };
    }
    if (!batch.length) return;
    inFlight = true;
    try {
      const res = await fetch(`${HELPER_URL}/input`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(batch),
      });
      if (res.status === 409) set("permission");
    } catch {
      set("absent", null);
    }
    inFlight = false;
    pump();
  }

  return {
    get status() { return status; },
    get info() { return info; },
    start() {
      if (running) return;
      running = true;
      onStatus(status, info);
      probe();
    },
    stop() {
      running = false;
      clearTimeout(probeTimer);
      queue = [];
      move = { dx: 0, dy: 0 };
    },
    recheck: probe,
    send(cmd) {
      if (status !== "ready") return;
      if (cmd.t === "move") { move.dx += cmd.dx; move.dy += cmd.dy; }
      else queue.push(cmd);
      pump();
    },
  };
}
