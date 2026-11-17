import { clientCode, saveEmsSession, today } from "./client-store.js";
import { blocks, channels } from "./ems-sessions.js";
import { readWiemsPhoto } from "./ems-ocr.js";

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
const photoButton = byId("ems-photo-button");
const photoFile = byId("ems-photo-file");
const photoStatus = byId("ems-photo-status");
const photoRows = byId("ems-photo-rows");
const photoRow = byId("ems-photo-row");

const inputs = new Map();
let client;
let onSave;
let session;
let draft;
let activeBlock;
let pendingPhoto;

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
  photoStatus.textContent = "";
  photoRows.hidden = true;
  pendingPhoto = undefined;
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

function photoStillOpen(job) {
  return dialog.open && !form.hidden && draft === job.draft;
}

function fillFromPhoto(job, values) {
  if (!photoStillOpen(job)) return;
  if (activeBlock === job.block) rememberBlock();
  const target = draft[job.block];
  const untouched = Object.entries(values).filter(([id]) => target[id] === job.before[id]);
  Object.assign(target, Object.fromEntries(untouched));
  if (activeBlock === job.block) showBlock();
  const label = blockPicker.querySelector('[value="' + job.block + '"]').textContent;
  const count = untouched.length;
  photoStatus.textContent = count
    ? count + " de 11 campos rellenados en " + label + ". Revisa los valores antes de guardar."
    : "Se mantuvieron los valores que editaste durante la lectura.";
  photoRows.hidden = true;
  pendingPhoto = undefined;
}

photoButton.addEventListener("click", () => photoFile.click());

photoFile.addEventListener("change", async () => {
  const file = photoFile.files[0];
  photoFile.value = "";
  if (!file || photoButton.disabled || form.hidden) return;
  rememberBlock();
  const job = { draft, block: activeBlock, before: { ...draft[activeBlock] } };
  photoButton.disabled = true;
  photoStatus.textContent = "Leyendo la foto…";
  photoRows.hidden = true;
  pendingPhoto = undefined;
  try {
    const rows = await readWiemsPhoto(file);
    if (!photoStillOpen(job)) return;
    if (!rows.some((values) => Object.keys(values).length)) {
      photoStatus.textContent = "Usa una foto nítida y de frente en la que se vean los canales y el máster de Wiems PRO.";
      return;
    }
    if (rows.length === 1) {
      fillFromPhoto(job, rows[0]);
      return;
    }
    pendingPhoto = { job, rows };
    photoRow.replaceChildren(new Option("Elige una fila", ""));
    for (const [index, values] of rows.entries()) {
      const count = Object.keys(values).length;
      const option = new Option("Fila " + (index + 1) + " · " + count + " de 11 valores", String(index));
      option.disabled = count === 0;
      photoRow.add(option);
    }
    photoRows.hidden = false;
    photoStatus.textContent = "La foto contiene varias filas de valores.";
  } catch {
    if (photoStillOpen(job)) {
      photoStatus.textContent = "No se pudo leer la foto. Abre la app con conexión y elige una captura JPG o PNG.";
    }
  } finally {
    photoButton.disabled = false;
  }
});

photoRow.addEventListener("change", () => {
  if (pendingPhoto && photoRow.value !== "") {
    fillFromPhoto(pendingPhoto.job, pendingPhoto.rows[Number(photoRow.value)]);
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
