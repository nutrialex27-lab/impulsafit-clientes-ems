import { clientCode, deleteEmsSession, saveEmsSession, today } from "./client-store.js";
import { blocks, blockDefinitions, channels, hasRounds, maxRounds, roundDefault } from "./ems-sessions.js";
import { readWiemsImage } from "./ems-ocr.js";
import { cropEmsPhoto } from "./ems-photo.js";
import { blockSuggestion, formatLoad, hasReading, hasSessionData, latestLoads, loadUnits, perceptions, previousSession, recordId, valuesFor } from "./ems-training.js";
import { cycleDescription, openCycleEditor } from "./ems-cycle.js";
import { openTrainingReport } from "./ems-report.js";

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
let routine, cycleId, followup, definitions = blocks;
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
    ? { rounds: Array.from({ length: routine?.blocks.find((block) => block.id === activeBlock)?.rounds ?? roundDefault(activeBlock) }, () => ({})) } : {};
}

function recordValues(block = activeBlock, round = activeRound) {
  return hasRounds(block) ? draft[block].rounds[round] : draft[block];
}

function setRecordValues(values, block = activeBlock, round = activeRound) {
  if (hasRounds(block)) draft[block].rounds[round] = values;
  else draft[block] = values;
}

function recordLabel(block = activeBlock, round = activeRound) {
  const label = definitions.find(([id]) => id === block)[1];
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
  input.addEventListener("input", () => {
    const source = followup.sources[recordKey()];
    if (source?.method !== "photo" || source.reviewed) followup.sources[recordKey()] = { method: "manual", reviewed: true };
    updateBlockActions();
  });
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
  const sessions = (client.emsSessions ?? []).filter(hasSessionData);
  const cycle = client.trainingCycles?.find((item) => item.id === client.activeCycleId);
  const card = byId("training-cycle-card"); card.replaceChildren();
  const heading = document.createElement("strong"), description = document.createElement("p");
  heading.textContent = cycle ? cycle.routine.title : "Prepara su ciclo de cuatro semanas";
  description.textContent = cycle ? cycleDescription(cycle) + " · " + sessions.filter((item) => item.cycleId === cycle.id).length + " registradas"
    : "Asigna una rutina de Impulsagen para registrar sus ejercicios, cargas y evolución.";
  card.append(heading, description);
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
    summary.textContent = count ? count + (count === 1 ? " bloque" : " bloques") : "Cargas y seguimiento";
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
  const block = routine?.blocks.find((item) => item.id === activeBlock);
  byId("training-block-parameters").textContent = block ? [block.seconds / 60 + " min", block.ems ? "ON " + block.on + " / OFF " + block.off + " s" : "Sin EMS", block.ems && block.hz != null ? block.hz + " Hz" : "", block.program].filter(Boolean).join(" · ") : "";
  byId("training-loads").hidden = !block;
  byId("ems-master-field").hidden = block?.ems === false;
  byId("ems-channels").hidden = block?.ems === false;
  document.querySelector(".ems-channels-heading").hidden = block?.ems === false;
  document.querySelector(".ems-scan").hidden = block?.ems === false;
  renderLoads(block);
  renderBlockFeedback();
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
  if (followup) { updateQuickActions(); renderSuggestion(); }
}

function rememberBlock() {
  setRecordValues(inputValues());
}

function currentSession() {
  return { ...(session?.id ? { id: session.id } : {}), date: dateInput.value, blocks: draft,
    ...(routine ? { routine } : {}), ...(cycleId ? { cycleId } : {}), followup };
}

function referenceRecord() {
  if (activeRound > 0 && hasReading(recordValues(activeBlock, activeRound - 1))) {
    const source = followup.sources[recordId(activeBlock, activeRound - 1)];
    return { values: recordValues(activeBlock, activeRound - 1), label: "Vuelta " + activeRound + " de hoy", pending: source?.method === "photo" && !source.reviewed };
  }
  const previous = previousSession(client.emsSessions ?? [], currentSession(), activeBlock, activeRound);
  if (!previous) return null;
  const source = previous.followup?.sources?.[recordKey()];
  return { values: valuesFor(previous, activeBlock, activeRound),
    label: previous.date.split("-").reverse().join("/") + " · misma vuelta de la sesión anterior", pending: source?.method === "photo" && !source.reviewed };
}

