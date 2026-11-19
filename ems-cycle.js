import { saveTrainingCycle, today } from "./client-store.js";
import { cycleEnd, decodeRoutine, receivedRoutine } from "./ems-training.js";

const dialog = document.createElement("dialog");
dialog.className = "training-dialog";
dialog.setAttribute("aria-labelledby", "cycle-title");
dialog.innerHTML = `<form id="cycle-form">
  <div class="dialog-heading"><h2 id="cycle-title">Plan de cuatro semanas</h2><p class="dialog-caption" id="cycle-client"></p></div>
  <p class="training-help">Guarda una copia de la rutina para este cliente. Los cambios posteriores en el generador no modifican este ciclo.</p>
  <div class="training-actions"><button class="button secondary" id="cycle-received" type="button">Usar rutina recibida</button><button class="button secondary" id="cycle-import" type="button">Elegir archivo de rutina</button></div>
  <input id="cycle-file" type="file" accept="application/json,.json" hidden>
  <p class="training-help">En Impulsagen, pulsa «Usar en Registro EMS». También puedes descargar allí el archivo de la rutina para traerlo a otro dispositivo.</p>
  <div id="cycle-preview" class="training-preview" hidden></div>
  <div class="training-fields">
    <label class="ems-field"><span>Nombre del ciclo</span><input id="cycle-name" maxlength="140" required></label>
    <div class="ems-controls"><label class="ems-field"><span>Fecha de inicio</span><input id="cycle-date" type="date" required></label>
    <label class="ems-field"><span>Visitas previstas por semana</span><select id="cycle-frequency"><option value="1">1 · 4 sesiones previstas</option><option value="2">2 · 8 sesiones previstas</option></select></label></div>
    <label class="ems-field"><span>Experiencia con EMS</span><select id="cycle-experience"><option value="">Por revisar</option><option value="adaptation">En familiarización</option><option value="adapted">Cliente adaptado</option></select></label>
  </div>
  <p class="training-help">Las visitas previstas organizan el seguimiento. La intensidad y la recuperación las revisas individualmente.</p>
  <p class="form-error" id="cycle-error" role="alert" hidden></p>
  <div class="dialog-actions"><button class="button secondary" id="cycle-cancel" type="button">Cancelar</button><button class="button primary" id="cycle-save" type="submit">Iniciar ciclo</button></div>
</form>`;
document.body.append(dialog);
const byId = (id) => dialog.querySelector("#" + id);
let client, onSave, routine, saving = false;

function preview(value) {
  routine = value;
  byId("cycle-name").value = routine.title;
  if (routine.profile === "principiante") byId("cycle-experience").value = "adaptation";
  const root = byId("cycle-preview"); root.replaceChildren(); root.hidden = false;
  const title = document.createElement("strong"); title.textContent = routine.title; root.append(title);
  const list = document.createElement("ul");
  for (const block of routine.blocks) {
    const item = document.createElement("li");
    item.textContent = block.name + " · " + block.rounds + (block.rounds === 1 ? " toma" : " vueltas") + " · " + block.exercises.map((exercise) => exercise.name).join("; ");
    list.append(item);
  }
  root.append(list);
}

export function openCycleEditor(selectedClient, update) {
  client = selectedClient; onSave = update; routine = null;
  byId("cycle-client").textContent = client.name;
  byId("cycle-form").reset(); byId("cycle-date").value = today();
  byId("cycle-error").hidden = true; byId("cycle-preview").hidden = true;
  const received = receivedRoutine(); byId("cycle-received").disabled = !received;
  if (received) preview(received);
  dialog.showModal();
}

byId("cycle-cancel").addEventListener("click", () => { if (!saving) dialog.close(); });
dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
byId("cycle-received").addEventListener("click", () => {
  const received = receivedRoutine(); if (received) preview(received);
});
byId("cycle-import").addEventListener("click", () => { byId("cycle-file").value = ""; byId("cycle-file").click(); });
byId("cycle-file").addEventListener("change", async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error("El archivo de rutina es demasiado grande.");
    const imported = decodeRoutine(await file.text());
    if (!dialog.open || event.target.files[0] !== file) return;
    preview(imported); byId("cycle-error").hidden = true;
  } catch (failure) { byId("cycle-error").textContent = failure.message; byId("cycle-error").hidden = false; }
});
byId("cycle-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (saving) return;
  saving = true; byId("cycle-save").disabled = true; byId("cycle-cancel").disabled = true;
  try {
    if (!routine) throw new Error("Trae una rutina de Impulsagen antes de iniciar el ciclo.");
    const updated = await saveTrainingCycle({ startDate: byId("cycle-date").value, frequency: Number(byId("cycle-frequency").value),
      experience: byId("cycle-experience").value, routine: { ...routine, title: byId("cycle-name").value } }, client);
    onSave(updated); dialog.close();
  } catch (failure) { byId("cycle-error").textContent = failure.message; byId("cycle-error").hidden = false; }
  finally { saving = false; byId("cycle-save").disabled = false; byId("cycle-cancel").disabled = false; }
});

export function cycleDescription(cycle) {
  return cycle.startDate.split("-").reverse().join("/") + " – " + cycleEnd(cycle).split("-").reverse().join("/")
    + " · " + cycle.frequency * 4 + " sesiones previstas";
}
