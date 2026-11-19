export const blocks = [
  ["activation", "Activación"],
  ["strength", "Fuerza breve"],
  ["fullBody", "Full body"],
  ["core", "Core"],
  ["metabolic", "Metabólico"],
  ["coolDown", "Vuelta a la calma"],
];

// Impulsagen's standard 35-minute session: 12 min full body, 5 min
// core and 5 min metabolic, with 4, 2 and 2 exercises respectively.
export const defaultRoundCounts = Object.freeze({ fullBody: 4, core: 4, metabolic: 3 });
export const hasRounds = (blockId) => Object.hasOwn(defaultRoundCounts, blockId);
export const maxRounds = 100;

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
    const fields = [["master", "Máster"], ...channels];
    if (typeof block !== "object" || Array.isArray(block)) throw new Error(blockLabel + " contiene valores inválidos.");
    let readings;
    if (hasRounds(blockId)) {
      if (block.rounds === undefined) {
        // Existing records become the first round, with no invented values.
        readings = Array.from({ length: defaultRoundCounts[blockId] }, (_, index) => index === 0 ? block : {});
      } else {
        if (!Array.isArray(block.rounds) || block.rounds.length < 1 || block.rounds.length > maxRounds
          || fields.some(([id]) => block[id] != null && block[id] !== "")) {
          throw new Error(blockLabel + " debe contener entre 1 y " + maxRounds + " vueltas, sin valores fuera de ellas.");
        }
        readings = block.rounds;
      }
    } else {
      if (block.rounds !== undefined) throw new Error(blockLabel + " admite una sola toma de valores.");
      readings = [block];
    }
    const values = Array.from(readings, (reading, index) => {
      if (!reading || typeof reading !== "object" || Array.isArray(reading)) {
        throw new Error(blockLabel + " · vuelta " + (index + 1) + " contiene valores inválidos.");
      }
      const result = {};
      const context = hasRounds(blockId) ? blockLabel + " · vuelta " + (index + 1) : blockLabel;
      for (const [id, label] of fields) {
        const value = milliampValue(reading[id], context, label);
        if (value !== undefined) result[id] = value;
      }
      return result;
    });
    if (values.some((reading) => Object.keys(reading).length > 0)) {
      recorded[blockId] = hasRounds(blockId) ? { rounds: values } : values[0];
    }
  }
  if (!allowEmpty && Object.keys(recorded).length === 0) {
    throw new Error("Anota al menos un valor de máster o de canal para guardar la sesión.");
  }
  return { date, blocks: recorded };
}
