import { clientCode, saveEmsSession, today } from "./client-store.js";
import { blocks, channels } from "./ems-sessions.js";
import { readWiemsFrame } from "./ems-ocr.js";

const byId = (id) => document.getElementById(id);
const dialog = byId("ems-dialog");
const overview = byId("ems-overview");
const form = byId("ems-form");
const history = byId("ems-history");
const dateInput = byId("ems-date");
const blockPicker = byId("ems-block");
const saveButton = byId("save-ems-session");
const cancelButton = byId("cancel-ems-session");
const newButton = byId("new-ems-session");
const error = byId("ems-error");
const feedback = byId("ems-feedback");
const scanButton = byId("ems-scan-button");
const scanStatus = byId("ems-scan-status");
const scanRows = byId("ems-scan-rows");
const scanRow = byId("ems-scan-row");
const cameraDialog = byId("ems-camera-dialog");
const cameraVideo = byId("ems-camera-video");
const cameraStatus = byId("ems-camera-status");
const cameraRead = byId("ems-camera-read");
const cameraFocus = byId("ems-camera-focus");
const cameraPicker = byId("ems-camera-picker");
const cameraDevice = byId("ems-camera-device");
const focusHint = "Separa un poco el móvil hasta que los números se vean nítidos.";

const inputs = new Map();
let client;
let onSave;
let session;
let draft;
let activeBlock;
let pendingScan;
let cameraRequest;

function addInput(container, id, label) {
  const field = document.createElement("label");
  field.className = "ems-field";
  const title = document.createElement("span");
  title.textContent = label;
  const control = document.createElement("span");
  control.className = "ems-number";
  const input = document.createElement("input");
  input.id = "ems-" + id;
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  const unit = document.createElement("span");
  unit.textContent = "mA";
  control.append(input, unit);
  field.append(title, control);
  container.append(field);
  inputs.set(id, input);
}

for (const [id, label] of blocks) blockPicker.add(new Option(label, id));
addInput(byId("ems-master-field"), "master", "Máster del bloque");
for (const [id, label] of channels) addInput(byId("ems-channels"), id, label);

function showOverview() {
  const sessions = client.emsSessions ?? [];
  const dateCounts = new Map();
  const entries = sessions.map((item) => {
    const number = (dateCounts.get(item.date) ?? 0) + 1;
    dateCounts.set(item.date, number);
    return { item, number };
  });
  entries.reverse().sort((left, right) => right.item.date.localeCompare(left.item.date));
  history.replaceChildren();
  for (const { item, number } of entries) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ems-history-item";
    const label = document.createElement("strong");
    const date = item.date.split("-").reverse().join("/");
    label.textContent = dateCounts.get(item.date) > 1 ? date + " · sesión " + number : date;
    const summary = document.createElement("span");
    const count = Object.keys(item.blocks).length;
    summary.textContent = count + (count === 1 ? " bloque" : " bloques");
    button.append(label, summary);
    button.addEventListener("click", () => editSession(item));
    row.append(button);
    history.append(row);
  }
  byId("ems-empty").hidden = sessions.length > 0;
  form.hidden = true;
  overview.hidden = false;
}

function showBlock() {
  for (const [key, input] of inputs) {
    const value = draft[activeBlock]?.[key];
    input.value = typeof value === "number" ? String(value).replace(".", ",") : value ?? "";
  }
}

function rememberBlock() {
  draft[activeBlock] = Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]));
}

function editSession(existing = null) {
  session = existing;
  draft = { ...existing?.blocks };
  dateInput.value = existing?.date ?? today();
  activeBlock = blocks.find(([id]) => draft[id])?.[0] ?? blocks[0][0];
  blockPicker.value = activeBlock;
  error.hidden = true;
  scanStatus.textContent = "";
  scanRows.hidden = true;
  pendingScan = undefined;
  showBlock();
  overview.hidden = true;
  form.hidden = false;
  dateInput.focus();
}

export function openEmsPanel(selectedClient, updateClient) {
  client = selectedClient;
  onSave = updateClient;
  byId("ems-client").textContent = client.name + " · " + clientCode(client.id);
  feedback.textContent = "";
  showOverview();
  dialog.showModal();
}

