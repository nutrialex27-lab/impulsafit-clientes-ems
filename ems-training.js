import { blocks, channels, hasRounds, roundDefault, validDate } from "./ems-sessions.js";

export const routineInbox = "impulsafit-registro-routine-v1";
export const loadUnits = { total: "kg totales", each: "kg por mancuerna", body: "Peso corporal", band: "Banda", other: "Otra carga" };
export const perceptions = { low: "Por debajo del objetivo", adequate: "Adecuada", high: "Excesiva" };
const phaseIds = new Set(blocks.map(([id]) => id));
const fields = new Set(["master", ...channels.map(([id]) => id)]);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value, maximum, label, required = false) => {
  if (typeof value !== "string" || value.length > maximum || required && !value.trim()) throw new Error(label + " no es válido.");
  return value.trim();
};
const number = (value, min, max, label, integer = false) => {
  if (typeof value === "string" && /^\d+(?:[.,]\d+)?$/.test(value.trim())) value = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(label + " no es válido.");
  return value;
};
const choice = (value, choices, label, fallback = "") => {
  value ??= fallback;
  if (![fallback, ...choices].includes(value)) throw new Error(label + " no es válido.");
  return value;
};
export const recordId = (block, round) => block + ":" + round;
export const hasReading = (reading) => Object.keys(reading ?? {}).some((id) => fields.has(id) && reading[id] !== "" && reading[id] != null);
export const valuesFor = (session, block, round = 0) => {
  const values = session?.blocks?.[block];
  return values?.rounds ? values.rounds[round] ?? {} : round === 0 ? values ?? {} : {};
};

export function readRoutine(input) {
  if (!object(input) || !Array.isArray(input.blocks) || input.blocks.length < 1 || input.blocks.length > 30) throw new Error("Elige una rutina con entre 1 y 30 bloques.");
  const ids = new Set(), exerciseIds = new Set();
  const result = {
    id: text(input.id, 100, "Identificador de rutina", true),
    title: text(input.title, 140, "Nombre de rutina", true),
    profile: text(input.profile ?? "", 30, "Perfil"),
    kind: choice(input.kind, ["metabolic", "hypertrophy"], "Programa", "metabolic"),
    blocks: input.blocks.map((block) => {
      if (!object(block) || !phaseIds.has(block.phase) || !new RegExp("^" + block.phase + "(?:-(?:[2-9]|[1-9][0-9]+))?$").test(block.id) || ids.has(block.id)) throw new Error("La rutina contiene bloques inválidos o repetidos.");
      ids.add(block.id);
      if (!Array.isArray(block.exercises) || block.exercises.length < 1 || block.exercises.length > 12) throw new Error("Cada bloque necesita entre 1 y 12 ejercicios.");
      const result = { id: block.id, phase: block.phase, name: text(block.name, 140, "Nombre de bloque", true),
        rounds: hasRounds(block.id) ? number(block.rounds, 1, 100, "Vueltas", true) : 1,
        seconds: number(block.seconds, 1, 7200, "Duración", true),
        on: number(block.on, 0, 7200, "Tiempo ON"), off: number(block.off, 0, 7200, "Tiempo OFF"),
        ems: block.ems !== false,
        program: text(block.program ?? "", 140, "Programa EMS"),
        sequence: text(block.sequence ?? "", 30, "Organización"),
        exercises: block.exercises.map((exercise) => {
          if (!object(exercise) || typeof exercise.id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(exercise.id) || exerciseIds.has(exercise.id)) throw new Error("La rutina contiene ejercicios inválidos o repetidos.");
          exerciseIds.add(exercise.id);
          return { id: exercise.id, name: text(exercise.name, 180, "Ejercicio", true) };
        }) };
      for (const key of ["hz", "rampUp", "rampDown"]) if (block[key] != null) result[key] = number(block[key], 0, key === "hz" ? 200 : 60, key);
      if (block.restSeconds != null) result.restSeconds = number(block.restSeconds, 0, 7200, "Pausa entre series");
      if (block.plannedRounds != null) result.plannedRounds = number(block.plannedRounds, 1, 100, "Vueltas de la rutina", true);
      if (block.pulseWidths != null) {
        if (!Array.isArray(block.pulseWidths) || block.pulseWidths.length > 12) throw new Error("Ancho de pulso inválido.");
        result.pulseWidths = block.pulseWidths.map((value) => number(value, 0, 2000, "Ancho de pulso"));
      }
      return result;
    }),
  };
  return result;
}

export function decodeRoutine(contents) {
  const payload = typeof contents === "string" ? JSON.parse(contents) : contents;
  if (payload?.format !== "registro-ems-routine" || payload.version !== 1) throw new Error("Selecciona una rutina exportada desde Impulsagen para Registro EMS.");
  return readRoutine(payload.routine);
}

export function receivedRoutine() {
  try { const value = localStorage.getItem(routineInbox); return value ? decodeRoutine(value) : null; } catch { return null; }
}

