import { draftPrefix, resumeKey, localTransaction } from "./ems-storage.js";
import { blockDefinitions, channels, validDate } from "./ems-sessions.js";
import { readRoutine } from "./ems-training.js";

export const draftId = (clientId, sessionId) => clientId + ":" + sessionId;
const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const clone = (value) => structuredClone(value);

export function activeWork(value) {
  try {
    if (arguments.length) {
      if (value) localStorage.setItem(resumeKey, JSON.stringify(value)); else localStorage.removeItem(resumeKey);
      return value;
    }
    return JSON.parse(localStorage.getItem(resumeKey) ?? "null");
  } catch { return null; }
}

// Write a small synchronous copy on every edit, before the OS can suspend the page.
// IndexedDB keeps another copy and stores images separately from these small records.
export function saveLocalDraft(record) {
  const snapshot = clone({ ...record, updatedAt: Date.now() });
  let fast = false;
  try { localStorage.setItem(draftPrefix + snapshot.id, JSON.stringify(snapshot)); fast = true; } catch { /* Try IndexedDB too. */ }
  activeWork({ mode: "editor", clientId: snapshot.clientId, id: snapshot.id });
  return localTransaction(["clients", "drafts"], "readwrite", (stores, done, abort) => {
    const request = stores.clients.get(snapshot.clientId);
    request.onsuccess = () => {
      if (!request.result) { const error = new Error("La ficha ya no existe. El borrador no se ha aplicado."); error.code = "MISSING_CLIENT"; abort(error); return; }
      stores.drafts.put(snapshot); done(snapshot);
    };
  }).catch((error) => {
    if (error.code === "MISSING_CLIENT") { try { localStorage.removeItem(draftPrefix + snapshot.id); } catch {} throw error; }
    if (fast) return { ...snapshot, fastOnly: true }; throw error;
  });
}

export async function readLocalDraft(id) {
  let fast;
  try { fast = JSON.parse(localStorage.getItem(draftPrefix + id) ?? "null"); } catch { /* Use the database. */ }
  const stored = await localTransaction(["drafts"], "readonly", ({ drafts }, done) => { const r = drafts.get(id); r.onsuccess = () => done(r.result); }).catch((error) => { if (fast) return null; throw error; });
  return fast && (!stored || fast.updatedAt >= stored.updatedAt) ? fast : stored;
}

export async function listLocalDrafts(clientId) {
  const stored = await localTransaction(["drafts"], "readonly", ({ drafts }, done) => { const r = drafts.index("clientId").getAll(clientId); r.onsuccess = () => done(r.result); });
  const records = new Map(stored.map((record) => [record.id, record]));
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(draftPrefix + clientId + ":")) continue;
      const fast = JSON.parse(localStorage.getItem(key));
      if (!records.has(fast.id) || records.get(fast.id).updatedAt <= fast.updatedAt) records.set(fast.id, fast);
    }
  } catch { /* Records already saved in IndexedDB are still available. */ }
  return [...records.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function removeLocalDraft(id) {
  await localTransaction(["drafts"], "readwrite", ({ drafts }) => drafts.delete(id));
  try { localStorage.removeItem(draftPrefix + id); } catch { /* No fast copy. */ }
  if (activeWork()?.id === id) activeWork(null);
}

export function listCaptures(clientId) {
  return localTransaction(["captures"], "readonly", ({ captures }, done) => { const r = captures.index("clientId").getAll(clientId); r.onsuccess = () => done(r.result.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)); });
}

export function capturePhotos(captureId) {
  return localTransaction(["photos"], "readonly", ({ photos }, done) => { const r = photos.index("captureId").getAll(captureId); r.onsuccess = () => done(r.result.sort((a, b) => a.position - b.position)); });
}

export function getLocalPhoto(id) {
  return localTransaction(["photos"], "readonly", ({ photos }, done) => { const r = photos.get(id); r.onsuccess = () => done(r.result); });
}

