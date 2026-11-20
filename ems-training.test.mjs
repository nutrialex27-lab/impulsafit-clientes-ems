import test from "node:test";
import assert from "node:assert/strict";
import { readSession } from "./ems-sessions.js";
import { encodeBackup, decodeBackup } from "./client-store.js";
import { blockSuggestion, compareKey, consumeReceivedRoutine, cycleEnd, decodeRoutine, hasSessionData, latestLoads, previousSession, readCycle, readRoutine, readTrainingDetails, receivedRoutine, routineInbox } from "./ems-training.js";
import { reportData } from "./ems-progress.js";

const routine = () => readRoutine({ id: "routine-1", title: "Rutina de prueba", kind: "metabolic", blocks: [
  { id: "strength", phase: "strength", name: "Fuerza breve", rounds: 3, seconds: 300, on: 20, off: 30, hz: 72, exercises: [{ id: "squat", name: "Sentadilla" }] },
  { id: "fullBody", phase: "fullBody", name: "Full body", rounds: 2, seconds: 720, on: 25, off: 20, hz: 45, exercises: [{ id: "row", name: "Remo con mancuernas" }] },
] });
const cycle = () => readCycle({ id: "cycle-1", startDate: "2026-11-19", frequency: 2, experience: "adapted", routine: routine() });
const session = (id = "a", date = "2026-11-19") => ({ id, date, cycleId: "cycle-1", routine: routine(), blocks: { fullBody: { rounds: [{ master: 40, quads: 0, dorsal: 30 }, { master: 43, dorsal: 31 }] } },
  followup: { recovery: "good", loads: { row: { kg: 5, unit: "each", note: "", confirmed: true } }, feedback: { fullBody: { perception: "low", technique: "good", sensation: 5, zones: { dorsal: "low" } } }, sources: {} } });

test("a confirmed assignment consumes only that incoming routine and preserves a newer handoff", () => {
  const memory = new Map();
  globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  globalThis.window = new EventTarget();
  const storeRoutine = (value) => localStorage.setItem(routineInbox, JSON.stringify({ format: "registro-ems-routine", version: 1, routine: value }));
  storeRoutine(routine());
  assert.equal(receivedRoutine().id, "routine-1");
  assert.equal(consumeReceivedRoutine("another-routine"), false);
  assert.equal(receivedRoutine().id, "routine-1");
  let assigned = 0; window.addEventListener("ems-routine-assigned", () => assigned++);
  assert.equal(consumeReceivedRoutine("routine-1"), true);
  assert.equal(receivedRoutine(), null); assert.equal(assigned, 1);
  storeRoutine({ ...routine(), id: "new-routine" });
  assert.equal(consumeReceivedRoutine("routine-1"), false);
  assert.equal(receivedRoutine().id, "new-routine");
  delete globalThis.localStorage; delete globalThis.window;
});

test("a four-week snapshot survives future generator changes and supports repeated phases", () => {
  const input = routine(), frozen = readRoutine(input);
  input.blocks[0].exercises[0].name = "Modificado";
  assert.equal(frozen.blocks[0].exercises[0].name, "Sentadilla");
  assert.equal(cycleEnd(cycle()), "2026-12-16");
  const repeated = { ...routine(), blocks: [...routine().blocks, { ...routine().blocks[1], id: "fullBody-10", exercises: [{ id: "extra", name: "Complemento" }], ems: false }] };
  const normalized = readRoutine(repeated);
  const result = readSession({ date: "2026-11-19", routine: normalized, blocks: { "fullBody-10": { rounds: [{}, { master: 0 }] } } });
  assert.equal(result.blocks["fullBody-10"].rounds[1].master, 0);
  assert.throws(() => readSession({ date: "2026-11-19", blocks: { unknown: { master: 1 } } }));
  assert.throws(() => decodeRoutine({ format: "wrong", version: 1, routine: input }));
});

test("reference weights remain unconfirmed and never become performed loads by copying", () => {
  const previous = session(), current = session("b", "2026-11-26");
  const references = latestLoads([previous], current);
  assert.equal(references.row.kg, 5); assert.equal(references.row.confirmed, false);
  assert.equal(previous.followup.loads.row.confirmed, true);
  const parsed = readTrainingDetails({ ...current, followup: { loads: { row: { kg: "5,5", unit: "each", confirmed: true } } } });
  assert.equal(parsed.followup.loads.row.kg, 5.5);
  assert.equal(hasSessionData({ blocks: {}, followup: { loads: references } }), false);
  assert.equal(hasSessionData({ blocks: {}, followup: parsed.followup }), true);
  assert.throws(() => readTrainingDetails({ ...current, followup: { loads: { notInPlan: { kg: 5 } } } }));
});

