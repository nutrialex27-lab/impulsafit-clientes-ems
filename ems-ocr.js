import { channels } from "./ems-sessions.js";
import { readMasterDigits, readMilliampCrop, scanWiemsScreen } from "./wiems-values.js";

const base = new URL("./", import.meta.url);
let scriptReady;

function loadEngine() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!scriptReady) {
    scriptReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("tesseract.min.js", base);
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => {
        script.remove();
        scriptReady = undefined;
        reject(new Error("Conéctate a internet para iniciar el lector de intensidades."));
      };
      document.head.append(script);
    });
  }
  return scriptReady;
}

function frameCanvas(video) {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error("La cámara aún no tiene imagen.");
  }
  const scale = Math.min(3, 2200 / Math.max(videoWidth, videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(videoWidth * scale);
  canvas.height = Math.round(videoHeight * scale);
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingQuality = "high";
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function detailCanvas(frame, degrees = 0, preserveColor = false) {
  const height = Math.min(frame.height, Math.round(frame.width * .86));
  const scale = Math.min(2.4, 2500 / frame.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frame.width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#888";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degrees * Math.PI / 180);
  if (!preserveColor) context.filter = "grayscale(1)";
  context.drawImage(frame, -frame.width * scale / 2, -frame.height * scale / 2,
    frame.width * scale, frame.height * scale);
  return canvas;
}

function valueCrop(frame, layout, row, rank, master = false) {
  const { x, step, tilt } = layout;
  const center = x + (rank + .12) * step;
  const y = row.y + tilt * (center - x);
  const width = (master ? .70 : .90) * step;
  const height = (master ? .65 : .46) * step;
  const top = y + (master ? -.04 * step : -.23 * step);
  const crop = document.createElement("canvas");
  const scale = Math.max(2, 164 / width);
  crop.width = Math.round(width * scale);
  crop.height = Math.round(height * scale);
  const context = crop.getContext("2d", { alpha: false });
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, crop.width, crop.height);
  context.setTransform(scale, -scale * tilt, 0, scale,
    scale * (width / 2 - center), scale * (tilt * center - top));
  context.filter = master ? "grayscale(1) invert(1) contrast(1.25)" : "grayscale(1) contrast(1.25)";
  context.drawImage(frame, 0, 0);
  return crop;
}

function digitsCrop(tile) {
  const crop = document.createElement("canvas");
  crop.width = Math.round(tile.width * .42);
  crop.height = tile.height;
  crop.getContext("2d").drawImage(tile, 0, 0);
  return crop;
}

export function masterBadgeCrop(frame, layout, row) {
  const size = 160;
  const scale = size / layout.step;
  const center = layout.x + (channels.length + .12) * layout.step;
  const top = row.y + layout.tilt * (center - layout.x) - .30 * layout.step;
  const area = document.createElement("canvas");
  area.width = Math.round(1.8 * size);
  area.height = Math.round(1.4 * size);
  const context = area.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, area.width, area.height);
  context.setTransform(scale, -scale * layout.tilt, 0, scale,
    area.width / 2 - scale * center, scale * (layout.tilt * center - top));
  context.drawImage(frame, 0, 0);
  const pixels = context.getImageData(0, 0, area.width, area.height);
  const mask = new Uint8Array(area.width * area.height);
  for (let index = 0; index < mask.length; index++) {
    const offset = index * 4;
    const red = pixels.data[offset];
    const green = pixels.data[offset + 1];
    const blue = pixels.data[offset + 2];
    mask[index] = blue - red >= 8 && green - red >= 3 && red < 210 ? 1 : 0;
  }
  const badges = [];
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const queue = [index];
    mask[index] = 0;
    let left = area.width, right = 0, upper = area.height, bottom = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const point = queue[cursor];
      const x = point % area.width;
      const y = Math.floor(point / area.width);
      left = Math.min(left, x); right = Math.max(right, x);
      upper = Math.min(upper, y); bottom = Math.max(bottom, y);
      for (const next of [x > 0 ? point - 1 : -1, x < area.width - 1 ? point + 1 : -1,
        y > 0 ? point - area.width : -1, y < area.height - 1 ? point + area.width : -1]) {
        if (next >= 0 && mask[next]) { mask[next] = 0; queue.push(next); }
      }
    }
    const width = right - left + 1;
    const height = bottom - upper + 1;
    if (left > 0 && upper > 0 && right < area.width - 1 && bottom < area.height - 1
      && width > .35 * size && width < 1.1 * size && height > .35 * size && height < 1.1 * size
      && width / height > .65 && width / height < 1.5 && queue.length > .10 * size * size) {
      badges.push({ left, upper, width, height });
    }
  }
  if (badges.length !== 1) return undefined;
  const badge = badges[0];
  // Read only the numeral in the blue circle, above its small mA label.
  const left = Math.round(badge.left + .08 * badge.width);
  const upper = Math.round(badge.upper + .10 * badge.height);
  const width = Math.round(.84 * badge.width);
  const height = Math.round(.44 * badge.height);
  const values = [];
  const lightness = (x, y) => {
    const offset = (y * area.width + x) * 4;
    return (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2]) / 3;
  };
  const inside = (x, y) => Math.hypot((x - badge.left - badge.width / 2) / (badge.width / 2),
    (y - badge.upper - badge.height / 2) / (badge.height / 2)) < .90;
  for (let y = upper; y < upper + height; y++) for (let x = left; x < left + width; x++) {
    if (inside(x, y)) values.push(lightness(x, y));
  }
  if (!values.length) return undefined;
  values.sort((a, b) => a - b);
  const dark = values[Math.floor(values.length * .25)];
  const light = values[Math.floor(values.length * .95)];
  if (light - dark < 25) return undefined;
  const threshold = dark + .55 * (light - dark);
  const digits = document.createElement("canvas");
  digits.width = width; digits.height = height;
  const digitsContext = digits.getContext("2d");
  const output = digitsContext.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ink = inside(left + x, upper + y) && lightness(left + x, upper + y) > threshold;
    const offset = (y * width + x) * 4;
    output.data[offset] = output.data[offset + 1] = output.data[offset + 2] = ink ? 0 : 255;
    output.data[offset + 3] = 255;
  }
  digitsContext.putImageData(output, 0, 0);
  const crop = document.createElement("canvas");
  crop.width = 224;
  crop.height = Math.round(height * 192 / width) + 32;
  const cropContext = crop.getContext("2d");
  cropContext.fillStyle = "#fff";
  cropContext.fillRect(0, 0, crop.width, crop.height);
  cropContext.drawImage(digits, 16, 16, 192, crop.height - 32);
  return crop;
}