export function appendCapturePhoto(client, capture, file) {
  if (!(file instanceof Blob) || !file.size || file.size > 35_000_000 || !/^image\//.test(file.type)) throw new Error("Elige una imagen de hasta 35 MB (JPG, PNG o WebP).");
  if (!safeId(capture.id) || !validDate(capture.date)) throw new Error("Revisa la fecha de las fotos.");
  const photo = { id: crypto.randomUUID(), clientId: client.id, captureId: capture.id,
    blob: file, name: file.name ?? "Foto", takenAt: file.lastModified ?? Date.now(), createdAt: Date.now(), reviewed: false };
  return localTransaction(["clients", "captures", "photos"], "readwrite", (stores, done, abort) => {
    const r = stores.clients.get(client.id);
    r.onsuccess = () => {
      if (!r.result) { abort(new Error("La ficha ya no existe. Vuelve al listado de clientes.")); return; }
      const request = stores.captures.get(capture.id);
      request.onsuccess = () => {
        const group = request.result ?? { ...clone(capture), clientId: client.id, createdAt: Date.now(), photoCount: 0, reviewedCount: 0 };
        if (group.clientId !== client.id) { abort(new Error("Las fotos pertenecen a otra ficha.")); return; }
        photo.position = group.photoCount;
        const updated = { ...group, date: capture.date, photoCount: group.photoCount + 1, updatedAt: Date.now() };
        stores.photos.add(photo); stores.captures.put(updated); done({ capture: updated, photo });
      };
    };
  });
}

export function updateCaptureDate(capture, date) {
  if (!validDate(date)) throw new Error("Introduce una fecha válida.");
  return localTransaction(["captures"], "readwrite", ({ captures }, done, abort) => {
    const r = captures.get(capture.id);
    r.onsuccess = () => { if (!r.result || r.result.clientId !== capture.clientId) { abort(new Error("No se encontró la sesión de fotos.")); return; } const value = { ...r.result, date }; captures.put(value); done(value); };
  });
}

export function markPhotoReviewed(photo, block, round) {
  return localTransaction(["photos", "captures"], "readwrite", ({ photos, captures }, done, abort) => {
    const r = photos.get(photo.id);
    r.onsuccess = () => {
      const current = r.result;
      if (!current || current.clientId !== photo.clientId) { abort(new Error("No se encontró la foto. Los valores se han guardado.")); return; }
      const c = captures.get(current.captureId);
      c.onsuccess = () => {
        if (!c.result) { abort(new Error("No se encontró la sesión de fotos. Los valores se han guardado.")); return; }
        photos.put({ ...current, reviewed: true, assignment: { block, round } });
        captures.put({ ...c.result, reviewedCount: c.result.reviewedCount + (current.reviewed ? 0 : 1) }); done(true);
      };
    };
  });
}

const blobData = (blob) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });

export async function exportLocalWork() {
  const result = await localTransaction(["drafts", "captures", "photos"], "readonly", (stores, done) => {
    const data = { drafts: [], captures: [], photos: [] }; let remaining = 3;
    for (const key of Object.keys(data)) { const r = stores[key].getAll(); r.onsuccess = () => { data[key] = r.result; if (!--remaining) done(data); }; }
  });
  // Include the newest synchronous drafts even if a recent database write is pending.
  const clients = new Set(result.drafts.map((item) => item.clientId));
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(draftPrefix)) clients.add(JSON.parse(localStorage.getItem(key)).clientId); } } catch { /* Use database copies. */ }
  result.drafts = (await Promise.all([...clients].map(listLocalDrafts))).flat();
  result.photos = await Promise.all(result.photos.map(async ({ blob, ...photo }) => ({ ...photo, data: await blobData(blob) })));
  return result;
}

