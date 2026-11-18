import {
  clientCode,
  decodeBackup,
  encodeBackup,
  goals,
  listClients,
  restoreBackup,
  saveClient,
  statuses,
  today,
} from "./client-store.js";
import { openEmsPanel } from "./ems-panel.js";

const byId = (id) => document.getElementById(id);
const creator = byId("new-client");
const search = byId("search");
const statusFilter = byId("status-filter");
const clientList = byId("client-list");
const directoryError = byId("directory-error");
const feedback = byId("feedback");
const editor = byId("client-dialog");
const form = byId("client-form");
const saveButton = byId("save-client");
const clientError = byId("client-error");
const backupDialog = byId("backups-dialog");
const backupInput = byId("backup-file");
const backupSummary = byId("backup-summary");
const backupError = byId("backup-error");
const restoreButton = byId("restore-backup");
const installButton = byId("install-button");

let clients = [];
let editing = null;
let pendingBackup = null;
let installPrompt = null;

function addOptions(select, values) {
  for (const value of values) select.add(new Option(value, value));
}

function announce(element, message = "") {
  element.textContent = message;
  if (element !== feedback) element.hidden = !message;
}

function normalize(text) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
}

function matches(client, query) {
  if (statusFilter.value && client.status !== statusFilter.value) return false;
  const details = normalize([client.name, client.phone, clientCode(client.id)].join(" "));
  if (details.includes(query)) return true;
  const phoneQuery = /^[+\d(). -]+$/.test(query) ? query.replace(/\D/g, "") : "";
  return phoneQuery !== "" && client.phone.replace(/\D/g, "").includes(phoneQuery);
}

function makeText(tag, className, value) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function rowFor(client) {
  const row = document.createElement("li");
  row.className = "client-row";
  const person = document.createElement("div");
  person.className = "client-person";
  const open = makeText("button", "client-name", client.name);
  open.type = "button";
  open.setAttribute("aria-label", "Ver intensidades EMS de " + client.name);
  open.setAttribute("aria-haspopup", "dialog");
  open.addEventListener("click", () => openEmsPanel(client, refreshList));
  person.append(
    open,
    makeText("span", "client-code", clientCode(client.id)),
  );
  const state = makeText("span", "state-pill", client.status);
  state.dataset.state = client.status;
  const edit = makeText("button", "button secondary edit-button", "Editar");
  edit.type = "button";
  edit.setAttribute("aria-label", "Editar ficha de " + client.name);
  edit.addEventListener("click", () => openEditor(client));
  row.append(
    person,
    makeText("span", "client-phone", client.phone),
    makeText("span", "client-goal", client.goal || "Por definir"),
    state,
    edit,
  );
  return row;
}

function renderList() {
  const query = normalize(search.value.trim());
  const visible = clients.filter((client) => matches(client, query));
  const filtered = Boolean(query || statusFilter.value);
  const count = clients.length + (clients.length === 1 ? " cliente" : " clientes");
  byId("client-count").textContent = filtered ? visible.length + " de " + count : count;
  byId("directory-head").hidden = visible.length === 0;
  clientList.hidden = visible.length === 0;
  clientList.replaceChildren(...visible.map(rowFor));
  byId("empty-state").hidden = visible.length > 0;
  byId("empty-title").textContent = filtered ? "No se encontraron fichas" : "Aún no hay clientes";
  byId("empty-text").textContent = filtered
    ? "Cambia la búsqueda o el filtro de estado."
    : "Usa «Nuevo cliente» para crear tu primera ficha.";
  byId("clear-filters").hidden = !filtered;
}

async function refreshList() {
  try {
    clients = (await listClients()).sort((left, right) => right.id - left.id);
    announce(directoryError);
    renderList();
    creator.disabled = false;
  } catch {
    creator.disabled = true;
    clientList.hidden = true;
    byId("directory-head").hidden = true;
    byId("empty-state").hidden = true;
    byId("client-count").textContent = "Fichas no disponibles";
    announce(directoryError, "No se han podido abrir las fichas. Comprueba que el navegador permite el almacenamiento de este sitio y vuelve a cargar la app.");
  }
}

function openEditor(client = null) {
  editing = client;
  form.reset();
  announce(clientError);
  byId("client-dialog-title").textContent = client ? "Editar cliente" : "Nuevo cliente";
  byId("client-meta").textContent = client
    ? clientCode(client.id) + " · Alta el " + client.joinedOn.split("-").reverse().join("/")
    : "Introduce los datos de la ficha.";
  saveButton.textContent = client ? "Guardar cambios" : "Guardar cliente";
  if (client) {
    byId("client-name").value = client.name;
    byId("client-phone").value = client.phone;
    byId("client-goal").value = client.goal;
    byId("client-status").value = client.status;
    byId("client-notes").value = client.notes;
  }
  editor.showModal();
  byId("client-name").focus();
}

