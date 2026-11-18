import { clientCode, deleteEmsSession, saveEmsSession, today } from "./client-store.js";
import { blocks, channels } from "./ems-sessions.js";
import { readWiemsImage } from "./ems-ocr.js";
import { cropEmsPhoto } from "./ems-photo.js";

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
const resetValues = byId("reset-ems-values");
const sessionActions = byId("ems-session-actions");
const deleteConfirm = byId("confirm-ems-delete");
const deleteCancel = byId("cancel-ems-delete");
const deleteError = byId("ems-delete-error");
const error = byId("ems-error");
const feedback = byId("ems-feedback");
const takePhoto = byId("ems-take-photo");
const choosePhoto = byId("ems-choose-photo");
const photoReference = byId("ems-photo-reference");
const referenceImage = byId("ems-photo-reference-image");
const scanStatus = byId("ems-scan-status");
const scanRows = byId("ems-scan-rows");
const scanRow = byId("ems-scan-row");

const inputs = new Map();
let client;
let onSave;
let session;
let draft;
let activeBlock;
let pendingScan;
let photoJob;
let deleteTarget;
let deleteTrigger;
const referencePhotos = new Map();
const scanVersions = new Map();

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
  input.addEventListener("input", updateBlockActions);
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
  referencePhotos.clear();
  referenceImage.removeAttribute("src");
  photoReference.hidden = true;
  const sessions = (client.emsSessions ?? []).filter((item) => Object.keys(item.blocks).length > 0);
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
    bindSessionActions(button, item, label.textContent);
    row.append(button);
    history.append(row);
  }
  byId("ems-empty").hidden = sessions.length > 0;
  byId("ems-history-hint").hidden = sessions.length === 0;
  form.hidden = true;
  overview.hidden = false;
}

function openSessionActions(item, button, label) {
  if (!dialog.open || overview.hidden || !button.isConnected || sessionActions.open) return;
  deleteTarget = item;
  deleteTrigger = button;
  byId("ems-session-actions-date").textContent = label;
  deleteError.hidden = true;
  sessionActions.showModal();
}

function bindSessionActions(button, item, label) {
  let holdTimer;
  let origin;
  let held = false;
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = undefined; };
  const showActions = () => {
    stopHold();
    held = true;
    openSessionActions(item, button, label);
  };
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-describedby", "ems-history-hint");
  button.addEventListener("pointerdown", (event) => {
    stopHold();
    held = false;
    if (event.button !== 0 || event.isPrimary === false) return;
    origin = { x: event.clientX, y: event.clientY };
    holdTimer = setTimeout(showActions, 700);
  });
  button.addEventListener("pointermove", (event) => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) stopHold();
  });
  for (const name of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(name, stopHold);
  button.addEventListener("contextmenu", (event) => { event.preventDefault(); showActions(); });
  button.addEventListener("keydown", (event) => {
    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu" || event.key === "Delete") {
      event.preventDefault();
      showActions();
    }
  });
  button.addEventListener("click", (event) => {
    stopHold();
    if (sessionActions.open || (held && event.detail !== 0)) { event.preventDefault(); return; }
    editSession(item);
  });
}

deleteCancel.addEventListener("click", () => sessionActions.close());
sessionActions.addEventListener("cancel", (event) => {
  if (deleteConfirm.disabled) event.preventDefault();
});
sessionActions.addEventListener("close", () => {
  deleteTarget = undefined;
  if (deleteTrigger?.isConnected) deleteTrigger.focus();
  deleteTrigger = undefined;
});
deleteConfirm.addEventListener("click", async () => {
  if (!deleteTarget || deleteConfirm.disabled) return;
  deleteConfirm.disabled = true;
  deleteCancel.disabled = true;
  deleteError.hidden = true;
  try {
    client = await deleteEmsSession(client, deleteTarget);
    onSave(client);
    showOverview();
    sessionActions.close();
    feedback.textContent = "Sesión eliminada.";
    newButton.focus();
  } catch (failure) {
    deleteError.textContent = failure.message || "No se ha podido eliminar la sesión.";
    deleteError.hidden = false;
  } finally {
    deleteConfirm.disabled = false;
    deleteCancel.disabled = false;
  }
});

function showBlock() {
  for (const [key, input] of inputs) {
    const value = draft[activeBlock]?.[key];
    input.value = typeof value === "number" ? String(value).replace(".", ",") : value ?? "";
  }
  const reference = referencePhotos.get(activeBlock);
  photoReference.hidden = !reference;
  if (reference) referenceImage.src = reference;
  else referenceImage.removeAttribute("src");
  updateBlockActions();
}

function updateBlockActions() {
  const hasValues = [...inputs.values()].some((input) => input.value.trim() !== "");
  resetValues.disabled = saveButton.disabled || (!hasValues && !referencePhotos.has(activeBlock));
}

function rememberBlock() {
  draft[activeBlock] = Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]));
}

function editSession(existing = null) {
  referencePhotos.clear();
  scanVersions.clear();
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
  return dialog.open && !form.hidden && draft === job.draft
    && job.version === (scanVersions.get(job.block) ?? 0);
}

function clearBlock() {
  if (saveButton.disabled) return;
  const block = activeBlock;
  const label = blocks.find(([id]) => id === block)[1];
  scanVersions.set(block, (scanVersions.get(block) ?? 0) + 1);
  referencePhotos.delete(block);
  scanRows.hidden = true;
  pendingScan = undefined;
  error.hidden = true;
  draft[block] = {};
  showBlock();
  scanStatus.textContent = "Valores de " + label + " vaciados. Pulsa Guardar sesión para aplicar el cambio.";
}

resetValues.addEventListener("click", clearBlock);

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

function scanJob() {
  rememberBlock();
  return { draft, block: activeBlock, before: { ...draft[activeBlock] }, version: scanVersions.get(activeBlock) ?? 0 };
}

async function runScan(job, read) {
  takePhoto.disabled = true;
  choosePhoto.disabled = true;
  scanStatus.textContent = "Leyendo intensidades…";
  scanRows.hidden = true;
  pendingScan = undefined;
  try {
    const rows = await read();
    if (!scanStillOpen(job)) return;
    if (!rows.some((values) => Object.keys(values).length)) {
      scanStatus.textContent = "No se han podido leer los valores. Ajusta el recorte para incluir los nombres de los canales, los números y el máster. También puedes completarlos a mano.";
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
      scanStatus.textContent = "No se pudo completar la lectura. Comprueba la conexión para iniciar el lector o completa los valores a mano.";
    }
  } finally {
    takePhoto.disabled = false;
    choosePhoto.disabled = false;
  }
}

for (const [button, input] of [[takePhoto, byId("ems-camera-file")], [choosePhoto, byId("ems-photo-file")]]) {
  button.addEventListener("click", () => {
    photoJob = scanJob();
    input.value = "";
    input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    const job = photoJob;
    photoJob = undefined;
    if (!file || !job || !scanStillOpen(job)) return;
    try {
      const image = await cropEmsPhoto(file);
      if (!image || !scanStillOpen(job)) return;
      referencePhotos.set(job.block, image.toDataURL("image/jpeg", .88));
      if (activeBlock === job.block) { rememberBlock(); showBlock(); }
      await runScan(job, () => readWiemsImage(image));
    } catch (failure) {
      if (scanStillOpen(job)) scanStatus.textContent = failure.message;
    }
  });
}

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
  updateBlockActions();
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
    updateBlockActions();
  }
});