export function consumeReceivedRoutine(id) {
  // Do not discard a newer routine that arrived while this one was being assigned.
  if (receivedRoutine()?.id !== id) return false;
  localStorage.removeItem(routineInbox);
  window.dispatchEvent(new Event("ems-routine-assigned"));
  return true;
}

export function readCycle(input) {
  if (!object(input) || !validDate(input.startDate)) throw new Error("Introduce una fecha válida para iniciar el ciclo.");
  return { id: text(input.id, 100, "Identificador de ciclo", true), startDate: input.startDate,
    frequency: number(input.frequency, 1, 2, "Sesiones por semana", true),
    experience: choice(input.experience, ["adaptation", "adapted"], "Experiencia EMS"),
    routine: readRoutine(input.routine) };
}

export function cycleEnd(cycle) {
  const date = new Date(cycle.startDate + "T12:00:00Z"); date.setUTCDate(date.getUTCDate() + 27);
  return date.toISOString().slice(0, 10);
}

export function readTrainingDetails(input) {
  const result = {};
  if (input.routine != null) result.routine = readRoutine(input.routine);
  if (input.cycleId != null) result.cycleId = text(input.cycleId, 100, "Ciclo", true);
  if (input.cycleId && !result.routine) throw new Error("La sesión del ciclo necesita su rutina guardada.");
  if (input.followup == null) return result;
  const data = input.followup;
  if (!object(data)) throw new Error("El seguimiento de la sesión no es válido.");
  for (const key of ["loads", "feedback", "sources"]) if (data[key] != null && !object(data[key])) throw new Error("El seguimiento contiene un apartado inválido.");
  const blockIds = new Set((result.routine?.blocks ?? blocks.map(([id]) => ({ id }))).map((block) => block.id));
  const exercises = new Set(result.routine?.blocks.flatMap((block) => block.exercises.map((exercise) => exercise.id)) ?? []);
  const followup = { recovery: choice(data.recovery, ["good", "tired", "discomfort"], "Recuperación"),
    notes: text(data.notes ?? "", 2000, "Notas"), completed: data.completed === true,
    loads: {}, feedback: {}, sources: {} };
  for (const [id, load] of Object.entries(data.loads ?? {})) {
    if (!exercises.has(id) || !object(load)) throw new Error("La carga no corresponde a un ejercicio de esta rutina.");
    const unit = choice(load.unit, Object.keys(loadUnits), "Unidad de carga", "total");
    const reading = { unit, note: text(load.note ?? "", 150, "Detalle de carga"), confirmed: load.confirmed === true };
    if (load.kg != null && load.kg !== "") reading.kg = number(load.kg, 0, 1000, "Carga en kg");
    if (["total", "each"].includes(unit) && reading.kg == null || ["band", "other"].includes(unit) && !reading.note) reading.confirmed = false;
    followup.loads[id] = reading;
  }
  for (const [id, feedback] of Object.entries(data.feedback ?? {})) {
    if (!blockIds.has(id) || !object(feedback)) throw new Error("La valoración del bloque no es válida.");
    const reading = { perception: choice(feedback.perception, Object.keys(perceptions), "Percepción"),
      technique: choice(feedback.technique, ["good", "limited"], "Ejecución"), zones: {} };
    if (feedback.sensation != null && feedback.sensation !== "") reading.sensation = number(feedback.sensation, 0, 10, "Sensación EMS");
    for (const [zone, value] of Object.entries(feedback.zones ?? {})) {
      if (!channels.some(([id]) => id === zone)) throw new Error("Zona de valoración no válida.");
      const perception = choice(value, Object.keys(perceptions), "Percepción por zona");
      if (perception) reading.zones[zone] = perception;
    }
    followup.feedback[id] = reading;
  }
  for (const [key, source] of Object.entries(data.sources ?? {})) {
    const [block, rawRound] = key.split(":");
    if (!blockIds.has(block) || !/^\d+$/.test(rawRound) || Number(rawRound) >= 100 || key !== recordId(block, Number(rawRound)) || !object(source)) throw new Error("Origen del registro inválido.");
    followup.sources[key] = { method: choice(source.method, ["manual", "photo", "confirmed"], "Origen", "manual"),
      reviewed: source.reviewed === true, reference: text(source.reference ?? "", 180, "Referencia") };
  }
  result.followup = followup;
  return result;
}

export function hasSessionData(session) {
  return Object.keys(session.blocks ?? {}).length > 0
    || Object.values(session.followup?.loads ?? {}).some((load) => load.confirmed)
    || Object.values(session.followup?.feedback ?? {}).some((entry) => entry.perception || entry.technique || entry.sensation != null)
    || Boolean(session.followup?.notes?.trim());
}

export function compareKey(session, blockId, round = 0) {
  const block = session.routine?.blocks.find((block) => block.id === blockId);
  // Legacy readings have no verified program snapshot and never mix with cycle data.
  const actualRounds = session.blocks?.[blockId]?.rounds?.length ?? block?.rounds ?? roundDefault(blockId);
  return JSON.stringify([session.cycleId ?? "legacy", block ?? null, blockId, actualRounds, round]);
}

