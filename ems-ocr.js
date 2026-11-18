import { channels } from "./ems-sessions.js";
import { channelValues, readMilliampCrop, scanWiemsScreen } from "./wiems-values.js";

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
        reject(new Error("Conéctate a internet para iniciar el lector de fotos."));
      };
      document.head.append(script);
    });
  }
  return scriptReady;
}

async function photoCanvas(file) {
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("No se ha podido abrir la imagen. Prueba con una foto JPG o PNG.");
  }
  try {
    const scale = Math.min(3, 2200 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.close();
  }
}

function valueCrop(photo, layout, row, rank, master = false) {
  const { x, step, tilt } = layout;
  const center = x + (rank + (master ? .03 : 0)) * step;
  const y = row.y + tilt * (center - x);
  const width = (master ? .57 : .86) * step;
  const height = (master ? .52 : .32) * step;
  const top = y + (master ? .04 * step : -.16 * step);
  const crop = document.createElement("canvas");
  const scale = Math.max(2, 120 / width);
  crop.width = Math.round(width * scale);
  crop.height = Math.round(height * scale);
  const context = crop.getContext("2d", { alpha: false });
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, crop.width, crop.height);
  context.setTransform(scale, -scale * tilt, 0, scale,
    scale * (width / 2 - center), scale * (tilt * center - top));
  context.drawImage(photo, 0, 0);
  return crop;
}

function digitsCrop(tile) {
  const crop = document.createElement("canvas");
  crop.width = Math.round(tile.width * .46);
  crop.height = tile.height;
  crop.getContext("2d").drawImage(tile, 0, 0);
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

export async function readWiemsPhoto(file) {
  const [engine, photo] = await Promise.all([loadEngine(), photoCanvas(file)]);
  const worker = await startWorker(engine);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT });
    const first = await worker.recognize(photo, {}, { tsv: true });
    const { layout, rows, globalMaster } = scanWiemsScreen(first.data.tsv, photo.width);
    const results = [];

    for (const row of rows) {
      const values = channelValues(row.reads);
      await worker.setParameters({
        tessedit_pageseg_mode: engine.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789.,mMaA",
      });
      for (const [rank, [id]] of channels.entries()) {
        if (values[id] !== undefined) continue;
        const tile = valueCrop(photo, layout, row, rank);
        const result = await worker.recognize(tile, {}, { tsv: true });
        const prior = row.reads.get(rank)?.value;
        let value = readMilliampCrop(result.data.tsv, prior);
        if (value === undefined) {
          const digits = await worker.recognize(digitsCrop(tile), {}, { tsv: true });
          value = readMilliampCrop(result.data.tsv, prior, digits.data.tsv);
        }
        if (value !== undefined) values[id] = value;
      }
      let master = row.master;
      if (master === undefined) {
        await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SINGLE_BLOCK });
        const tile = valueCrop(photo, layout, row, channels.length, true);
        const result = await worker.recognize(tile, {}, { tsv: true });
        master = readMilliampCrop(result.data.tsv);
      }
      if (master === undefined && rows.length === 1) master = globalMaster;
      if (master !== undefined) values.master = master;
      results.push(values);
    }
    return results;
  } finally {
    await worker.terminate();
  }
}
