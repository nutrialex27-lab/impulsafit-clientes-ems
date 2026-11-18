export const blocks = [
  ["activation", "Activación"],
  ["strength", "Fuerza breve"],
  ["fullBody", "Full body"],
  ["core", "Core"],
  ["metabolic", "Metabólico"],
  ["coolDown", "Vuelta a la calma"],
];

export const channels = [
  ["quads", "Piernas (cuádriceps)"],
  ["hamstrings", "Isquio"],
  ["glutes", "Glúteos"],
  ["lumbar", "Lumbar"],
  ["dorsal", "Dorsal"],
  ["trapezius", "Trapecio"],
  ["abdominals", "Abdomen"],
  ["chest", "Pecho"],
  ["arm", "Brazo"],
  ["extra1", "Extra1"],
];

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function milliampValue(value, block, field) {
  if (value == null || value === "") return undefined;
  let number = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    number = /^\d+(?:[.,]\d+)?$/.test(text) ? Number(text.replace(",", ".")) : NaN;
  }
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(block + " · " + field + " debe ser un número de 0 mA o más.");
  }
  return number;
}

export function readSession({ date, blocks: input }, { allowEmpty = false } = {}) {
  if (!validDate(date)) throw new Error("Introduce una fecha de sesión válida.");
  const recorded = {};
  for (const [blockId, blockLabel] of blocks) {
    const block = input?.[blockId];
    if (!block) continue;
    const values = {};
    for (const [id, label] of [["master", "Máster"], ...channels]) {
      const value = milliampValue(block[id], blockLabel, label);
      if (value !== undefined) values[id] = value;
    }
    if (Object.keys(values).length > 0) recorded[blockId] = values;
  }
  if (!allowEmpty && Object.keys(recorded).length === 0) {
    throw new Error("Anota al menos un valor de máster o de canal para guardar la sesión.");
  }
  return { date, blocks: recorded };
}