export function previousSession(sessions, current, blockId, round = 0) {
  const key = compareKey(current, blockId, round);
  const currentIndex = sessions.findIndex((item) => item.id === current.id);
  return sessions.map((session, index) => ({ session, index })).filter(({ session }) => session.id !== current.id
    && session.date <= current.date && compareKey(session, blockId, round) === key && hasReading(valuesFor(session, blockId, round)))
    .filter(({ session, index }) => currentIndex < 0 || session.date < current.date || index < currentIndex)
    .sort((a, b) => b.session.date.localeCompare(a.session.date) || b.index - a.index)[0]?.session;
}

export function latestLoads(sessions, current) {
  const currentIndex = sessions.findIndex((item) => item.id === current.id);
  return sessions.filter((item, index) => item.id !== current.id && item.cycleId === current.cycleId && item.date <= current.date
    && (currentIndex < 0 || item.date < current.date || index < currentIndex))
    .reverse().sort((a, b) => b.date.localeCompare(a.date)).reduce((loads, item) => {
      for (const [id, load] of Object.entries(item.followup?.loads ?? {})) if (load.confirmed && !loads[id]) loads[id] = { ...load, confirmed: false };
      return loads;
    }, {});
}

export function blockSuggestion(current, previous, blockId, experience = "") {
  const recovery = current.followup?.recovery;
  const now = current.followup?.feedback?.[blockId];
  const before = previous?.followup?.feedback?.[blockId];
  const result = (title, reason, tone = "neutral") => ({ title, reason, tone });
  if (recovery === "discomfort") return result("Detener y valorar molestias", "Aclara el malestar del cliente antes de continuar con la aplicación.", "alert");
  if (recovery === "tired" || now?.technique === "limited" || now?.perception === "high" || Object.values(now?.zones ?? {}).includes("high")) return result("Revisar la exigencia", "La recuperación, la ejecución o la percepción actual no aconsejan progresar.", "review");
  if (!recovery) return result("Comprobar recuperación", "Confirma cómo llega hoy el cliente para orientar este bloque.");
  if (!current.routine || !previous?.routine) return result("Crear una referencia", "Vincula una rutina al ciclo para comprobar que comparas el mismo programa.");
  if (compareKey(current, blockId) !== compareKey(previous, blockId)) return result("Crear una referencia", "Falta una sesión comparable de este ciclo, bloque y programa.");
  if (Object.entries(current.followup?.sources ?? {}).some(([key, source]) => key.startsWith(blockId + ":") && source.method === "photo" && !source.reviewed)
    || Object.entries(previous.followup?.sources ?? {}).some(([key, source]) => key.startsWith(blockId + ":") && source.method === "photo" && !source.reviewed)) return result("Revisar la lectura de la foto", "Hay valores de este bloque pendientes de confirmar.", "review");
  const exercises = current.routine?.blocks.find((block) => block.id === blockId)?.exercises ?? [];
  if (exercises.some(({ id }) => {
    const a = current.followup?.loads?.[id], b = previous.followup?.loads?.[id];
    const amount = (load) => load?.kg == null || load.kg === "" ? null : Number(String(load.kg).replace(",", "."));
    return !a?.confirmed || !b?.confirmed || amount(a) !== amount(b) || a.unit !== b.unit || (a.note ?? "") !== (b.note ?? "");
  })) return result("Comprobar las cargas", "Confirma las cargas de hoy. Si cambiaron, la exigencia del ejercicio también puede variar.");
  if (now?.perception === "adequate" && now.technique === "good") return result("Mantener y observar", "La percepción actual es adecuada y la ejecución está registrada como correcta.");
  if (experience !== "adapted") return result("Revisar adaptación individual", "Este ciclo no está marcado como cliente adaptado. Ajusta el trabajo de forma supervisada.");
  const evaluation = now?.perception ? now : before;
  if (evaluation?.perception === "low" && evaluation.technique === "good") {
    const zones = Object.entries(evaluation.zones ?? {}).filter(([, value]) => value === "low").map(([id]) => channels.find(([key]) => key === id)[1]);
    return result("Valorar un ajuste supervisado", (zones.length ? "Comprobar hoy: " + zones.join(", ") + ". " : "No hay valoración local para señalar un canal. ") + "Revisa la percepción con el cliente; no se calcula una subida automática de mA.", "review");
  }
  return result("Comprobar percepción y ejecución", "Falta valorar este bloque. El historial es una referencia para tu decisión de hoy.");
}

export function formatLoad(load) {
  if (!load) return "Sin registrar";
  if (["total", "each"].includes(load.unit)) return load.kg == null || load.kg === "" ? "Sin registrar" : String(load.kg).replace(".", ",") + " " + loadUnits[load.unit];
  return loadUnits[load.unit] + (load.note ? " · " + load.note : "");
}
