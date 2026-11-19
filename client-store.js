import { readSession, validDate } from "./ems-sessions.js";
import { hasSessionData, readCycle, readTrainingDetails } from "./ems-training.js";
import { localTransaction, deleteIndexedRecords, removeFastDraft, removeFastDrafts } from "./ems-storage.js";

export const statuses = Object.freeze(["Activo", "En pausa", "Baja"]);
export const goals = Object.freeze([
  "Perder grasa",
  "Ganar músculo",
  "Ganar fuerza",
  "Recomposición corporal",
  "Mejorar forma física",
  "Otro",
]);

const backupFormat = "impulsafit-clientes-ems";
function transaction(mode, work, extra = []) {
  return localTransaction(["clients", ...extra], mode, (stores, done, abort) => work(stores.clients, done, abort, stores));
}

export function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return [now.getFullYear(), month, day].join("-");
}

export function clientCode(id) {
  return "EMS-" + String(id).padStart(4, "0");
}

export function readFields(values) {
  const { name, phone, status, goal = "", notes = "" } = values;
  if (typeof name !== "string" || !name.trim() || name.length > 100) {
    throw new Error("Introduce un nombre de hasta 100 caracteres.");
  }
  if (typeof phone !== "string" || !/\d/.test(phone) || phone.length > 50) {
    throw new Error("Introduce un número de móvil.");
  }
  if (!statuses.includes(status) || (goal !== "" && !goals.includes(goal))) {
    throw new Error("Elige un estado y un objetivo de los desplegables.");
  }
  if (typeof notes !== "string" || notes.length > 2000) {
    throw new Error("Las notas admiten hasta 2.000 caracteres.");
  }
  return { name: name.trim(), phone: phone.trim(), status, goal, notes: notes.trim() };
}

export function listClients() {
  return transaction("readonly", (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => setResult(request.result);
  });
}

export function saveClient(values, previous) {
  const fields = readFields(values);
  const revision = crypto.randomUUID();
  return transaction("readwrite", (store, setResult, abort) => {
    if (!previous) {
      const request = store.add({ ...fields, joinedOn: today(), revision });
      request.onsuccess = () => setResult(request.result);
      return;
    }

    const request = store.get(previous.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || current.revision !== previous.revision) {
        abort(new Error("La ficha cambió desde que la abriste. Vuelve al listado y ábrela de nuevo."));
        return;
      }
      store.put({ ...current, ...fields, revision });
      setResult(current.id);
    };
  });
}

export async function deleteClient(previous) {
  const result = await transaction("readwrite", (store, setResult, abort, stores) => {
    const request = store.get(previous.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || current.revision !== previous.revision) {
        abort(new Error("La ficha cambió desde que la abriste. Vuelve al listado y ábrela de nuevo antes de eliminar."));
        return;
      }
      const sessions = current.emsSessions ?? [];
      const before = previous.emsSessions ?? [];
      if (sessions.length !== before.length || sessions.some((item, index) =>
        item.id !== before[index].id || item.revision !== before[index].revision)) {
        abort(new Error("Las sesiones del cliente cambiaron. Vuelve al listado y ábrelo de nuevo antes de eliminar."));
        return;
      }
      store.delete(previous.id);
      for (const name of ["captures", "photos", "drafts"]) deleteIndexedRecords(stores[name], "clientId", previous.id);
      setResult(previous.id);
    };
  }, ["captures", "photos", "drafts"]);
  removeFastDrafts(previous.id);
  return result;
}