test("references use earlier sessions of the same cycle, program and round count", () => {
  const a = session("a"), b = session("b"), c = session("c");
  assert.equal(previousSession([a, b, c], b, "fullBody").id, "a");
  assert.equal(previousSession([a, b, c], a, "fullBody"), undefined);
  const changed = session("d", "2026-11-26"); changed.routine.blocks[1].hz = 50;
  assert.notEqual(compareKey(a, "fullBody"), compareKey(changed, "fullBody"));
  assert.equal(previousSession([a], changed, "fullBody"), undefined);
  changed.routine = routine(); changed.blocks.fullBody.rounds.push({});
  assert.equal(previousSession([a], changed, "fullBody"), undefined);
  changed.blocks = structuredClone(a.blocks); changed.cycleId = "another-cycle";
  assert.equal(previousSession([a], changed, "fullBody"), undefined);
});

test("suggestions require recovery, comparable confirmed data and local feedback", () => {
  const previous = session(), current = session("b", "2026-11-26");
  assert.equal(blockSuggestion(current, previous, "fullBody", "adapted").title, "Valorar un ajuste supervisado");
  assert.match(blockSuggestion(current, previous, "fullBody", "adapted").reason, /Dorsal/);
  current.followup.loads.row.confirmed = false;
  assert.equal(blockSuggestion(current, previous, "fullBody", "adapted").title, "Comprobar las cargas");
  current.followup.loads.row.confirmed = true; current.followup.sources["fullBody:0"] = { method: "photo", reviewed: false };
  assert.equal(blockSuggestion(current, previous, "fullBody", "adapted").title, "Revisar la lectura de la foto");
  current.followup.sources = {}; current.followup.feedback.fullBody.zones.chest = "high";
  assert.equal(blockSuggestion(current, previous, "fullBody", "adapted").title, "Revisar la exigencia");
  current.followup.feedback.fullBody.zones = {}; current.followup.recovery = "discomfort";
  assert.equal(blockSuggestion(current, previous, "fullBody", "adapted").title, "Detener y valorar molestias");
  current.followup.recovery = "good";
  assert.equal(blockSuggestion(current, previous, "fullBody", "adaptation").title, "Revisar adaptación individual");
  assert.match(blockSuggestion(current, previous, "fullBody", "adapted").reason, /No hay valoración local/);
  delete current.routine; delete previous.routine;
  assert.equal(blockSuggestion(current, previous, "fullBody", "adapted").title, "Crear una referencia");
});

test("reports keep zero, leave missing or unreviewed values empty and separate programs", () => {
  const a = session(), b = session("b", "2026-11-26"), changed = session("c", "2026-11-27");
  b.followup.sources["fullBody:0"] = { method: "photo", reviewed: false }; changed.routine.blocks[1].hz = 50;
  changed.followup.loads.row.kg = 7;
  const client = { id: 1, name: "Prueba", emsSessions: [a, changed, b], trainingCycles: [cycle()], activeCycleId: "cycle-1" };
  const result = reportData(client, { mode: "session", sessionId: "b", blockId: "fullBody", round: 0, channels: ["quads", "dorsal"] });
  assert.deepEqual(result.series.find((series) => series.field === "quads").points.map((point) => point.value), [0, null]);
  assert.equal(result.pending, 1);
  const month = reportData(client, { mode: "month", month: "2026-11", blockId: "fullBody", round: 0 });
  assert.equal(month.sessions, 3); assert.equal(month.comparable, 1); assert.equal(month.excluded, 2);
  assert.equal(month.loads[0].first, "7 kg por mancuerna");
});

test("v4 backups preserve cycles, immutable routines, weights, feedback and review state", () => {
  const record = { id: 1, name: "Prueba", phone: "600000000", status: "Activo", joinedOn: "2026-11-19", goal: "", notes: "", trainingCycles: [cycle()], activeCycleId: "cycle-1", emsSessions: [session()] };
  const backup = encodeBackup([record]), restored = decodeBackup(backup)[0];
  assert.deepEqual(restored.trainingCycles, record.trainingCycles);
  assert.equal(restored.emsSessions[0].followup.loads.row.kg, 5);
  assert.equal(restored.emsSessions[0].followup.loads.row.confirmed, true);
  assert.equal(restored.emsSessions[0].followup.feedback.fullBody.zones.dorsal, "low");
  const invalid = JSON.parse(backup); invalid.clients[0].emsSessions[0].routine.blocks[1].hz = 50;
  assert.throws(() => decodeBackup(JSON.stringify(invalid)), /no coincide/);
});
