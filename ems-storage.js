export const storeNames = { clients: "clientes", drafts: "borradores", captures: "capturas", photos: "fotos" };
const path = new URL("./", import.meta.url).pathname;
const databaseName = "impulsafit-clientes-ems:" + path;
export const draftPrefix = "registro-ems:borrador:" + path + ":";
export const resumeKey = "registro-ems:reanudar:" + path;
let connectionPromise;

export function database() {
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeNames.clients)) db.createObjectStore(storeNames.clients, { keyPath: "id", autoIncrement: true });
      for (const name of ["drafts", "captures", "photos"]) {
        if (db.objectStoreNames.contains(storeNames[name])) continue;
        const store = db.createObjectStore(storeNames[name], { keyPath: "id" });
        store.createIndex("clientId", "clientId");
        if (name === "photos") store.createIndex("captureId", "captureId");
      }
    };
    request.onblocked = () => { abandoned = true; reject(new Error("Cierra las otras ventanas de Registro EMS y vuelve a abrir la app para completar la actualización.")); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      db.onversionchange = () => { db.close(); connectionPromise = undefined; };
      resolve(db);
    };
  }).catch((error) => { connectionPromise = undefined; throw error; });
  return connectionPromise;
}

export async function localTransaction(names, mode, work) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names.map((name) => storeNames[name]), mode);
    let result, failure;
    const stores = Object.fromEntries(names.map((name) => [name, tx.objectStore(storeNames[name])]));
    const abort = (error) => { failure = error; tx.abort(); };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("No se pudo guardar en este dispositivo."));
    try { work(stores, (value) => { result = value; }, abort); } catch (error) { abort(error); }
  });
}

export function removeFastDrafts(clientId) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(draftPrefix + (clientId == null ? "" : clientId + ":"))) localStorage.removeItem(key);
    }
    const resume = JSON.parse(localStorage.getItem(resumeKey) ?? "null");
    if (clientId == null || resume?.clientId === clientId) localStorage.removeItem(resumeKey);
  } catch { /* The database remains the durable source when fast storage is unavailable. */ }
}

export function removeFastDraft(clientId, sessionId) {
  const id = clientId + ":" + sessionId;
  try {
    localStorage.removeItem(draftPrefix + id);
    if (JSON.parse(localStorage.getItem(resumeKey) ?? "null")?.id === id) localStorage.removeItem(resumeKey);
  } catch { /* No fast copy. */ }
}

export function deleteIndexedRecords(store, index, value) {
  const request = store.index(index).openKeyCursor(IDBKeyRange.only(value));
  request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
}
