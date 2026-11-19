import { clientCode, deleteEmsSession, saveEmsSession, today } from "./client-store.js";
import { blocks, channels, defaultRoundCounts, hasRounds, maxRounds } from "./ems-sessions.js";
import { readWiemsImage } from "./ems-ocr.js";
import { cropEmsPhoto } from "./ems-photo.js";

const byId = (id) => document.getElementById(id);
const dialog = byId("ems-dialog");
const overview = byId("ems-overview");
const form = byId("ems-form");
const history = byId("ems-history");
const dateInput = byId("ems-date");
const blockPicker = byId("ems-block");
const roundsSection = byId("ems-rounds");
const roundCount = byId("ems-round-count");
const roundPicker = byId("ems-round");
const roundSummary = byId("ems-round-summary");
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
let activeRound = 0;
let pendingScan;
let photoJob;
let deleteTarget;
let deleteTrigger;
const referencePhotos = new Map();
const scanVersions = new Map();
const scanMessages = new Map();
const roundSelections = new Map();

const recordKey = (block = activeBlock, round = activeRound) => block + ":" + round;
const hasValues = (values) => Object.values(values).some((value) => value != null && String(value).trim() !== "");
const inputValues = () => Object.fromEntries([...inputs].map(([key, input]) => [key, input.value]));

function ensureBlock() {
  draft[activeBlock] ??= hasRounds(activeBlock)
    ? { rounds: Array.from({ length: defaultRoundCounts[activeBlock] }, () => ({})) } : {};
}

function recordValues(block = activeBlock, round = activeRound) {
  return hasRounds(block) ? draft[block].rounds[round] : draft[block];
}

function setRecordValues(values, block = activeBlock, round = activeRound) {
  if (hasRounds(block)) draft[block].rounds[round] = values;
  else draft[block] = values;
}

function recordLabel(block = activeBlock, round = activeRound) {
  const label = blocks.find(([id]) => id === block)[1];
  return label + (hasRounds(block) ? " · vuelta " + (round + 1) : "");
}

const jobIsSelected = (job) => recordKey() === recordKey(job.block, job.round);

function scanMessage(job, message) {
  scanMessages.set(recordKey(job.block, job.round), message);
  if (jobIsSelected(job)) scanStatus.textContent = message;
}

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
  ensureBlock();
  const multiple = hasRounds(activeBlock);
  roundsSection.hidden = !multiple;
  roundCount.disabled = saveButton.disabled || !multiple;
  roundPicker.disabled = saveButton.disabled || !multiple;
  if (multiple) roundCount.value = draft[activeBlock].rounds.length;
  for (const [key, input] of inputs) {
    const value = recordValues()[key];
    input.value = typeof value === "number" ? String(value).replace(".", ",") : value ?? "";
  }
  const reference = referencePhotos.get(recordKey());
  photoReference.hidden = !reference;
  photoReference.querySelector("summary").textContent = multiple
    ? "Foto de la vuelta " + (activeRound + 1) + " para revisar los valores" : "Foto del bloque para revisar los valores";
  if (reference) referenceImage.src = reference;
  else referenceImage.removeAttribute("src");
  scanStatus.textContent = scanMessages.get(recordKey()) ?? "";
  scanRows.hidden = !pendingScan || !jobIsSelected(pendingScan.job) || !scanStillOpen(pendingScan.job);
  resetValues.setAttribute("aria-label", "Reset valores de " + recordLabel());
  updateBlockActions();
}

function updateRoundOptions() {
  if (!hasRounds(activeBlock)) return;
  const readings = draft[activeBlock].rounds;
  let recorded = 0;
  roundPicker.replaceChildren();
  readings.forEach((values, index) => {
    const current = index === activeRound ? inputValues() : values;
    const count = Object.values(current).filter((value) => value != null && String(value).trim() !== "").length;
    if (count) recorded++;
    roundPicker.add(new Option("Vuelta " + (index + 1) + " · " + (count ? count + "/11 campos" : "sin valores"), String(index)));
  });
  roundPicker.value = String(activeRound);
  roundSummary.textContent = recorded + " de " + readings.length + " vueltas con valores. Cada vuelta guarda sus canales y su máster.";
}

function updateBlockActions() {
  resetValues.disabled = saveButton.disabled || (!hasValues(inputValues()) && !referencePhotos.has(recordKey()));
  updateRoundOptions();
}

function rememberBlock() {
  setRecordValues(inputValues());
}