function updateQuickActions() {
  const reference = referenceRecord();
  byId("copy-ems-values").disabled = !reference || reference.pending || saveButton.disabled;
  byId("training-reference").textContent = reference ? "Referencia: " + reference.label + (reference.pending ? " · foto pendiente de confirmar" : "") : "Sin referencia comparable. Anota los valores o haz una foto.";
  for (const [id, input] of inputs) input.placeholder = reference?.values[id] != null ? "Antes: " + reference.values[id] : "";
  const source = followup.sources[recordKey()];
  byId("review-ems-values").hidden = source?.method !== "photo" || source.reviewed;
  byId("training-record-status").textContent = source?.method === "photo" && !source.reviewed ? "Foto pendiente de revisión. Los campos vacíos quedan sin registrar."
    : source?.method === "confirmed" ? "Valores confirmados · " + source.reference : source?.reviewed ? "Valores revisados." : "";
  const lastRound = !hasRounds(activeBlock) || activeRound === draft[activeBlock].rounds.length - 1;
  const atEnd = lastRound && activeBlock === definitions.at(-1)[0];
  byId("next-ems-record").disabled = atEnd || saveButton.disabled;
  byId("next-ems-record").textContent = atEnd ? "Último bloque" : lastRound ? "Siguiente bloque" : "Siguiente vuelta";
}

function renderSuggestion() {
  const root = byId("training-suggestion"); root.replaceChildren();
  const block = routine?.blocks.find((item) => item.id === activeBlock);
  const experience = client.trainingCycles?.find((item) => item.id === cycleId)?.experience;
  const previous = previousSession(client.emsSessions ?? [], currentSession(), activeBlock, activeRound);
  const suggestion = block?.ems === false ? { title: "Seguimiento de las cargas", reason: "Este bloque está programado sin EMS. Confirma la carga y la ejecución.", tone: "neutral" }
    : blockSuggestion(currentSession(), previous, activeBlock, experience);
  root.dataset.tone = suggestion.tone;
  const heading = document.createElement("strong"), reason = document.createElement("p"), note = document.createElement("small");
  heading.textContent = suggestion.title; reason.textContent = suggestion.reason;
  note.textContent = "Orientación para tu revisión; no modifica ni prescribe mA.";
  root.append(heading, reason, note);
}

function loadIsReady(load) {
  return load && (["body"].includes(load.unit) || ["band", "other"].includes(load.unit) && Boolean(load.note?.trim())
    || ["total", "each"].includes(load.unit) && load.kg != null && load.kg !== "");
}

function renderLoads(block) {
  const root = byId("training-exercises"); root.replaceChildren();
  for (const exercise of block?.exercises ?? []) {
    const load = followup.loads[exercise.id] ?? { unit: "total", note: "", confirmed: false };
    const row = document.createElement("div"); row.className = "training-exercise";
    const name = document.createElement("strong"); name.textContent = exercise.name;
    const fields = document.createElement("div"); fields.className = "training-load-fields";
    const label = document.createElement("label"); label.className = "ems-field";
    const title = document.createElement("span"); title.textContent = "Carga utilizada";
    const weight = document.createElement("input"); weight.type = "text"; weight.inputMode = "decimal"; weight.autocomplete = "off";
    weight.value = load.kg ?? ""; weight.placeholder = "kg"; weight.setAttribute("aria-label", "Carga de " + exercise.name);
    const unit = document.createElement("select"); unit.setAttribute("aria-label", "Unidad de carga de " + exercise.name);
    for (const [id, text] of Object.entries(loadUnits)) unit.add(new Option(text, id)); unit.value = load.unit;
    weight.disabled = !["total", "each"].includes(unit.value);
    const note = document.createElement("input"); note.type = "text"; note.maxLength = 150; note.value = load.note ?? ""; note.placeholder = "Detalle opcional: banda, material…";
    note.setAttribute("aria-label", "Detalle de carga de " + exercise.name);
    const state = document.createElement("small"); state.textContent = load.confirmed ? "Carga confirmada" : loadIsReady(load) ? "Referencia pendiente de confirmar" : "Sin carga registrada";
    const update = () => {
      const unitValue = unit.value, textValue = weight.value.trim();
      const kg = /^[0-9]+(?:[.,][0-9]+)?$/.test(textValue) ? Number(textValue.replace(",", ".")) : textValue;
      const value = { unit: unitValue, note: note.value, confirmed: true, ...(["total", "each"].includes(unitValue) ? { kg } : {}) };
      followup.loads[exercise.id] = value;
      weight.disabled = !["total", "each"].includes(unitValue);
      state.textContent = loadIsReady(value) ? "Carga confirmada" : "Completa la carga utilizada";
      renderSuggestion(); updateLoadConfirmation();
    };
    weight.addEventListener("input", update); unit.addEventListener("change", update); note.addEventListener("input", update);
    label.append(title, weight); fields.append(label, unit); row.append(name, fields, note, state); root.append(row);
  }
  updateLoadConfirmation();
}