newButton.addEventListener("click", () => editSession());
byId("close-ems").addEventListener("click", () => dialog.close());
cancelButton.addEventListener("click", () => {
  showOverview();
  newButton.focus();
});
dialog.addEventListener("cancel", (event) => {
  if (saveButton.disabled) event.preventDefault();
});

blockPicker.addEventListener("change", () => {
  rememberBlock();
  activeBlock = blockPicker.value;
  showBlock();
});

function scanStillOpen(job) {
  return dialog.open && !form.hidden && draft === job.draft;
}

function fillFromScan(job, values) {
  if (!scanStillOpen(job)) return;
  if (activeBlock === job.block) rememberBlock();
  const target = draft[job.block];
  const untouched = Object.entries(values).filter(([id]) => target[id] === job.before[id]);
  Object.assign(target, Object.fromEntries(untouched));
  if (activeBlock === job.block) showBlock();
  const label = blockPicker.querySelector('[value="' + job.block + '"]').textContent;
  const count = untouched.length;
  scanStatus.textContent = count
    ? count + " de " + inputs.size + " campos rellenados en " + label + ". Revisa los valores antes de guardar."
    : "Se mantuvieron los valores que editaste durante la lectura.";
  scanRows.hidden = true;
  pendingScan = undefined;
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function stopCamera() {
  cameraRequest = undefined;
  cameraRead.disabled = true;
  cameraFocus.hidden = true;
  const stream = cameraVideo.srcObject;
  cameraVideo.srcObject = null;
  stopStream(stream);
}

function closeCamera() {
  stopCamera();
  cameraPicker.hidden = true;
  if (cameraDialog.open) cameraDialog.close();
}

function cameraIsOpen(request) {
  return cameraDialog.open && cameraRequest === request;
}

async function adjustFocus(request, mode, aimAtCenter = false) {
  const { track, canTarget } = request;
  const advanced = [{ focusMode: mode }];
  if (aimAtCenter && canTarget) advanced.push({ pointsOfInterest: [{ x: .5, y: .5 }] });
  cameraStatus.textContent = "Ajustando el enfoque…";
  try {
    await track.applyConstraints({ ...track.getConstraints(), advanced });
    // Give the lens time to settle before allowing a frame to be read.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return "";
  } catch {
    return focusHint;
  }
}

async function updateCameraPicker(request) {
  const activeId = request.track.getSettings?.().deviceId;
  if (!activeId || !navigator.mediaDevices.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  if (!cameraIsOpen(request)) return;
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  if (cameras.length < 2 || !cameras.some((camera) => camera.deviceId === activeId)) return;
  cameraDevice.replaceChildren(...cameras.map((camera, index) =>
    new Option(camera.label || "Cámara " + (index + 1), camera.deviceId)));
  cameraDevice.value = activeId;
  cameraPicker.hidden = false;
}

async function startCamera(deviceId) {
  stopCamera();
  const request = {};
  cameraRequest = request;
  cameraDevice.disabled = true;
  cameraStatus.textContent = "Abriendo la cámara…";
  try {
    const source = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } };
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...source, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (!cameraIsOpen(request)) {
      stopStream(stream);
      return;
    }
    cameraVideo.srcObject = stream;
    const [track] = stream.getVideoTracks();
    request.track = track;
    track.addEventListener("ended", () => {
      if (!cameraIsOpen(request)) return;
      stopCamera();
      cameraDevice.disabled = false;
      cameraStatus.textContent = "La cámara se ha desconectado. Cierra y vuelve a abrir el escáner.";
    }, { once: true });
    await cameraVideo.play();
    if (!cameraIsOpen(request)) return;

    const modes = track.getCapabilities?.().focusMode ?? [];
    const continuous = modes.includes("continuous");
    const singleShot = modes.includes("single-shot");
    request.canTarget = navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest;
    request.refocusMode = singleShot ? "single-shot" : continuous && request.canTarget ? "continuous" : null;
    const mode = continuous ? "continuous" : request.refocusMode;
    const message = mode ? await adjustFocus(request, mode, !continuous) : focusHint;
    if (!cameraIsOpen(request)) return;
    cameraRead.disabled = false;
    cameraFocus.hidden = !request.refocusMode;
    cameraFocus.disabled = false;
    cameraStatus.textContent = message;
    cameraDevice.disabled = false;
    void updateCameraPicker(request);
  } catch (failure) {
    if (!cameraIsOpen(request)) return;
    stopCamera();
    cameraDevice.disabled = false;
    if (failure.name === "NotAllowedError") {
      cameraStatus.textContent = "Permite el acceso a la cámara en los ajustes del sitio y vuelve a abrir el escáner.";
    } else if (failure.name === "NotFoundError") {
      cameraStatus.textContent = "No se encontró una cámara en este dispositivo.";
    } else {
      cameraStatus.textContent = "No se pudo abrir la cámara. Cierra otras apps que la estén usando e inténtalo de nuevo.";
    }
  }
}