function editSession(existing = null) {
  referencePhotos.clear();
  scanVersions.clear();
  scanMessages.clear();
  roundSelections.clear();
  session = existing;
  draft = structuredClone(existing?.blocks ?? {});
  for (const [id, values] of Object.entries(draft)) {
    if (hasRounds(id) && !values.rounds) {
      draft[id] = { rounds: Array.from({ length: defaultRoundCounts[id] }, (_, index) => index === 0 ? values : {}) };
    }
  }
  dateInput.value = existing?.date ?? today();
  activeBlock = blocks.find(([id]) => draft[id])?.[0] ?? blocks[0][0];
  activeRound = 0;
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
  activeRound = roundSelections.get(activeBlock) ?? 0;
  error.hidden = true;
  showBlock();
});

roundPicker.addEventListener("change", () => {
  rememberBlock();
  activeRound = Number(roundPicker.value);
  roundSelections.set(activeBlock, activeRound);
  error.hidden = true;
  showBlock();
});

roundCount.addEventListener("change", () => {
  rememberBlock();
  const readings = draft[activeBlock].rounds;
  const count = Number(roundCount.value);
  let message;
  if (!Number.isInteger(count) || count < 1 || count > maxRounds) {
    message = "Introduce entre 1 y " + maxRounds + " vueltas.";
  } else if (readings.slice(count).some(hasValues)) {
    message = "Hay valores en las vueltas que quieres quitar. Vacía esas vueltas antes de reducir el número.";
  }
  if (message) {
    roundCount.value = readings.length;
    error.textContent = message;
    error.hidden = false;
    return;
  }
  for (let index = count; index < readings.length; index++) {
    const key = recordKey(activeBlock, index);
    scanVersions.set(key, (scanVersions.get(key) ?? 0) + 1);
    referencePhotos.delete(key);
    scanMessages.delete(key);
  }
  while (readings.length < count) readings.push({});
  readings.length = count;
  activeRound = Math.min(activeRound, count - 1);
  roundSelections.set(activeBlock, activeRound);
  error.hidden = true;
  showBlock();
});

function scanStillOpen(job) {
  return dialog.open && !form.hidden && draft === job.draft
    && job.version === (scanVersions.get(recordKey(job.block, job.round)) ?? 0)
    && (!hasRounds(job.block) || job.round < draft[job.block].rounds.length);
}

function clearBlock() {
  if (saveButton.disabled) return;
  const key = recordKey();
  const label = recordLabel();
  scanVersions.set(key, (scanVersions.get(key) ?? 0) + 1);
  referencePhotos.delete(key);
  scanRows.hidden = true;
  if (pendingScan && jobIsSelected(pendingScan.job)) pendingScan = undefined;
  error.hidden = true;
  setRecordValues({});
  scanMessages.set(key, "Valores de " + label + " vaciados. Pulsa Guardar sesión para aplicar el cambio.");
  showBlock();
}

resetValues.addEventListener("click", clearBlock);

function fillFromScan(job, values) {
  if (!scanStillOpen(job)) return;
  if (jobIsSelected(job)) rememberBlock();
  const target = recordValues(job.block, job.round);
  const untouched = Object.entries(values).filter(([id]) => target[id] === job.before[id]);
  Object.assign(target, Object.fromEntries(untouched));
  const label = recordLabel(job.block, job.round);
  const count = untouched.length;
  scanMessage(job, count
    ? count + " de " + inputs.size + " campos rellenados en " + label + ". Revisa los valores antes de guardar."
    : "Se mantuvieron los valores que editaste durante la lectura.");
  scanRows.hidden = true;
  pendingScan = undefined;
  if (jobIsSelected(job)) showBlock();
  else updateRoundOptions();
}

function scanJob() {
  rememberBlock();
  return { draft, block: activeBlock, round: activeRound, before: { ...recordValues() }, version: scanVersions.get(recordKey()) ?? 0 };
}

async function runScan(job, read) {
  takePhoto.disabled = true;
  choosePhoto.disabled = true;
  scanMessage(job, "Leyendo intensidades de " + recordLabel(job.block, job.round) + "…");
  scanRows.hidden = true;
  pendingScan = undefined;
  try {
    const rows = await read();
    if (!scanStillOpen(job)) return;
    if (!rows.some((values) => Object.keys(values).length)) {
      scanMessage(job, "No se han podido leer los valores. Ajusta el recorte para incluir los nombres de los canales, los números y el máster. También puedes completarlos a mano.");
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
    scanRows.hidden = !jobIsSelected(job);
    scanMessage(job, "Se han detectado varias filas de valores en la foto de " + recordLabel(job.block, job.round) + ".");
  } catch {
    if (scanStillOpen(job)) {
      scanMessage(job, "No se pudo completar la lectura. Comprueba la conexión para iniciar el lector o completa los valores a mano.");
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
      referencePhotos.set(recordKey(job.block, job.round), image.toDataURL("image/jpeg", .88));
      if (jobIsSelected(job)) { rememberBlock(); showBlock(); }
      await runScan(job, () => readWiemsImage(image));
    } catch (failure) {
      if (scanStillOpen(job)) scanMessage(job, failure.message);
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