export function saveEmsSession(fields, client, previous) {
  const details = readTrainingDetails(fields);
  const session = {
    ...readSession({ ...fields, routine: details.routine }, { allowEmpty: true }),
    ...details,
    id: previous?.id ?? fields.id ?? crypto.randomUUID(),
    revision: crypto.randomUUID(),
  };
  if (typeof session.id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(session.id)) throw new Error("Identificador de sesión inválido.");
  if (!previous && !hasSessionData(session)) throw new Error("Anota valores, confirma cargas o registra una valoración para guardar la sesión.");
  return transaction("readwrite", (store, setResult, abort) => {
    const request = store.get(client.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || current.revision !== client.revision) {
        abort(new Error("La ficha cambió desde que la abriste. Vuelve al listado y ábrela de nuevo."));
        return;
      }
      const sessions = current.emsSessions ?? [];
      if (session.cycleId) {
        const cycle = current.trainingCycles?.find((item) => item.id === session.cycleId);
        if (!cycle || JSON.stringify(cycle.routine) !== JSON.stringify(session.routine)) {
          abort(new Error("El ciclo de la sesión cambió. Vuelve a abrir el cliente."));
          return;
        }
      }
      const index = sessions.findIndex((stored) => stored.id === session.id);
      if (!previous && index >= 0) { abort(new Error("Esta sesión ya se guardó desde otra ventana. Ábrela de nuevo; tu borrador se conserva.")); return; }
      if (previous && sessions[index]?.revision !== previous.revision) {
        abort(new Error("La sesión cambió desde que la abriste. Vuelve a abrirla antes de editar."));
        return;
      }
      const updated = [...sessions];
      if (previous && !hasSessionData(session)) updated.splice(index, 1);
      else if (previous) updated[index] = session;
      else updated.push(session);
      const record = { ...current, emsSessions: updated };
      store.put(record);
      setResult(record);
    };
  });
}

export function saveTrainingCycle(fields, client) {
  const cycle = readCycle({ ...fields, id: crypto.randomUUID() });
  return transaction("readwrite", (store, setResult, abort) => {
    const request = store.get(client.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || current.revision !== client.revision) {
        abort(new Error("La ficha cambió. Vuelve al listado y abre el cliente de nuevo."));
        return;
      }
      const record = { ...current, trainingCycles: [...(current.trainingCycles ?? []), cycle], activeCycleId: cycle.id, revision: crypto.randomUUID() };
      store.put(record);
      setResult(record);
    };
  });
}

export async function deleteEmsSession(client, session) {
  const result = await transaction("readwrite", (store, setResult, abort, stores) => {
    const request = store.get(client.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || current.revision !== client.revision) {
        abort(new Error("La ficha cambió desde que la abriste. Vuelve al listado y ábrela de nuevo."));
        return;
      }
      const sessions = current.emsSessions ?? [];
      const stored = sessions.find((item) => item.id === session.id);
      if (!stored || stored.revision !== session.revision) {
        abort(new Error("La sesión cambió desde que la abriste. Vuelve a abrirla antes de eliminar."));
        return;
      }
      const record = { ...current, emsSessions: sessions.filter((item) => item.id !== session.id) };
      stores.captures.delete(session.id);
      deleteIndexedRecords(stores.photos, "captureId", session.id);
      stores.drafts.delete(client.id + ":" + session.id);
      store.put(record);
      setResult(record);
    };
  }, ["captures", "photos", "drafts"]);
  removeFastDraft(client.id, session.id);
  return result;
}

export async function deleteCaptureSession(client, capture) {
  const result = await transaction("readwrite", (store, done, abort, stores) => {
    const r = store.get(client.id);
    r.onsuccess = () => {
      if (!r.result || r.result.revision !== client.revision || r.result.emsSessions?.some((session) => session.id === capture.id)) { abort(new Error("La ficha o la sesión cambió. Vuelve a abrir el cliente antes de eliminar.")); return; }
      const c = stores.captures.get(capture.id);
      c.onsuccess = () => {
        if (!c.result || c.result.clientId !== client.id || c.result.updatedAt !== capture.updatedAt) { abort(new Error("Las fotos cambiaron. Vuelve a abrir la sesión antes de eliminar.")); return; }
        stores.captures.delete(capture.id); deleteIndexedRecords(stores.photos, "captureId", capture.id); stores.drafts.delete(client.id + ":" + capture.id); done(r.result);
      };
    };
  }, ["captures", "photos", "drafts"]);
  removeFastDraft(client.id, capture.id);
  return result;
}

