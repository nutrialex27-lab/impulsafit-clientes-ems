import { blocks, channels } from "./ems-sessions.js";
import { compareKey, cycleEnd, formatLoad, hasSessionData, previousSession, recordId, valuesFor } from "./ems-training.js";

export function reportData(client, options) {
  const history = (client.emsSessions ?? []).filter(hasSessionData).map((session, order) => ({ ...session, order }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const cycle = client.trainingCycles?.find((item) => item.id === (options.cycleId ?? client.activeCycleId));
  const target = history.find((item) => item.id === options.sessionId) ?? history.at(-1);
  let selected;
  if (options.mode === "month") selected = history.filter((item) => item.date.startsWith(options.month + "-"));
  else if (options.mode === "cycle") selected = history.filter((item) => item.cycleId === cycle?.id && cycle);
  else selected = target ? [target] : [];
  const anchor = selected.at(-1);
  const blockId = options.blockId ?? anchor?.routine?.blocks.find((block) => block.ems)?.id ?? "fullBody";
  const round = options.round ?? 0;
  if (options.mode === "session" && anchor) {
    const previous = previousSession(history, anchor, blockId, round);
    if (previous) selected = [previous, anchor];
  }
  const comparable = anchor ? selected.filter((item) => compareKey(item, blockId, round) === compareKey(anchor, blockId, round)) : [];
  const fieldIds = ["master", ...new Set(options.channels ?? ["quads", "dorsal"])].filter((id) => id === "master" || channels.some(([key]) => key === id)).slice(0, 4);
  const series = fieldIds.map((field) => ({ field, label: field === "master" ? "Máster" : channels.find(([id]) => id === field)[1],
    points: comparable.map((session) => {
      const source = session.followup?.sources?.[recordId(blockId, round)];
      const pending = source?.method === "photo" && !source.reviewed;
      const value = valuesFor(session, blockId, round)[field];
      return { date: session.date, id: session.id, value: pending || !Number.isFinite(value) ? null : value, pending };
    }) }));
  const loadSessions = options.mode === "session" ? [anchor].filter(Boolean) : comparable;
  const loads = [];
  for (const block of anchor?.routine?.blocks ?? []) for (const exercise of block.exercises) {
    const records = loadSessions.map((session) => session.followup?.loads?.[exercise.id]).filter((load) => load?.confirmed);
    if (records.length) loads.push({ name: exercise.name, first: formatLoad(records[0]), last: formatLoad(records.at(-1)) });
  }
  const period = options.mode === "month" ? options.month : options.mode === "cycle" && cycle ? cycle.startDate + " al " + cycleEnd(cycle) : anchor?.date ?? "";
  return { title: options.mode === "month" ? "Evolución mensual" : options.mode === "cycle" ? "Tu ciclo de cuatro semanas" : "Resumen de sesión",
    name: client.name, code: "EMS-" + String(client.id).padStart(4, "0"), period,
    routine: anchor?.routine?.title ?? "Histórico EMS", legacy: Boolean(anchor && !anchor.routine),
    block: anchor?.routine?.blocks.find((block) => block.id === blockId)?.name ?? blocks.find(([id]) => id === blockId)?.[1] ?? blockId,
    round: round + 1, sessions: options.mode === "session" ? Number(Boolean(anchor)) : selected.length,
    planned: options.mode === "cycle" && cycle ? cycle.frequency * 4 : null,
    comparable: comparable.length, excluded: Math.max(0, selected.length - comparable.length), series, loads,
    pending: comparable.filter((item) => item.followup?.sources?.[recordId(blockId, round)]?.method === "photo" && !item.followup.sources[recordId(blockId, round)].reviewed).length,
    recovery: anchor?.followup?.recovery ?? "", sensation: anchor?.followup?.feedback?.[blockId]?.sensation,
    notes: options.mode === "session" ? anchor?.followup?.notes ?? "" : "",
  };
}

export function drawReport(canvas, data) {
  const width = 1080, chartHeight = 320, loadRows = data.loads.slice(0, 10);
  canvas.width = width; canvas.height = 560 + data.series.length * chartHeight + (loadRows.length ? 110 + loadRows.length * 74 + (data.loads.length > loadRows.length ? 40 : 0) : 0) + (data.notes ? 140 : 0);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f1eafa"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const write = (text, x, y, size = 28, color = "#281b3a", bold = false) => {
    ctx.font = (bold ? "700 " : "400 ") + size + "px system-ui, sans-serif"; ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  const fit = (text, max = 76) => text.length > max ? text.slice(0, max - 1) + "…" : text;
  ctx.fillStyle = "#281b3a"; ctx.fillRect(0, 0, width, 150);
  write("ImpulsaFit", 50, 64, 42, "#49d3c8", true); write(data.title, 50, 116, 36, "white", true);
  write(fit(data.name, 43), 50, 205, 40, "#281b3a", true);
  write(data.code + " · " + data.period, 50, 250, 28);
  write(fit(data.routine, 66), 50, 292, 28);
  write(data.sessions + (data.planned ? "/" + data.planned : "") + " sesiones registradas · " + data.block + " · vuelta " + data.round, 50, 336, 28);
  let top = 375;
  for (const series of data.series) {
    ctx.fillStyle = "white"; ctx.fillRect(40, top, 1000, chartHeight - 20);
    write(series.label + " · mA", 70, top + 47, 32, "#281b3a", true);
    const points = series.points, recorded = points.filter((point) => point.value != null);
    if (!recorded.length) write("Sin valores confirmados para esta selección", 70, top + 160, 28, "#5e506d");
    else {
      const maximum = Math.max(10, Math.ceil(Math.max(...recorded.map((point) => point.value)) / 10) * 10);
      const left = 130, right = 975, upper = top + 100, lower = top + 235;
      for (let part = 0; part <= 2; part++) {
        const y = lower - (lower - upper) * part / 2;
        ctx.strokeStyle = "#e0d4ec"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        write(String(maximum * part / 2), 65, y + 8, 22, "#5e506d");
      }
      const xFor = (index) => points.length === 1 ? (left + right) / 2 : left + index * (right - left) / (points.length - 1);
      let previous;
      points.forEach((point, index) => {
        const x = xFor(index);
        if (index % Math.max(1, Math.ceil(points.length / 8)) === 0 || index === points.length - 1) write(point.date.slice(8) + "/" + point.date.slice(5, 7), x - 32, lower + 40, 23, "#5e506d");
        if (point.value == null) { previous = undefined; return; }
        const y = lower - (lower - upper) * point.value / maximum;
        ctx.strokeStyle = "#6535a8"; ctx.lineWidth = 5;
        if (previous) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(x, y); ctx.stroke(); }
        ctx.fillStyle = "#6535a8"; ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fill();
        if (points.length <= 10) write(String(point.value).replace(".", ","), x - 16, y - 18, 25, "#542990", true);
        previous = { x, y };
      });
    }
    top += chartHeight;
  }
  if (loadRows.length) {
    write("Cargas confirmadas", 50, top + 35, 32, "#281b3a", true); top += 65;
    for (const load of loadRows) { write(fit(load.name, 62), 50, top + 25, 27, "#281b3a", true); write(fit(load.first === load.last ? load.last : load.first + " → " + load.last, 76), 50, top + 58, 25, "#5e506d"); top += 74; }
    if (data.loads.length > loadRows.length) { write("Más ejercicios disponibles en el registro del cliente.", 50, top + 28, 24); top += 40; }
  }
  if (data.notes) { write("Observación", 50, top + 35, 28, "#281b3a", true); write(fit(data.notes, 77), 50, top + 75, 26); top += 100; }
  write("Intensidades registradas; no equivalen a un porcentaje de fuerza.", 50, canvas.height - 82, 25, "#5e506d");
  write(data.excluded || data.pending ? data.excluded + " sesiones no comparables · " + data.pending + " lecturas pendientes de revisión" : data.legacy ? "Histórico sin programa verificado. Vacíos sin estimar." : "Se comparan el mismo bloque, vuelta y programa. Vacíos sin estimar.", 50, canvas.height - 42, 24, "#5e506d");
  return canvas;
}