addOptions(statusFilter, statuses);
addOptions(byId("client-status"), statuses);
addOptions(byId("client-goal"), goals);
creator.addEventListener("click", () => openEditor());
search.addEventListener("input", renderList);
statusFilter.addEventListener("change", renderList);
byId("clear-filters").addEventListener("click", () => {
  search.value = "";
  statusFilter.value = "";
  renderList();
  search.focus();
});
byId("cancel-client").addEventListener("click", () => editor.close());
editor.addEventListener("cancel", (event) => {
  if (saveButton.disabled) event.preventDefault();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  const previous = editing;
  saveButton.disabled = true;
  byId("cancel-client").disabled = true;
  announce(clientError);
  try {
    const values = Object.fromEntries(new FormData(form));
    const id = await saveClient(values, previous);
    editor.close();
    if (!previous) {
      search.value = "";
      statusFilter.value = "";
    }
    await refreshList();
    announce(feedback, "Ficha " + clientCode(id) + (previous ? " actualizada." : " creada."));
  } catch (error) {
    announce(clientError, error.message || "No se ha podido guardar la ficha.");
  } finally {
    saveButton.disabled = false;
    byId("cancel-client").disabled = false;
  }
});

byId("backups-button").addEventListener("click", () => {
  pendingBackup = null;
  backupInput.value = "";
  restoreButton.hidden = true;
  announce(backupError);
  announce(backupSummary);
  backupDialog.showModal();
});
byId("close-backups").addEventListener("click", () => backupDialog.close());
byId("export-backup").addEventListener("click", async () => {
  announce(backupError);
  try {
    const data = encodeBackup(await listClients());
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "registro-ems-copia-" + today() + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    announce(backupError, "No se ha podido descargar la copia.");
  }
});

byId("choose-backup").addEventListener("click", () => backupInput.click());
backupInput.addEventListener("change", async () => {
  const file = backupInput.files[0];
  pendingBackup = null;
  restoreButton.hidden = true;
  announce(backupSummary);
  announce(backupError);
  if (!file) return;
  try {
    const decoded = decodeBackup(await file.text());
    if (backupInput.files[0] !== file || !backupDialog.open) return;
    pendingBackup = decoded;
    const description = decoded.length + (decoded.length === 1 ? " ficha." : " fichas.");
    announce(backupSummary, "La copia contiene " + description + " Al restaurarla se sustituirán las fichas de este dispositivo.");
    restoreButton.hidden = false;
  } catch (error) {
    const message = error instanceof SyntaxError ? "El archivo seleccionado no es una copia válida." : error.message;
    announce(backupError, message);
  }
});

restoreButton.addEventListener("click", async () => {
  if (!pendingBackup || restoreButton.disabled) return;
  restoreButton.disabled = true;
  announce(backupError);
  try {
    await restoreBackup(pendingBackup);
    pendingBackup = null;
    backupDialog.close();
    search.value = "";
    statusFilter.value = "";
    await refreshList();
    announce(feedback, "Copia restaurada.");
  } catch {
    announce(backupError, "No se ha podido restaurar la copia.");
  } finally {
    restoreButton.disabled = false;
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.hidden = true;
  announce(feedback, "Aplicación instalada.");
});

installButton.hidden = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
installButton.addEventListener("click", async () => {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      return;
    } catch {
      // The browser can withdraw an installation prompt.
    }
  }
  const device = navigator.userAgent;
  let instructions = "En Chrome o Edge, abre el menú del navegador y elige la opción para instalar la página como aplicación.";
  if (/Android/i.test(device)) {
    instructions = "Abre el menú ⋮ de Chrome y toca «Instalar aplicación» o «Añadir a pantalla de inicio».";
  } else if (/iPhone|iPad|iPod/i.test(device) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    instructions = "En Safari, toca Compartir y elige «Añadir a pantalla de inicio». Activa «Abrir como app» si aparece.";
  }
  byId("install-instructions").textContent = instructions;
  byId("install-dialog").showModal();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=15", { updateViaCache: "none" }).catch((error) => {
    console.warn("No se pudo preparar el uso sin conexión.", error);
  });
}

window.addEventListener("focus", () => { void refreshList(); });
void refreshList();