export function encodeBackup(clients) {
  const records = clients.map(({ revision, emsSessions = [], ...client }) => ({
    ...client,
    emsSessions: emsSessions.map(({ revision: sessionRevision, ...session }) => session),
  }));
  return JSON.stringify({ format: backupFormat, version: 4, clients: records }, null, 2);
}

function decodeSessions(sessions) {
  if (!Array.isArray(sessions)) throw new Error("La copia contiene un historial EMS inválido.");
  const ids = new Set();
  return sessions.map((session) => {
    if (!session || typeof session.id !== "string" || !session.id || ids.has(session.id)) {
      throw new Error("La copia contiene sesiones EMS inválidas o repetidas.");
    }
    ids.add(session.id);
    const details = readTrainingDetails(session);
    return { ...readSession({ ...session, routine: details.routine }, { allowEmpty: true }), ...details, id: session.id };
  });
}

export function decodeBackup(contents) {
  const backup = JSON.parse(contents);
  if (backup?.format !== backupFormat || ![1, 2, 3, 4, 5].includes(backup.version) || !Array.isArray(backup.clients)) {
    throw new Error("Selecciona una copia de seguridad de Clientes EMS.");
  }
  const ids = new Set();
  return backup.clients.map((client) => {
    if (!client || !Number.isSafeInteger(client.id) || client.id < 1 || ids.has(client.id)) {
      throw new Error("La copia contiene códigos de cliente inválidos o repetidos.");
    }
    const { id, joinedOn } = client;
    if (!validDate(joinedOn)) {
      throw new Error("La copia contiene una fecha de alta inválida.");
    }
    ids.add(id);
    const emsSessions = backup.version >= 2 ? decodeSessions(client.emsSessions) : [];
    const trainingCycles = client.trainingCycles ?? [];
    if (!Array.isArray(trainingCycles) || trainingCycles.length > 500) throw new Error("La copia contiene ciclos inválidos.");
    const cycles = trainingCycles.map(readCycle), cycleIds = new Set(cycles.map((cycle) => cycle.id));
    if (cycleIds.size !== cycles.length || client.activeCycleId && !cycleIds.has(client.activeCycleId)) throw new Error("La copia contiene ciclos repetidos o una referencia inválida.");
    for (const session of emsSessions) if (session.cycleId) {
      const cycle = cycles.find((item) => item.id === session.cycleId);
      if (!cycle || JSON.stringify(cycle.routine) !== JSON.stringify(session.routine)) throw new Error("La sesión no coincide con la rutina de su ciclo.");
    }
    return { ...readFields(client), id, joinedOn, emsSessions, trainingCycles: cycles, ...(client.activeCycleId ? { activeCycleId: client.activeCycleId } : {}) };
  });
}

export async function restoreBackup(clients, workspace = { drafts: [], captures: [], photos: [] }) {
  await transaction("readwrite", (store, done, abort, stores) => {
    store.clear();
    const revisions = new Map();
    for (const client of clients) {
      const emsSessions = (client.emsSessions ?? []).map((session) => ({
        ...session,
        revision: crypto.randomUUID(),
      }));
      for (const session of emsSessions) revisions.set(client.id + ":" + session.id, session.revision);
      store.add({ ...client, revision: crypto.randomUUID(), emsSessions });
    }
    for (const name of ["drafts", "captures", "photos"]) {
      stores[name].clear();
      for (const record of workspace[name]) stores[name].put(name === "drafts" && record.baseRevision && !record.conflicted ? { ...record, baseRevision: revisions.get(record.id) ?? record.baseRevision } : record);
    }
  }, ["drafts", "captures", "photos"]);
  removeFastDrafts();
}
