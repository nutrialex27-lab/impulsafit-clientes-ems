import { today, clientCode } from "./client-store.js";
import { blockDefinitions, hasRounds, roundDefault } from "./ems-sessions.js";
import { activeWork, appendCapturePhoto, capturePhotos, updateCaptureDate } from "./ems-local.js";

const dialog = document.createElement("dialog");
dialog.className = "photo-inbox-dialog";
dialog.setAttribute("aria-labelledby", "inbox-title");
dialog.innerHTML = `<div class="dialog-heading"><h2 id="inbox-title">Fotos de la sesión</h2><p class="dialog-caption" id="inbox-client"></p></div>
  <section id="inbox-capture"><p class="inbox-intro">Haz las fotos ahora. Los valores los revisas después.</p>
    <label class="ems-field"><span>Fecha de la sesión</span><input id="inbox-date" type="date" required></label>
    <button class="button primary inbox-camera" id="inbox-camera" type="button">Hacer foto</button>
    <button class="button secondary inbox-import" id="inbox-import" type="button">Añadir fotos de la galería</button>
    <input id="inbox-camera-file" type="file" accept="image/*" capture="environment" hidden><input id="inbox-gallery-file" type="file" accept="image/*" multiple hidden>
    <p class="inbox-save-status" id="inbox-status" role="status"></p>
    <p class="training-help">También puedes usar la cámara normal del móvil durante el entrenamiento y añadir las fotos juntas al terminar. No hace falta una foto de cada vuelta si solo quieres conservar algunos momentos.</p>
    <h3 id="inbox-photo-count">Fotos guardadas</h3><div class="inbox-photos" id="inbox-photos"></div><button class="button secondary" id="inbox-values" type="button" hidden>Ver valores registrados</button>
  </section>
  <section id="inbox-review" hidden><p id="inbox-review-label"></p><img id="inbox-review-image" alt="Foto guardada de la pantalla EMS">
    <p class="training-help">Elige a qué registro pertenece. La app no adivina el bloque ni la vuelta.</p>
    <div class="ems-controls"><label class="ems-field"><span>Bloque de esta foto</span><select id="inbox-block"></select></label><label class="ems-field" id="inbox-round-field"><span>Vuelta de esta foto</span><select id="inbox-round"></select></label></div>
    <div class="training-actions"><button class="button secondary" id="inbox-back" type="button">Volver a las fotos</button><button class="button primary" id="inbox-read" type="button" disabled>Leer y revisar</button></div>
  </section>
  <p class="form-error" id="inbox-error" role="alert" hidden></p>
  <div class="dialog-actions"><button class="button secondary" id="inbox-close" type="button">Volver al cliente</button></div>`;
document.body.append(dialog);
const el = (id) => dialog.querySelector("#" + id);
let client, capture, reviewPhoto, callbacks, saving = false, leavingForReview = false, generation = 0;
const urls = new Set();
const imageUrl = (blob) => { const url = URL.createObjectURL(blob); urls.add(url); return url; };
function releaseUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }

function remember() { activeWork({ mode: "photos", clientId: client.id, captureId: capture.id, date: capture.date }); }
function showError(error) { el("inbox-error").textContent = error.message ?? "No se pudo guardar la foto. Vuelve a intentarlo antes de salir."; el("inbox-error").hidden = false; }

async function renderPhotos() {
  const token = generation, id = capture.id;
  const photos = await capturePhotos(id);
  if (!dialog.open || token !== generation || id !== capture.id) return;
  releaseUrls();
  el("inbox-photo-count").textContent = photos.length ? photos.length + (photos.length === 1 ? " foto guardada" : " fotos guardadas") : "Todavía no has añadido fotos";
  const pending = photos.filter((photo) => !photo.reviewed).length;
  el("inbox-status").textContent = photos.length ? "Guardadas en este dispositivo · " + pending + (pending === 1 ? " pendiente de revisar" : " pendientes de revisar") : "Las fotos se guardan automáticamente al añadirlas.";
  const root = el("inbox-photos"); root.replaceChildren();
  for (const [index, photo] of photos.entries()) {
    const button = document.createElement("button"); button.type = "button"; button.className = "inbox-photo";
    const image = document.createElement("img"); image.src = imageUrl(photo.blob); image.alt = "Foto " + (index + 1); image.loading = "lazy";
    const name = document.createElement("strong"); name.textContent = "Foto " + (index + 1);
    const state = document.createElement("span"); state.textContent = photo.reviewed ? "Revisada" : "Revisar después";
    button.append(image, name, state); button.addEventListener("click", () => selectPhoto(photo, index)); root.append(button);
  }
}

function selectPhoto(photo, index) {
  reviewPhoto = photo;
  el("inbox-review-label").textContent = "Foto " + (index + 1) + (photo.reviewed ? " · ya revisada" : " · pendiente de revisar");
  el("inbox-review-image").src = imageUrl(photo.blob);
  const definitions = blockDefinitions(capture.routine).filter(([id]) => capture.routine?.blocks.find((block) => block.id === id)?.ems !== false);
  el("inbox-block").replaceChildren(new Option("Elige el bloque", ""), ...definitions.map(([id, name]) => new Option(name, id)));
  el("inbox-block").value = photo.assignment?.block ?? "";
  renderRounds();
  if (photo.assignment) el("inbox-round").value = photo.assignment.round;
  el("inbox-capture").hidden = true; el("inbox-review").hidden = false; el("inbox-error").hidden = true;
  el("inbox-block").focus();
}