scanButton.addEventListener("click", () => {
  cameraDialog.showModal();
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Abre la app en un navegador con acceso a la cámara.";
    return;
  }
  void startCamera();
});

cameraDevice.addEventListener("change", () => { void startCamera(cameraDevice.value); });
cameraFocus.addEventListener("click", async () => {
  const request = cameraRequest;
  if (!request?.refocusMode || cameraRead.disabled) return;
  cameraRead.disabled = true;
  cameraFocus.disabled = true;
  const message = await adjustFocus(request, request.refocusMode, true);
  if (!cameraIsOpen(request)) return;
  cameraRead.disabled = false;
  cameraFocus.disabled = false;
  cameraStatus.textContent = message;
});

byId("ems-camera-close").addEventListener("click", closeCamera);
cameraDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCamera();
});
window.addEventListener("pagehide", closeCamera);

cameraRead.addEventListener("click", async () => {
  if (cameraRead.disabled || form.hidden) return;
  rememberBlock();
  const job = { draft, block: activeBlock, before: { ...draft[activeBlock] } };
  scanButton.disabled = true;
  scanStatus.textContent = "Leyendo intensidades…";
  scanRows.hidden = true;
  pendingScan = undefined;
  try {
    // Copia el fotograma antes de cerrar la cámara.
    const reading = readWiemsFrame(cameraVideo);
    closeCamera();
    const rows = await reading;
    if (!scanStillOpen(job)) return;
    if (!rows.some((values) => Object.keys(values).length)) {
      scanStatus.textContent = "Vuelve a escanear de frente, con los canales y el máster visibles y sin reflejos.";
      return;
    }
    if (rows.length === 1) {
      fillFromScan(job, rows[0]);
      return;
    }
    pendingScan = { job, rows };
    scanRow.replaceChildren(new Option("Elige una fila", ""));
    for (const [index, values] of rows.entries()) {
      const count = Object.keys(values).length;
      const option = new Option("Fila " + (index + 1) + " · " + count + " de " + inputs.size + " valores", String(index));
      option.disabled = count === 0;
      scanRow.add(option);
    }
    scanRows.hidden = false;
    scanStatus.textContent = "Se han detectado varias filas de valores.";
  } catch {
    if (scanStillOpen(job)) {
      scanStatus.textContent = "No se pudo completar la lectura. Abre la app con conexión y vuelve a escanear.";
    }
  } finally {
    scanButton.disabled = false;
  }
});

scanRow.addEventListener("change", () => {
  if (pendingScan && scanRow.value !== "") {
    fillFromScan(pendingScan.job, pendingScan.rows[Number(scanRow.value)]);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  cancelButton.disabled = true;
  error.hidden = true;
  rememberBlock();
  try {
    client = await saveEmsSession({ date: dateInput.value, blocks: draft }, client, session);
    onSave(client);
    showOverview();
    feedback.textContent = "Intensidades guardadas.";
    newButton.focus();
  } catch (failure) {
    error.textContent = failure.message || "No se han podido guardar las intensidades.";
    error.hidden = false;
  } finally {
    saveButton.disabled = false;
    cancelButton.disabled = false;
  }
});
