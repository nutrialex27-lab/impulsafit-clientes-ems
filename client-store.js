export const statuses = Object.freeze(["Activo", "En pausa", "Baja"]);
export const goals = Object.freeze([
  "Perder grasa",
  "Ganar músculo",
  "Ganar fuerza",
  "Recomposición corporal",
  "Mejorar forma física",
  "Otro",
]);

const storeName = "clientes";
const databaseName = "impulsafit-clientes-ems:" + new URL("./", import.meta.url).pathname;
const backupFormat = "impulsafit-clientes-ems";
let openConnection;

function database() {
  if (openConnection) return openConnection;

  openConnection = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const connection = request.result;
      connection.onversionchange = () => {
        connection.close();
        openConnection = undefined;
      };
      resolve(connection);
    };
  }).catch((error) => {
    openConnection = undefined;
    throw error;
  });
  return openConnection;
}

async function transaction(mode, work) {
  const connection = await database();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(storeName, mode);
    let result;
    let failure;
    const setResult = (value) => { result = value; };
    const abort = (error) => {
      failure = error;
      tx.abort();
    };

    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("No se pudo guardar el cambio."));
    try {
      work(tx.objectStore(storeName), setResult, abort);
    } catch (error) {
      abort(error);
    }
  });
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

export function encodeBackup(clients) {
  const records = clients.map(({ revision, ...client }) => client);
  return JSON.stringify({ format: backupFormat, version: 1, clients: records }, null, 2);
}

export function decodeBackup(contents) {
  const backup = JSON.parse(contents);
  if (backup?.format !== backupFormat || backup.version !== 1 || !Array.isArray(backup.clients)) {
    throw new Error("Selecciona una copia de seguridad de Clientes EMS.");
  }
  const ids = new Set();
  return backup.clients.map((client) => {
    if (!client || !Number.isSafeInteger(client.id) || client.id < 1 || ids.has(client.id)) {
      throw new Error("La copia contiene códigos de cliente inválidos o repetidos.");
    }
    const { id, joinedOn } = client;
    if (typeof joinedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(joinedOn)) {
      throw new Error("La copia contiene una fecha de alta inválida.");
    }
    const joinedDate = new Date(joinedOn + "T00:00:00Z");
    if (!Number.isFinite(joinedDate.getTime()) || joinedDate.toISOString().slice(0, 10) !== joinedOn) {
      throw new Error("La copia contiene una fecha de alta inválida.");
    }
    ids.add(id);
    return { ...readFields(client), id, joinedOn };
  });
}

export function restoreBackup(clients) {
  return transaction("readwrite", (store) => {
    store.clear();
    for (const client of clients) {
      store.add({ ...client, revision: crypto.randomUUID() });
    }
  });
}