function renderRounds() {
  const block = el("inbox-block").value;
  const count = hasRounds(block) ? client.emsSessions?.find((session) => session.id === capture.id)?.blocks?.[block]?.rounds?.length ?? capture.routine?.blocks.find((item) => item.id === block)?.rounds ?? roundDefault(block) : 1;
  const session = client.emsSessions?.find((item) => item.id === capture.id);
  const readings = hasRounds(block) ? session?.blocks?.[block]?.rounds ?? [] : [session?.blocks?.[block]];
  const populated = (index) => Object.keys(readings[index] ?? {}).length > 0;
  el("inbox-round").replaceChildren(...Array.from({ length: count }, (_, index) => new Option("Vuelta " + (index + 1) + (populated(index) ? " · ya tiene valores" : ""), index)));
  const empty = Array.from({ length: count }, (_, index) => index).find((index) => !populated(index));
  if (empty != null) el("inbox-round").value = empty;
  el("inbox-round-field").hidden = !block || count === 1;
  el("inbox-read").disabled = !block;
}

export async function openPhotoInbox(selectedClient, options = {}, handlers = {}) {
  generation++; client = selectedClient; callbacks = handlers; reviewPhoto = null; leavingForReview = false;
  const cycle = client.trainingCycles?.find((item) => item.id === client.activeCycleId);
  capture = options.capture ?? { id: options.id ?? crypto.randomUUID(), clientId: client.id, date: options.date ?? today(), photoCount: 0, reviewedCount: 0,
    ...(cycle ? { routine: structuredClone(cycle.routine), cycleId: cycle.id } : {}) };
  el("inbox-client").textContent = client.name + " · " + clientCode(client.id);
  el("inbox-date").value = capture.date; el("inbox-date").disabled = Boolean(capture.reviewedCount);
  el("inbox-capture").hidden = false; el("inbox-review").hidden = true; el("inbox-error").hidden = true;
  el("inbox-photos").replaceChildren(); el("inbox-status").textContent = "Abriendo fotos…";
  el("inbox-values").hidden = !client.emsSessions?.some((session) => session.id === capture.id);
  dialog.showModal(); remember();
  try { await renderPhotos(); } catch (error) { showError(error); }
}

el("inbox-block").addEventListener("change", renderRounds);
el("inbox-back").addEventListener("click", () => { el("inbox-review").hidden = true; el("inbox-capture").hidden = false; });
el("inbox-read").addEventListener("click", async () => {
  if (!reviewPhoto || !el("inbox-block").value || saving) return;
  const context = { photo: reviewPhoto, capture: structuredClone(capture), block: el("inbox-block").value, round: Number(el("inbox-round").value) };
  const other = (await capturePhotos(capture.id)).find((photo) => photo.id !== reviewPhoto.id && photo.reviewed && photo.assignment?.block === context.block && photo.assignment.round === context.round);
  if (other && !confirm("Esta vuelta ya tiene otra foto revisada. ¿Quieres sustituir sus valores con esta foto?")) return;
  leavingForReview = true; dialog.close(); callbacks.review?.(context);
});
el("inbox-values").addEventListener("click", () => { leavingForReview = true; dialog.close(); callbacks.values?.(capture); });
el("inbox-close").addEventListener("click", () => { if (!saving) dialog.close(); });
dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
dialog.addEventListener("close", () => { releaseUrls(); if (!leavingForReview) { activeWork(null); callbacks?.close?.(); } });
el("inbox-date").addEventListener("change", async () => {
  el("inbox-error").hidden = true;
  try { if (capture.photoCount) capture = await updateCaptureDate(capture, el("inbox-date").value); else capture = { ...capture, date: el("inbox-date").value }; remember(); }
  catch (error) { el("inbox-date").value = capture.date; showError(error); }
});

for (const [button, input] of [["inbox-camera", "inbox-camera-file"], ["inbox-import", "inbox-gallery-file"]]) {
  let picker;
  el(button).addEventListener("click", () => {
    if (saving) return;
    if (!el("inbox-date").reportValidity()) return;
    capture.date = el("inbox-date").value;
    picker = { client, capture: structuredClone(capture), generation };
    remember(); el(input).value = ""; el(input).click();
  });
  el(input).addEventListener("change", async () => {
    const files = [...(el(input).files ?? [])], job = picker; picker = null;
    if (!files.length || !job) return;
    saving = true;
    for (const id of ["inbox-camera", "inbox-import", "inbox-close", "inbox-date"]) el(id).disabled = true;
    el("inbox-error").hidden = true;
    let saved = 0;
    try {
      for (const file of files) {
        el("inbox-status").textContent = "Guardando foto " + (saved + 1) + " de " + files.length + "…";
        const result = await appendCapturePhoto(job.client, job.capture, file);
        job.capture = result.capture; saved++;
        if (job.generation === generation) capture = result.capture;
      }
      void navigator.storage?.persist?.().catch(() => {});
    } catch (error) {
      showError(new Error(saved + " de " + files.length + " fotos guardadas. " + (error.name === "QuotaExceededError" ? "No queda espacio disponible. Conserva los originales en la galería." : error.message)));
    } finally {
      saving = false;
      for (const id of ["inbox-camera", "inbox-import", "inbox-close"]) el(id).disabled = false;
      el("inbox-date").disabled = Boolean(capture.reviewedCount);
      if (job.generation === generation && dialog.open) { remember(); await renderPhotos().catch(showError); }
    }
  });
}