function updateLoadConfirmation() {
  const pending = Object.values(followup.loads).filter((load) => loadIsReady(load) && !load.confirmed).length;
  const button = byId("confirm-training-loads"); button.disabled = !pending;
  button.textContent = pending ? "Confirmar mismas cargas · " + pending + " referencias" : "Cargas registradas al introducirlas";
}

const zoneInputs = new Map();
for (const [id, name] of channels) {
  const label = document.createElement("label"); label.className = "ems-field";
  const title = document.createElement("span"); title.textContent = name;
  const select = document.createElement("select"); select.setAttribute("aria-label", "Percepción en " + name);
  select.add(new Option("Sin valoración local", ""));
  for (const [key, value] of Object.entries(perceptions)) select.add(new Option(value, key));
  label.append(title, select); byId("training-zones").append(label); zoneInputs.set(id, select);
  select.addEventListener("change", rememberBlockFeedback);
}

function renderBlockFeedback() {
  const value = followup.feedback[activeBlock] ?? {};
  byId("training-perception").value = value.perception ?? "";
  byId("training-technique").value = value.technique ?? "";
  byId("training-sensation").value = value.sensation ?? "";
  for (const [id, select] of zoneInputs) select.value = value.zones?.[id] ?? "";
}

function rememberBlockFeedback() {
  const value = { perception: byId("training-perception").value, technique: byId("training-technique").value,
    zones: Object.fromEntries([...zoneInputs].filter(([, input]) => input.value).map(([id, input]) => [id, input.value])) };
  if (byId("training-sensation").value !== "") value.sensation = Number(byId("training-sensation").value);
  followup.feedback[activeBlock] = value; renderSuggestion();
}

for (const id of ["training-perception", "training-technique", "training-sensation"]) byId(id).addEventListener("change", rememberBlockFeedback);
byId("training-sensation").addEventListener("input", rememberBlockFeedback);
byId("training-recovery").addEventListener("change", () => { followup.recovery = byId("training-recovery").value; renderSuggestion(); });
byId("training-notes").addEventListener("input", () => { followup.notes = byId("training-notes").value; });
dateInput.addEventListener("change", () => updateBlockActions());
byId("confirm-training-loads").addEventListener("click", () => {
  for (const load of Object.values(followup.loads)) if (loadIsReady(load)) load.confirmed = true;
  renderLoads(routine?.blocks.find((block) => block.id === activeBlock)); renderSuggestion();
});
byId("copy-ems-values").addEventListener("click", () => {
  const reference = referenceRecord(); if (!reference || reference.pending) return;
  const key = recordKey(); scanVersions.set(key, (scanVersions.get(key) ?? 0) + 1); referencePhotos.delete(key);
  if (pendingScan && jobIsSelected(pendingScan.job)) pendingScan = undefined;
  setRecordValues(Object.fromEntries(Object.entries(reference.values).filter(([id]) => inputs.has(id))));
  followup.sources[key] = { method: "confirmed", reviewed: true, reference: reference.label };
  scanMessages.delete(key); showBlock();
});
byId("review-ems-values").addEventListener("click", () => {
  rememberBlock(); const source = followup.sources[recordKey()]; if (source) source.reviewed = true; updateBlockActions();
});
byId("next-ems-record").addEventListener("click", () => {
  rememberBlock();
  if (hasRounds(activeBlock) && activeRound < draft[activeBlock].rounds.length - 1) activeRound++;
  else { const next = definitions[definitions.findIndex(([id]) => id === activeBlock) + 1]; if (!next) return; activeBlock = next[0]; activeRound = 0; }
  roundSelections.set(activeBlock, activeRound); blockPicker.value = activeBlock; error.hidden = true; showBlock(); blockPicker.focus();
});

