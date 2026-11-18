const byId = (id) => document.getElementById(id);
const dialog = byId("ems-photo-dialog");
const view = byId("ems-photo-view");
const status = byId("ems-photo-status");
const readButton = byId("ems-photo-read");
const edges = ["left", "top", "right", "bottom"];
const controls = new Map(edges.map((edge) => [edge, byId("ems-photo-" + edge)]));
let request;
let anchor;

export function suggestPhotoCrop(image) {
  const sample = document.createElement("canvas");
  const scale = Math.min(320 / image.width, 1024 / image.height);
  sample.width = Math.max(1, Math.round(image.width * scale));
  sample.height = Math.max(1, Math.round(image.height * scale));
  const context = sample.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, sample.width, sample.height);
  const { data } = context.getImageData(0, 0, sample.width, sample.height);
  let consecutive = 0;
  for (let y = 0; y < sample.height; y++) {
    let bright = 0;
    for (let x = 0; x < sample.width; x++) {
      const offset = (y * sample.width + x) * 4;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      if (Math.min(...rgb) > 140 && Math.max(...rgb) - Math.min(...rgb) < 75) bright++;
    }
    consecutive = bright > sample.width * .4 ? consecutive + 1 : 0;
    if (consecutive < 3) continue;
    const top = Math.max(0, (y - 2) / sample.height - .10 * image.width / image.height);
    const bottom = Math.min(1, top + .33 * image.width / image.height);
    return { left: 0, right: 1, top, bottom };
  }
  return { left: 0, top: 0, right: 1, bottom: 1 };
}

function cropCanvas(photo, width) {
  const { image, crop } = photo;
  const left = crop.left * image.width;
  const top = crop.top * image.height;
  const sourceWidth = (crop.right - crop.left) * image.width;
  const sourceHeight = (crop.bottom - crop.top) * image.height;
  const canvas = document.createElement("canvas");
  const scale = Math.min(width / sourceWidth, 2800 / sourceHeight);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingQuality = "high";
  context.drawImage(image, left, top, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function render() {
  const canvas = cropCanvas(request, 1000);
  view.width = canvas.width;
  view.height = canvas.height;
  view.getContext("2d").drawImage(canvas, 0, 0);
  for (const [edge, control] of controls) control.value = Math.round(request.crop[edge] * 100);
}

function finish(result, failure) {
  const current = request;
  request = undefined;
  anchor = undefined;
  view.width = 1;
  view.height = 1;
  if (dialog.open) dialog.close();
  if (failure) current?.reject(failure);
  else current?.resolve(result);
}

export function cropEmsPhoto(file) {
  finish(null);
  return new Promise((resolve, reject) => {
    const current = { resolve, reject };
    request = current;
    readButton.disabled = true;
    view.hidden = true;
    status.textContent = "Abriendo foto…";
    dialog.showModal();
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (request !== current) return;
      try {
        const scale = Math.min(1, 2600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        current.image = canvas;
        current.crop = suggestPhotoCrop(canvas);
        render();
        view.hidden = false;
        readButton.disabled = false;
        status.textContent = "Comprueba que se vean los nombres de los diez canales, sus valores y el máster de una sola fila.";
      } catch {
        finish(null, new Error("No se pudo preparar la foto. Prueba con otra imagen."));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (request !== current) return;
      finish(null, new Error("No se pudo abrir esa imagen. Prueba con una foto JPG o PNG."));
    };
    image.src = url;
  });
}

function position(event) {
  const box = view.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
  };
}

view.addEventListener("pointerdown", (event) => {
  if (!request?.image || !event.isPrimary || event.button !== 0) return;
  anchor = { ...position(event), pointerId: event.pointerId };
  view.setPointerCapture(event.pointerId);
});
view.addEventListener("pointermove", (event) => {
  if (!anchor || event.pointerId !== anchor.pointerId) return;
  render();
  const point = position(event);
  const context = view.getContext("2d");
  context.fillStyle = "rgb(101 53 168 / .15)";
  context.strokeStyle = "#6535a8";
  context.lineWidth = 4;
  const rect = [anchor.x * view.width, anchor.y * view.height,
    (point.x - anchor.x) * view.width, (point.y - anchor.y) * view.height];
  context.fillRect(...rect);
  context.strokeRect(...rect);
});
view.addEventListener("pointerup", (event) => {
  if (!anchor || event.pointerId !== anchor.pointerId) return;
  const point = position(event);
  const left = Math.min(anchor.x, point.x);
  const top = Math.min(anchor.y, point.y);
  const width = Math.abs(point.x - anchor.x);
  const height = Math.abs(point.y - anchor.y);
  anchor = undefined;
  if (width < .08 || height < .08) { render(); return; }
  const crop = request.crop;
  const sourceWidth = crop.right - crop.left;
  const sourceHeight = crop.bottom - crop.top;
  request.crop = { left: crop.left + left * sourceWidth, top: crop.top + top * sourceHeight,
    right: crop.left + (left + width) * sourceWidth, bottom: crop.top + (top + height) * sourceHeight };
  render();
});
view.addEventListener("pointercancel", () => { anchor = undefined; if (request?.image) render(); });

for (const [edge, control] of controls) {
  control.addEventListener("input", () => {
    if (!request?.image) return;
    const crop = request.crop;
    const value = Number(control.value) / 100;
    const valid = { left: value < crop.right - .02, right: value > crop.left + .02,
      top: value < crop.bottom - .02, bottom: value > crop.top + .02 };
    if (valid[edge]) crop[edge] = value;
    render();
  });
}
byId("ems-photo-reset").addEventListener("click", () => {
  if (!request?.image) return;
  request.crop = { left: 0, top: 0, right: 1, bottom: 1 };
  render();
});
byId("ems-photo-cancel").addEventListener("click", () => finish(null));
dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
window.addEventListener("pagehide", () => finish(null));
readButton.addEventListener("click", () => {
  if (request?.image && !readButton.disabled) finish(cropCanvas(request, 2800));
});
