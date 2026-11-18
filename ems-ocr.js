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

function detailCanvas(frame, degrees = 0) {
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
  context.filter = "grayscale(1)";
  context.drawImage(frame, -frame.width * scale / 2, -frame.height * scale / 2,
    frame.width * scale, frame.height * scale);
  return canvas;
}

function valueCrop(frame, layout, row, rank, master = false) {
  const { x, step, tilt } = layout;
  const center = x + (rank + (master ? .03 : 0)) * step;
  const y = row.y + tilt * (center - x);
  const width = (master ? .55 : .86) * step;
  const height = (master ? .55 : .37) * step;
  const top = y + (master ? .02 * step : -.185 * step);
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
  context.filter = "grayscale(1) contrast(1.25)";
  context.drawImage(frame, 0, 0);
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

export async function readWiemsFrame(video) {
  const original = frameCanvas(video);
  const engine = await loadEngine();
  const worker = await startWorker(engine);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.SPARSE_TEXT });
    let frame = original;
    const first = await worker.recognize(original, {}, { tsv: true });
    let scan = scanWiemsScreen(first.data.tsv, frame.width);
    const retry = async (angle) => {
      const detail = detailCanvas(original, angle);
      const next = await worker.recognize(detail, {}, { tsv: true });
      const candidate = scanWiemsScreen(next.data.tsv, detail.width);
      const count = candidate.layout?.count ?? 0;
      if (candidate.rows.length || (count && count >= (scan.layout?.count ?? 0))) {
        frame = detail;
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
      const values = Math.abs(layout.tilt) < .04 ? channelValues(row.reads) : {};
      await worker.setParameters({
        tessedit_pageseg_mode: engine.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789.,mMaA",
      });
      for (const [rank, [id]] of channels.entries()) {
        if (values[id] !== undefined) continue;
        const tile = valueCrop(frame, layout, row, rank);
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
