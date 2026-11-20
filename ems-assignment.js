import { clientCode, listClients } from "./client-store.js";
import { receivedRoutine } from "./ems-training.js";
import { openCycleEditor } from "./ems-cycle.js";

const dialog = document.createElement("dialog");
dialog.className = "routine-assignment-dialog";
dialog.setAttribute("aria-labelledby", "assignment-title");
dialog.innerHTML = `<div class="dialog-heading"><h2 id="assignment-title">Elegir cliente</h2><p class="dialog-caption" id="assignment-routine"></p></div>
  <p class="training-help">Selecciona la ficha que recibirá esta rutina.</p>
  <label class="ems-field"><span>Buscar cliente</span><input id="assignment-search" type="search" placeholder="Nombre, móvil o código" autocomplete="off"></label>
  <ul class="assignment-clients" id="assignment-clients"></ul><p class="training-help" id="assignment-empty" hidden></p>
  <p class="form-error" id="assignment-error" role="alert" hidden></p>
  <div class="dialog-actions"><button class="button secondary" id="assignment-cancel" type="button">Cancelar</button><button class="button secondary" id="assignment-create" type="button" hidden>Crear cliente</button></div>`;
document.body.append(dialog);
const el = (id) => dialog.querySelector("#" + id);
let clients = [], routine, handlers, selecting = false, generation = 0;
const normalize = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");

function render() {
  const query = normalize(el("assignment-search").value.trim());
  const matches = clients.filter((client) => normalize([client.name, client.phone, clientCode(client.id)].join(" ")).includes(query));
  const root = el("assignment-clients"); root.replaceChildren();
  for (const client of matches) {
    const row = document.createElement("li"), button = document.createElement("button");
    button.type = "button"; button.className = "assignment-client";
    const name = document.createElement("strong"), code = document.createElement("span");
    name.textContent = client.name; code.textContent = clientCode(client.id);
    button.append(name, code); button.addEventListener("click", () => { void selectClient(client.id); }); row.append(button); root.append(row);
  }
  el("assignment-empty").hidden = matches.length > 0;
  el("assignment-empty").textContent = clients.length ? "No hay coincidencias con esa búsqueda." : "Aún no hay clientes en este navegador. Crea una ficha para asignarle la rutina.";
  el("assignment-create").hidden = clients.length > 0;
}

async function selectClient(id) {
  if (selecting) return;
  selecting = true; const token = generation;
  try {
    const current = (await listClients()).find((client) => client.id === id);
    if (!dialog.open || token !== generation) return;
    if (!current) throw new Error("La ficha ya no existe. Vuelve a elegir un cliente.");
    if (receivedRoutine()?.id !== routine.id) throw new Error("Ha llegado otra rutina. Cierra esta ventana y vuelve a elegir el cliente.");
    dialog.close();
    openCycleEditor(current, (updated) => { handlers.assigned?.(updated); }, { routine });
  } catch (error) { el("assignment-error").textContent = error.message; el("assignment-error").hidden = false; }
  finally { selecting = false; }
}

export async function chooseRoutineClient(callbacks) {
  if (dialog.open) return true;
  if (document.querySelector("dialog[open]")) return false;
  const incoming = receivedRoutine(); if (!incoming) return false;
  generation++; const token = generation; handlers = callbacks; routine = incoming; clients = [];
  el("assignment-routine").textContent = routine.title;
  el("assignment-search").value = ""; el("assignment-error").hidden = true; el("assignment-create").hidden = true;
  el("assignment-clients").replaceChildren(); el("assignment-empty").hidden = false; el("assignment-empty").textContent = "Cargando clientes…";
  dialog.showModal(); el("assignment-search").focus();
  try { clients = await listClients(); if (token === generation && dialog.open) render(); }
  catch (error) { el("assignment-error").textContent = error.message; el("assignment-error").hidden = false; }
  return true;
}

el("assignment-search").addEventListener("input", render);
el("assignment-cancel").addEventListener("click", () => dialog.close());
el("assignment-create").addEventListener("click", () => { dialog.close(); handlers.create?.(); });
