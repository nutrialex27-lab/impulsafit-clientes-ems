import test from "node:test";
import assert from "node:assert/strict";
import { channels, readSession } from "./ems-sessions.js";
import { decodeBackup, encodeBackup } from "./client-store.js";

const date = "2026-11-19";
const complete = (master) => Object.fromEntries([["master", master], ...channels.map(([id], index) => [id, index])]);
const client = (blocks) => ({ id: 1, name: "Prueba", phone: "600000000", status: "Activo", goal: "", notes: "",
  joinedOn: date, revision: "client-revision", emsSessions: [{ id: "session-1", revision: "session-revision", date, blocks }] });

test("each round keeps all eleven values, zeros, decimals and its position", () => {
  const session = readSession({ date, blocks: {
    activation: { master: "40" },
    strength: { rounds: [complete(35), { master: "43", quads: "27,5", extra1: "0" }, complete(50)] },
    fullBody: { rounds: [complete(43), {}, { master: "64", quads: "31,5", extra1: "0" }, complete(70)] },
    core: { rounds: [{ master: 30 }, { master: 35 }] },
    metabolic: { rounds: [{ master: 50 }, {}, { master: 60 }] },
    coolDown: { master: "12" },
  } });
  assert.equal(session.blocks.fullBody.rounds[0].master, 43);
  assert.deepEqual(session.blocks.strength.rounds, [complete(35), { master: 43, quads: 27.5, extra1: 0 }, complete(50)]);
  assert.deepEqual(session.blocks.fullBody.rounds[1], {});
  assert.deepEqual(session.blocks.fullBody.rounds[2], { master: 64, quads: 31.5, extra1: 0 });
  assert.deepEqual(session.blocks.fullBody.rounds[3], complete(70));
  assert.deepEqual(session.blocks.core.rounds, [{ master: 30 }, { master: 35 }]);
  assert.equal(session.blocks.metabolic.rounds[2].master, 60);
  assert.deepEqual(session.blocks.activation, { master: 40 });
  assert.deepEqual(session.blocks.coolDown, { master: 12 });
});

test("old block values become only round one without changing the original record", () => {
  const legacy = { fullBody: complete(64), core: { master: 0 }, metabolic: { quads: 20 }, strength: { master: 40 } };
  const before = structuredClone(legacy);
  const { blocks } = readSession({ date, blocks: legacy });
  for (const [id, count] of [["strength", 3], ["fullBody", 4], ["core", 4], ["metabolic", 3]]) {
    assert.equal(blocks[id].rounds.length, count);
    assert.deepEqual(blocks[id].rounds[0], before[id]);
    assert.ok(blocks[id].rounds.slice(1).every((round) => Object.keys(round).length === 0));
  }
  assert.deepEqual(legacy, before);
});

test("empty rounds do not create blocks and resetting one does not discard another", () => {
  const remaining = readSession({ date, blocks: { fullBody: { rounds: [{}, {}, { master: 64 }] }, core: { rounds: [{}, {}] } } });
  assert.deepEqual(remaining.blocks, { fullBody: { rounds: [{}, {}, { master: 64 }] } });
  assert.deepEqual(readSession({ date, blocks: { fullBody: { rounds: [{}, {}, {}] } } }, { allowEmpty: true }).blocks, {});
  assert.throws(() => readSession({ date, blocks: { fullBody: { rounds: [{}] } } }), /al menos un valor/);
});

test("invalid rounds fail without silently truncating data", () => {
  for (const rounds of [[], "bad", [null], Array.from({ length: 101 }, () => ({}))]) {
    assert.throws(() => readSession({ date, blocks: { fullBody: { rounds } } }));
  }
  assert.throws(() => readSession({ date, blocks: { fullBody: { rounds: [{ master: 40 }], master: 64 } } }));
  assert.throws(() => readSession({ date, blocks: { core: { rounds: [{}, { master: -1 }] } } }), /Core · vuelta 2 · Máster/);
  for (const id of ["activation", "coolDown"]) {
    assert.throws(() => readSession({ date, blocks: { [id]: { rounds: [{ master: 40 }, { master: 64 }] } } }), /una sola toma/);
  }
});

test("backups preserve every round and restore legacy v1 and v2 copies", () => {
  const blocks = readSession({ date, blocks: { strength: { rounds: [complete(35), {}, complete(50)] }, fullBody: { rounds: [complete(40), {}, complete(64)] }, activation: { master: 25 } } }).blocks;
  const encoded = encodeBackup([client(blocks)]);
  const backup = JSON.parse(encoded);
  assert.equal(backup.version, 3);
  assert.equal(backup.clients[0].revision, undefined);
  assert.equal(backup.clients[0].emsSessions[0].revision, undefined);
  assert.deepEqual(decodeBackup(encoded)[0].emsSessions[0].blocks, blocks);
  const v2 = { format: backup.format, version: 2, clients: [client({ strength: complete(35), fullBody: complete(64) })] };
  const restored = decodeBackup(JSON.stringify(v2))[0];
  assert.deepEqual(restored.emsSessions[0].blocks.strength.rounds, [complete(35), {}, {}]);
  assert.deepEqual(restored.emsSessions[0].blocks.fullBody.rounds[0], complete(64));
  assert.ok(restored.emsSessions[0].blocks.fullBody.rounds.slice(1).every((round) => !Object.keys(round).length));
  assert.deepEqual(decodeBackup(JSON.stringify({ ...v2, version: 1 }))[0].emsSessions, []);
});
