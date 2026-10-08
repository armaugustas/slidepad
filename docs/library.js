// Remembers added presentations (PDF bytes + notes) in IndexedDB so they survive a refresh.
// Every call degrades to a no-op when storage is unavailable (private windows, blocked site data).

const DB = "slidepad";
const STORE = "decks";
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
  });
}

export const library = {
  async all() {
    try { return ((await tx("readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.addedAt - b.addedAt); }
    catch { return []; }
  },
  async put(record) { try { await tx("readwrite", (s) => s.put(record)); } catch {} },
  async remove(id) { try { await tx("readwrite", (s) => s.delete(id)); } catch {} },
};
