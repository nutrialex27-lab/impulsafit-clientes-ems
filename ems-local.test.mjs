import test from "node:test";
import assert from "node:assert/strict";
import { activeWork, decodeLocalWork, draftId, readLocalDraft, saveLocalDraft } from "./ems-local.js";
import { draftPrefix } from "./ems-storage.js";

const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key), key: (index) => [...memory.keys()][index], get length() { return memory.size; } };
const client = { id: 1, trainingCycles: [] };
const snapshot = () => ({ id: draftId(1, "session-a"), clientId: 1, sessionId: "session-a", baseRevision: null, dirty: true,
  payload: { id: "session-a", date: "2026-11-19", blocks: { fullBody: { rounds: [{ master: "7,", extra1: "0" }, {}] } }, followup: { notes: "Sin terminar" } },
  selection: { block: "fullBody", round: 1, rounds: [["fullBody", 1]] }, photoIds: [] });

test("a synchronous draft survives suspension before an IndexedDB write can finish, including partial input", async () => {
  const input = snapshot();
  const pending = saveLocalDraft(input);
  const fast = JSON.parse(memory.get(draftPrefix + input.id));
  assert.equal(fast.payload.blocks.fullBody.rounds[0].master, "7,");
  assert.equal(activeWork().id, input.id);
  input.payload.blocks.fullBody.rounds[0].master = "999";
  await pending; // This Node test has no IndexedDB; the durable fast copy must remain usable.
  const recovered = await readLocalDraft(input.id);
  assert.equal(recovered.payload.blocks.fullBody.rounds[0].master, "7,");
  assert.equal(recovered.payload.blocks.fullBody.rounds[0].extra1, "0");
  assert.equal(recovered.selection.round, 1);
});

test("a storage failure is reported when neither storage can keep the draft", async () => {
  const old = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("No space"); };
  await assert.rejects(saveLocalDraft(snapshot()));
  localStorage.setItem = old;
});

test("v5 working data restores photo bytes, review status and raw drafts without inventing intensities", async () => {
  const draft = { ...snapshot(), updatedAt: 123 };
  const input = { drafts: [draft], captures: [{ id: "session-a", clientId: 1, date: "2026-11-19", photoCount: 999, reviewedCount: 999 }], photos: [
    { id: "photo-a", clientId: 1, captureId: "session-a", position: 0, reviewed: true, assignment: { block: "fullBody", round: 1 }, data: "data:image/jpeg;base64,AQID" },
    { id: "photo-b", clientId: 1, captureId: "session-a", position: 1, reviewed: false, data: "data:image/png;base64,BAUG" },
  ] };
  const restored = decodeLocalWork(input, [client]);
  assert.deepEqual([...new Uint8Array(await restored.photos[0].blob.arrayBuffer())], [1, 2, 3]);
  assert.equal(restored.photos[0].blob.type, "image/jpeg");
  assert.equal(restored.captures[0].photoCount, 2);
  assert.equal(restored.captures[0].reviewedCount, 1);
  assert.equal(restored.drafts[0].payload.blocks.fullBody.rounds[0].master, "7,");
  assert.deepEqual(restored.photos[0].assignment, { block: "fullBody", round: 1 });
  assert.equal(Object.hasOwn(restored.photos[1], "assignment"), false);
  const otherClient = structuredClone(input); otherClient.photos[0].clientId = 2;
  assert.throws(() => decodeLocalWork(otherClient, [client]), /foto inválida/);
  const duplicate = structuredClone(input); duplicate.photos.push(duplicate.photos[0]);
  assert.throws(() => decodeLocalWork(duplicate, [client]), /foto inválida/);
  const invalid = structuredClone(input); invalid.photos[0].data = "data:text/html;base64,AQID";
  assert.throws(() => decodeLocalWork(invalid, [client]), /foto inválida/);
});
