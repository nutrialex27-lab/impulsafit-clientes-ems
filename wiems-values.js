import { channels } from "./ems-sessions.js";

const headings = [
  /^(QUAD|CUAD|PIERN)/, /^(HAMSTR|ISQUI|FEMOR)/, /^GLUT/, /^(LUMBAR|LUMB)/,
  /^(LDORS|DORS)/, /^TRAP/, /^ABDOM/, /^(CHEST|PECHO|PECTOR)/, /^(BRAZO|ARM)$/,
  /^EXTRA(1|I|L)?$/,
];

function normalized(text) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function wordsIn(tsv) {
  return (tsv || "").split("\n").flatMap((line) => {
    const [level, , , , , , left, top, width, height, confidence, raw] = line.split("\t");
    const text = raw?.trim();
    if (level !== "5" || !text || Number(confidence) < 0) return [];
    return [{ text, confidence: Number(confidence), x: Number(left) + Number(width) / 2,
      y: Number(top) + Number(height) / 2, width: Number(width), height: Number(height) }];
  });
}

function readingsIn(words, minConfidence = 20) {
  const units = words.filter((word) => /^MM?A$/.test(normalized(word.text)));
  return words.flatMap((original) => {
    let word = original;
    const prefixes = words.filter((other) => {
      const height = Math.max(word.height, other.height);
      const gap = word.x - word.width / 2 - other.x - other.width / 2;
      return /^\d+$/.test(other.text) && gap >= 0 && gap < .5 * height
        && Math.abs(other.y - word.y) < .3 * height;
    });
    if (/^\d/.test(word.text) && prefixes.length === 1) {
      const prefix = prefixes[0];
      const left = prefix.x - prefix.width / 2;
      const right = word.x + word.width / 2;
      word = { ...word, text: prefix.text + word.text, x: (left + right) / 2,
        width: right - left, confidence: Math.min(prefix.confidence, word.confidence) };
    }
    const text = word.text.replace(/^[(["'“]+|[)\]"'”]+$/g, "");
    const match = /^(\d+(?:[.,]\d+)?)(?:\s*(m{1,2}a)[.,]?)?$/i.exec(text);
    if (!match || word.confidence < minConfidence) return [];
    const hasUnit = match[2] || units.some((unit) => {
      const dx = unit.x - word.x;
      const dy = unit.y - word.y;
      const h = Math.max(word.height, unit.height);
      const after = dx > 0 && Math.abs(dy) < .65 * h
        && dx < (word.width + unit.width) / 2 + .7 * h;
      const below = dy > .35 * h && dy < 1.65 * h
        && Math.abs(dx) < Math.max(h, unit.width / 2);
      return after || below;
    });
    if (!hasUnit) return [];
    return [{ ...word, value: Number(match[1].replace(",", ".")) }];
  });
}

function channelLayout(words, width) {
  const labels = words.flatMap((word) => {
    const rank = headings.findIndex((pattern) => pattern.test(normalized(word.text)));
    return rank >= 0 && word.confidence >= 35 ? [{ ...word, rank }] : [];
  });
  let best;
  for (const left of labels) {
    for (const right of labels) {
      const span = right.rank - left.rank;
      if (span < 4) continue;
      const step = (right.x - left.x) / span;
      if (step < width / 50 || step > width / 7) continue;
      const tilt = (right.y - left.y) / (right.x - left.x);
      if (Math.abs(tilt) > .24) continue;
      const x = left.x - step * left.rank;
      const y = left.y + tilt * (x - left.x);
      const matches = new Map();
      for (const label of labels) {
        const dx = Math.abs(label.x - x - label.rank * step);
        const dy = Math.abs(label.y - y - tilt * (label.x - x));
        if (dx < .32 * step && dy < .30 * step) {
          const error = (dx + dy) / step;
          matches.set(label.rank, Math.min(error, matches.get(label.rank) ?? Infinity));
        }
      }
      const count = matches.size;
      if (count < 5) continue;
      const error = [...matches.values()].reduce((sum, value) => sum + value, 0);
      if (!best || count > best.count || (count === best.count && error < best.error)) {
        best = { x, y, step, tilt, count, error };
      }
    }
  }
  return best;
}

function explicitMaster(words, readings, { x, y, step, tilt }) {
  const labels = words.filter((word) => normalized(word.text) === "MASTER"
    && word.x > x + 9.4 * step && Math.abs(word.y - y - tilt * (word.x - x)) < step);
  const near = readings.filter((reading) => reading.confidence >= 45 && labels.some((label) =>
    Math.abs(reading.x - label.x) < .60 * step && Math.abs(reading.y - label.y) < .72 * step));
  return near.length === 1 ? near[0].value : undefined;
}

export function scanWiemsScreen(tsv, width) {
  const words = wordsIn(tsv);
  const layout = channelLayout(words, width);
  if (!layout) return { rows: [] };

  const { x, y, step, tilt } = layout;
  const readings = readingsIn(words);
  const digits = words.filter((word) => /^\d+(?:[.,]\d+)?$/.test(word.text)
    && word.confidence >= 70 && word.height >= .10 * step && word.height <= .40 * step
    && !readings.some((reading) => Math.abs(reading.x - word.x) < .2 * step
      && Math.abs(reading.y - word.y) < .2 * step))
    .map((word) => ({ ...word, value: Number(word.text.replace(",", ".")) }));
  const flattened = [...readings, ...digits].map((reading) => ({
    ...reading, column: (reading.x - x) / step, level: reading.y - tilt * (reading.x - x),
  }));
  const channelReadings = flattened.filter((reading) =>
    reading.column >= -.42 && reading.column <= 9.42 && reading.level > y + .10 * step
    && Math.abs(reading.column - Math.round(reading.column)) < .42
  ).sort((a, b) => a.level - b.level);

  const candidates = [];
  for (const reading of channelReadings) {
    let row = candidates.at(-1);
    if (!row || Math.abs(reading.level - row.y) > .32 * step) {
      row = { y: reading.level, channels: new Map() };
      candidates.push(row);
    }
    const rank = Math.round(reading.column);
    if ((row.channels.get(rank)?.confidence ?? 0) < reading.confidence) {
      row.channels.set(rank, reading);
    }
  }
  const rows = candidates.filter((row) => row.channels.size >= 3).map((row) => {
    const masters = flattened.filter((reading) => reading.confidence >= 45
      && Math.abs(reading.column - 10) < .56 && reading.level >= row.y - .14 * step
      && reading.level < row.y + .64 * step);
    return {
      y: row.y,
      reads: row.channels,
      master: masters.length === 1 ? masters[0].value : undefined,
    };
  });
  return { layout, rows, globalMaster: explicitMaster(words, readings, layout) };
}

export function readMilliampCrop(tsv, priorValue, digitsTsv) {
  const readings = readingsIn(wordsIn(tsv), 0);
  const digits = wordsIn(digitsTsv);
  const digit = digits.length === 1 && digits[0].confidence >= 45
    && /^\d+(?:[.,]\d+)?$/.test(digits[0].text)
    ? Number(digits[0].text.replace(",", ".")) : undefined;
  const confirmed = readings.filter((entry) => entry.confidence >= 50
    || (entry.value === priorValue && entry.confidence >= 28) || entry.value === digit);
  const values = new Set(confirmed.map(({ value }) => value));
  if (!values.size && digit !== undefined && digit === priorValue) return digit;
  return values.size === 1 ? values.values().next().value : undefined;
}

export function channelValues(readings) {
  return Object.fromEntries([...readings].flatMap(([rank, reading]) =>
    reading.confidence >= 50 ? [[channels[rank][0], reading.value]] : []
  ));
}
