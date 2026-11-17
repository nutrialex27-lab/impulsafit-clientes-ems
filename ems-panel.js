import { clientCode, saveEmsSession, today } from "./client-store.js";
import { blocks, channels } from "./ems-sessions.js";

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

const inputs = new Map();
let client;
let onSave;
let session;
let draft;
let activeBlock;

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