export function decodeLocalWork(input, clients) {
  if (input == null) return { drafts: [], captures: [], photos: [] };
  if (!["drafts", "captures", "photos"].every((key) => Array.isArray(input[key]))) throw new Error("La copia de fotos o borradores no es válida.");
  const clientIds = new Set(clients.map((client) => client.id)), ids = new Set();
  const captures = input.captures.map((record) => {
    if (!safeId(record.id) || ids.has(record.id) || !clientIds.has(record.clientId) || !validDate(record.date)) throw new Error("La copia contiene una sesión de fotos inválida.");
    ids.add(record.id);
    const value = { ...record, ...(record.routine ? { routine: readRoutine(record.routine) } : {}), photoCount: 0, reviewedCount: 0 };
    if (value.cycleId && !clients.find((client) => client.id === value.clientId).trainingCycles?.some((cycle) => cycle.id === value.cycleId && JSON.stringify(cycle.routine) === JSON.stringify(value.routine))) throw new Error("Las fotos no coinciden con su ciclo.");
    return value;
  });
  ids.clear();
  const positions = new Set();
  const photos = input.photos.map(({ data, ...photo }) => {
    const capture = captures.find((record) => record.id === photo.captureId && record.clientId === photo.clientId);
    if (!safeId(photo.id) || ids.has(photo.id) || !capture || typeof data !== "string" || data.length > 48_000_000 || !/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(data) || !Number.isSafeInteger(photo.position) || photo.position < 0) throw new Error("La copia contiene una foto inválida.");
    const [header, base64] = data.split(","); const binary = atob(base64), bytes = Uint8Array.from(binary, (letter) => letter.charCodeAt(0));
    if (!bytes.length) throw new Error("La copia contiene una foto vacía.");
    const position = photo.captureId + ":" + photo.position;
    if (positions.has(position)) throw new Error("La copia contiene un orden de fotos repetido.");
    positions.add(position);
    if (photo.assignment && (!blockDefinitions(capture.routine).some(([id]) => id === photo.assignment.block) || !Number.isInteger(photo.assignment.round) || photo.assignment.round < 0 || photo.assignment.round >= 100)) throw new Error("La copia contiene una asignación de foto inválida.");
    ids.add(photo.id); capture.photoCount++; if (photo.reviewed === true) capture.reviewedCount++;
    return { ...photo, blob: new Blob([bytes], { type: header.slice(5, -7) }) };
  });
  ids.clear();
  const drafts = input.drafts.map((record) => {
    if (!record || !clientIds.has(record.clientId) || !safeId(record.sessionId) || record.id !== draftId(record.clientId, record.sessionId) || ids.has(record.id) || !record.payload || record.payload.id !== record.sessionId || !record.payload.blocks || typeof record.payload.blocks !== "object" || Array.isArray(record.payload.blocks) || !Number.isFinite(record.updatedAt) || JSON.stringify(record).length > 2_000_000) throw new Error("La copia contiene un borrador inválido.");
    const result = clone(record);
    if (result.payload.routine) result.payload.routine = readRoutine(result.payload.routine);
    const definitions = blockDefinitions(result.payload.routine), fieldIds = new Set(["master", ...channels.map(([id]) => id)]);
    if (Object.keys(result.payload.blocks).length > 30) throw new Error("El borrador tiene demasiados bloques.");
    for (const [block, readings] of Object.entries(result.payload.blocks)) {
      if (!definitions.some(([id]) => id === block) || !readings || Array.isArray(readings) || typeof readings !== "object") throw new Error("El borrador contiene un bloque inválido.");
      const rounds = readings.rounds ?? [readings];
      if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > 100) throw new Error("El borrador contiene vueltas inválidas.");
      for (const reading of rounds) if (!reading || typeof reading !== "object" || Array.isArray(reading) || Object.entries(reading).some(([id, value]) => !fieldIds.has(id) || value != null && typeof value !== "number" && (typeof value !== "string" || value.length > 128))) throw new Error("El borrador contiene campos inválidos.");
    }
    if (result.selection && (!definitions.some(([id]) => id === result.selection.block) || !Number.isInteger(result.selection.round) || result.selection.round < 0 || result.selection.round >= 100)) throw new Error("El borrador contiene una vuelta seleccionada inválida.");
    if (result.photoIds && (!Array.isArray(result.photoIds) || result.photoIds.some((pair) => !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || !photos.some((photo) => photo.id === pair[1] && photo.clientId === result.clientId)))) throw new Error("El borrador contiene una referencia de foto inválida.");
    ids.add(record.id); return result;
  });
  return { drafts, captures, photos };
}