function editSession(existing = null) {
  referencePhotos.clear();
  scanVersions.clear();
  scanMessages.clear();
  roundSelections.clear();
  session = existing;
  const cycle = client.trainingCycles?.find((item) => item.id === client.activeCycleId);
  routine = structuredClone(existing ? existing.routine : cycle?.routine);
  cycleId = existing ? existing.cycleId : cycle?.id;
  definitions = blockDefinitions(routine);
  blockPicker.replaceChildren(...definitions.map(([id, label]) => new Option(label, id)));
  followup = structuredClone(existing?.followup ?? { recovery: "", notes: "", loads: {}, feedback: {}, sources: {} });
  followup.loads ??= {}; followup.feedback ??= {}; followup.sources ??= {};
  draft = structuredClone(existing?.blocks ?? {});
  for (const [id, values] of Object.entries(draft)) {
    if (hasRounds(id) && !values.rounds) {
      draft[id] = { rounds: Array.from({ length: routine?.blocks.find((block) => block.id === id)?.rounds ?? roundDefault(id) }, (_, index) => index === 0 ? values : {}) };
    }
  }
  dateInput.value = existing?.date ?? today();
  if (!existing && cycleId) followup.loads = latestLoads(client.emsSessions ?? [], currentSession());
  byId("training-recovery").value = followup.recovery ?? "";
  byId("training-notes").value = followup.notes ?? "";
  byId("training-session-label").textContent = routine ? routine.title + " · copia de la rutina del ciclo" : "Registro sin rutina vinculada";
  activeBlock = definitions.find(([id]) => draft[id])?.[0] ?? definitions[0][0];
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
byId("open-training-cycle").addEventListener("click", () => openCycleEditor(client, (updated) => { client = updated; onSave(client); showOverview(); feedback.textContent = "Ciclo preparado. Pulsa Iniciar sesión."; }));
byId("open-training-report").addEventListener("click", () => { void openTrainingReport(client); });
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
    delete followup.sources[key];
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
  delete followup.sources[key];
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
  if (count) followup.sources[recordId(job.block, job.round)] = { method: "photo", reviewed: false };
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
  byId("finish-ems-session").disabled = true;
  cancelButton.disabled = true;
  updateBlockActions();
  error.hidden = true;
  rememberBlock();
  try {
    const showReport = event.submitter?.id === "finish-ems-session";
    const before = new Set((client.emsSessions ?? []).map((item) => item.id));
    followup.completed = showReport || Boolean(followup.completed);
    client = await saveEmsSession(currentSession(), client, session);
    const saved = client.emsSessions?.find((item) => session ? item.id === session.id : !before.has(item.id));
    onSave(client);
    showOverview();
    feedback.textContent = "Intensidades guardadas.";
    newButton.focus();
    if (showReport && saved) await openTrainingReport(client, saved.id);
  } catch (failure) {
    error.textContent = failure.message || "No se han podido guardar las intensidades.";
    error.hidden = false;
  } finally {
    saveButton.disabled = false;
    byId("finish-ems-session").disabled = false;
    cancelButton.disabled = false;
    updateBlockActions();
  }
});
