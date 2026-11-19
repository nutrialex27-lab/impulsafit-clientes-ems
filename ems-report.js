import { today } from "./client-store.js";
import { blockDefinitions } from "./ems-sessions.js";
import { reportData, drawReport } from "./ems-progress.js";

const dialog = document.createElement("dialog");
dialog.className = "training-report-dialog";
dialog.setAttribute("aria-labelledby", "training-report-title");
dialog.innerHTML = `<div class="dialog-heading"><h2 id="training-report-title">Evolución del cliente</h2><p class="dialog-caption">Revisa el informe antes de compartirlo.</p></div>
  <div class="training-fields"><div class="ems-controls"><label class="ems-field"><span>Informe</span><select id="report-mode"><option value="session">Sesión</option><option value="cycle">Ciclo de cuatro semanas</option><option value="month">Mes natural</option></select></label>
  <label class="ems-field" id="report-session-field"><span>Sesión</span><select id="report-session"></select></label><label class="ems-field" id="report-month-field" hidden><span>Mes</span><input id="report-month" type="month"></label><label class="ems-field" id="report-cycle-field" hidden><span>Ciclo</span><select id="report-cycle"></select></label></div>
  <div class="ems-controls"><label class="ems-field"><span>Bloque que comparas</span><select id="report-block"></select></label><label class="ems-field"><span>Vuelta</span><input id="report-round" type="number" min="1" max="100" step="1" value="1"></label></div>
  <label class="ems-field"><span>Canales del informe · hasta 3</span><select id="report-channel-1"></select><select id="report-channel-2"></select><select id="report-channel-3"></select></label></div>
  <p class="training-help" id="report-description"></p><canvas id="report-canvas" role="img" aria-label="Gráficas de intensidades y cargas registradas"></canvas>
  <p class="feedback" id="report-status" role="status"></p><div class="dialog-actions"><button class="button secondary" id="report-close" type="button">Cerrar</button><button class="button secondary" id="report-download" type="button">Descargar imagen</button><button class="button primary" id="report-share" type="button">Compartir por WhatsApp</button></div>`;
document.body.append(dialog);
const byId = (id) => dialog.querySelector("#" + id);
let client, file, revision = 0;

function options(select, choices, selected) {
  select.replaceChildren(...choices.map(([id, label]) => new Option(label, id)));
  if (choices.some(([id]) => id === selected)) select.value = selected;
}

async function refresh(resetBlocks = false) {
  const token = ++revision; file = null; byId("report-share").disabled = true; byId("report-download").disabled = true;
  byId("report-status").textContent = "Preparando imagen…";
  const mode = byId("report-mode").value;
  byId("report-session-field").hidden = mode !== "session"; byId("report-cycle-field").hidden = mode !== "cycle"; byId("report-month-field").hidden = mode !== "month";
  const sessions = client.emsSessions ?? [];
  const eligible = mode === "session" ? sessions.filter((item) => item.id === byId("report-session").value)
    : mode === "cycle" ? sessions.filter((item) => item.cycleId === byId("report-cycle").value) : sessions.filter((item) => item.date.startsWith(byId("report-month").value + "-"));
  const anchor = [...eligible].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const definitions = blockDefinitions(anchor?.routine);
  if (resetBlocks || !definitions.some(([id]) => id === byId("report-block").value)) options(byId("report-block"), definitions, definitions.find(([id]) => id === "fullBody")?.[0] ?? definitions[0][0]);
  const blockId = byId("report-block").value;
  const maximum = anchor?.blocks?.[blockId]?.rounds?.length ?? anchor?.routine?.blocks.find((block) => block.id === blockId)?.rounds ?? 1;
  byId("report-round").max = maximum;
  if (!Number.isInteger(Number(byId("report-round").value)) || Number(byId("report-round").value) < 1) byId("report-round").value = 1;
  if (Number(byId("report-round").value) > maximum) byId("report-round").value = maximum;
  const data = reportData(client, { mode, sessionId: byId("report-session").value, cycleId: byId("report-cycle").value, month: byId("report-month").value,
    blockId, round: Number(byId("report-round").value) - 1, channels: [1, 2, 3].map((index) => byId("report-channel-" + index).value).filter(Boolean) });
  drawReport(byId("report-canvas"), data);
  byId("report-description").textContent = data.sessions + " sesiones registradas. " + data.comparable + " referencias comparables para este bloque y vuelta. " + (data.excluded ? data.excluded + " sesiones de otro programa o ciclo excluidas. " : "") + (data.pending ? data.pending + " lecturas de fotos pendientes, excluidas de las gráficas. " : "") + (data.sensation != null ? "Última sensación de corriente: " + data.sensation + "/10. " : "") + "Los valores ausentes o pendientes de revisar no se convierten en cero.";
  const blob = await new Promise((resolve) => byId("report-canvas").toBlob(resolve, "image/png"));
  if (token !== revision || !dialog.open) return;
  if (!blob) { byId("report-status").textContent = "No se pudo preparar la imagen. Cambia la selección e inténtalo de nuevo."; return; }
  file = new File([blob], "ImpulsaFit_" + data.code + "_" + mode + "_" + today() + ".png", { type: "image/png" });
  byId("report-status").textContent = "Imagen preparada. Elige WhatsApp y confirma el contacto y el envío en tu móvil.";
  byId("report-share").disabled = false; byId("report-download").disabled = false;
}

export async function openTrainingReport(selectedClient, sessionId) {
  client = selectedClient;
  const sessions = [...(client.emsSessions ?? [])].reverse().sort((a, b) => b.date.localeCompare(a.date));
  options(byId("report-session"), sessions.map((item) => [item.id, item.date.split("-").reverse().join("/") + " · " + (item.routine?.title ?? "EMS")]), sessionId ?? sessions[0]?.id);
  options(byId("report-cycle"), [...(client.trainingCycles ?? [])].reverse().map((item) => [item.id, item.startDate + " · " + item.routine.title]), client.activeCycleId);
  byId("report-mode").value = sessionId || !client.activeCycleId ? "session" : "cycle";
  byId("report-month").value = today().slice(0, 7); byId("report-round").value = 1;
  const { channels } = await import("./ems-sessions.js");
  ["quads", "dorsal", ""].forEach((value, index) => options(byId("report-channel-" + (index + 1)), [["", "Sin canal adicional"], ...channels], value));
  dialog.showModal(); await refresh(true);
}

for (const id of ["report-mode", "report-session", "report-cycle", "report-month"]) byId(id).addEventListener("change", () => { void refresh(true); });
for (const id of ["report-block", "report-round", "report-channel-1", "report-channel-2", "report-channel-3"]) byId(id).addEventListener("change", () => { void refresh(); });
byId("report-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => { revision++; file = null; });
byId("report-download").addEventListener("click", () => {
  if (!file) return; const url = URL.createObjectURL(file), link = document.createElement("a");
  link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
});
byId("report-share").addEventListener("click", async () => {
  if (!file) return;
  if (!navigator.canShare?.({ files: [file] })) { byId("report-status").textContent = "Este navegador no comparte imágenes directamente. Descárgala y adjúntala en WhatsApp."; return; }
  try { await navigator.share({ files: [file], title: "Tu seguimiento ImpulsaFit" }); byId("report-status").textContent = "Informe entregado al menú de compartir. El envío lo confirmas en WhatsApp."; }
  catch (failure) { byId("report-status").textContent = failure.name === "AbortError" ? "Envío cancelado. La imagen sigue disponible." : "No se pudo abrir el menú. Puedes descargar la imagen y adjuntarla en WhatsApp."; }
});