function startWorker(engine) {
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = (error) => {
      failed = true;
      clearTimeout(deadline);
      reject(error);
    };
    const deadline = setTimeout(() => fail(new Error("No se ha podido iniciar el lector.")), 45000);
    engine.createWorker("eng", 1, {
      workerPath: new URL("worker.min.js", base).href,
      corePath: base.href,
      langPath: base.href,
      workerBlobURL: false,
      errorHandler: fail,
    }).then((worker) => {
      clearTimeout(deadline);
      if (failed) void worker.terminate();
      else resolve(worker);
    }, fail);
  });
}

export function readWiemsFrame(video) {
  return readWiemsImage(frameCanvas(video));
}

export async function readWiemsImage(original) {
  const engine = await loadEngine();
  const worker = await startWorker(engine);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT });
    let frame = original;
    let masterFrame = original;
    let correctionAngle = 0;
    const first = await worker.recognize(original, {}, { tsv: true });
    let scan = scanWiemsScreen(first.data.tsv, frame.width);
    const retry = async (angle) => {
      const detail = detailCanvas(original, angle);
      const next = await worker.recognize(detail, {}, { tsv: true });
      const candidate = scanWiemsScreen(next.data.tsv, detail.width);
      const count = candidate.layout?.count ?? 0;
      if (candidate.rows.length || (count && count >= (scan.layout?.count ?? 0))) {
        frame = detail;
        masterFrame = undefined;
        correctionAngle = angle;
        scan = candidate;
      }
    };
    if (!scan.rows.length) {
      await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SINGLE_BLOCK });
      await retry(0);
      const tilt = scan.layout?.tilt ?? 0;
      if (!scan.rows.length && Math.abs(tilt) > .055) {
        await retry(-Math.atan(tilt) * 180 / Math.PI);
      }
      for (const angle of [-8, 8]) {
        if (scan.layout) break;
        await retry(angle);
      }
    }
    const { layout, globalMaster } = scan;
    if (!layout) return [];
    const inferred = scan.rows.length === 0;
    // The first Wiems PRO value line sits just below the channel headings.
    const rows = inferred ? [{ y: layout.y + .52 * layout.step, reads: new Map() }] : scan.rows;
    const results = [];

    for (const row of rows) {
      const values = {};
      await worker.setParameters({
        tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "0123456789.,mMaA ",
      });
      for (const [rank, [id]] of channels.entries()) {
        const tile = valueCrop(frame, layout, row, rank);
        const result = await worker.recognize(tile, {}, { tsv: true });
        const prior = row.reads.get(rank)?.value;
        let value = readMilliampCrop(result.data.tsv, prior);
        if (value === undefined) {
          await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SINGLE_LINE });
          const line = await worker.recognize(tile, {}, { tsv: true });
          value = readMilliampCrop(line.data.tsv, prior);
          if (value === undefined) {
            const digits = await worker.recognize(digitsCrop(tile), {}, { tsv: true });
            value = readMilliampCrop(line.data.tsv, prior, digits.data.tsv);
          }
          await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT });
        }
        if (value !== undefined) values[id] = value;
      }
      let master = row.master;
      if (master === undefined) {
        masterFrame ??= detailCanvas(original, correctionAngle, true);
        const badge = masterBadgeCrop(masterFrame, layout, row);
        if (badge) {
          await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SINGLE_LINE,
            tessedit_char_whitelist: "0123456789.," });
          const digits = await worker.recognize(badge, {}, { tsv: true });
          master = readMasterDigits(digits.data.tsv);
        }
      }
      if (master === undefined) {
        await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT, tessedit_char_whitelist: "" });
        const tile = valueCrop(frame, layout, row, channels.length, true);
        const result = await worker.recognize(tile, {}, { tsv: true });
        master = readMilliampCrop(result.data.tsv);
      }
      if (master === undefined && rows.length === 1) master = globalMaster;
      if (inferred && Object.keys(values).length < 3) continue;
      if (master !== undefined) values.master = master;
      results.push(values);
    }
    return results;
  } finally {
    await worker.terminate();
  }
}
