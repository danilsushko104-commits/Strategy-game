import test from 'node:test';
import assert from 'node:assert/strict';
import { hash32, hash53 } from '../src/hash.mjs';
import { CONTENT_ID, contentMismatch, updateDraft, lockRound, validateRecord } from '../src/rules.mjs';
import { newRecord, storeRecord, readSlot, recoveryOptions, clearSlot, putStored, getStored, teamKey,
  SaveError, markBackup, readBackup, backupBehind } from '../src/storage.mjs';

// Node has no localStorage here, so these tests use the same in-memory fallback the game uses when storage is blocked.
function lockNext(record, choice) {
  const round = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"][record.history.length];
  let next = updateDraft(record, round, "choice", choice, 0);
  next = updateDraft(next, round, "evidence", "evidence", 0);
  next = updateDraft(next, round, "tradeoff", "trade-off", 0);
  return lockRound(next, round, 0);
}

test("Hashes are stable, sensitive to every character and have the expected shape", () => {
  assert.equal(hash32(""), "811c9dc5");
  assert.equal(hash32("a"), "e40c292c");
  assert.notEqual(hash53("R1:A:1"), hash53("R1:B:1"));
  assert.equal(hash53("same"), hash53("same"));
  assert.notEqual(hash53("same", 1), hash53("same", 2));
  assert.match(hash53("anything"), /^[0-9a-z]{11}$/);
});

test("A save remembers the content version, and only a differing stamp counts as a mismatch", () => {
  assert.match(CONTENT_ID, /^[0-9a-f]{8}$/);
  const record = newRecord("practice", "PRACTICE", 1, "indonesia");
  assert.equal(record.content, CONTENT_ID);
  assert.equal(contentMismatch(record), false);
  assert.equal(contentMismatch({...record, content: ""}), false, "saves from before the stamp are not flagged");
  assert.equal(contentMismatch({...record, content: "deadbeef"}), true);
  assert.equal(validateRecord({...record, content: "deadbeef"}).content, "deadbeef");
});

test("The snapshot ring moves one locked decision at a time and ignores draft edits", async () => {
  clearSlot("PRACTICE", 1);
  let record = newRecord("practice", "PRACTICE", 1, "indonesia");
  storeRecord(record);
  record = lockNext(record, "A"); storeRecord(record);
  record = lockNext(record, "desk"); storeRecord(record);
  record = lockNext(record, "pilot"); storeRecord(record);

  let options = await recoveryOptions("PRACTICE", 1);
  assert.deepEqual(options.map(option => option.rounds), [2, 1], "the ring keeps the two previous states");

  const editing = updateDraft(record, "R4", "evidence", "typing…", 0);
  storeRecord(editing);
  storeRecord(updateDraft(editing, "R4", "evidence", "typing more…", 0));
  options = await recoveryOptions("PRACTICE", 1);
  assert.deepEqual(options.map(option => option.rounds), [2, 1], "draft keystrokes do not rotate the ring");
  assert.equal(readSlot("PRACTICE", 1).history.length, 3);
});

test("A damaged save raises a recoverable error and the snapshots can replace it", async () => {
  clearSlot("PRACTICE", 2);
  let record = newRecord("practice", "PRACTICE", 2, "thailand");
  storeRecord(record);
  record = lockNext(record, "B"); storeRecord(record);
  record = lockNext(record, "interview"); storeRecord(record);

  putStored(teamKey("PRACTICE", 2), '{"broken":');
  assert.throws(() => readSlot("PRACTICE", 2), error => error instanceof SaveError && error.team === 2 && error.room === "PRACTICE" && /damaged/.test(error.message));

  const [best] = await recoveryOptions("PRACTICE", 2);
  assert.equal(best.rounds, 1);
  storeRecord(best.record);
  assert.equal(readSlot("PRACTICE", 2).history.length, 1);

  putStored(teamKey("PRACTICE", 2), JSON.stringify({...record, version: "v1"}));
  assert.throws(() => readSlot("PRACTICE", 2), error => error instanceof SaveError && /another game/.test(error.message));
  // A valid save for another table stored under this table's key is rejected too.
  putStored(teamKey("PRACTICE", 2), JSON.stringify(newRecord("practice", "PRACTICE", 1, "indonesia")));
  assert.throws(() => readSlot("PRACTICE", 2), error => error instanceof SaveError && /different table/.test(error.message));
});

test("Clearing a table removes the save, its snapshots and the backup marker", async () => {
  clearSlot("PRACTICE", 3);
  let record = newRecord("practice", "PRACTICE", 3, "vietnam");
  storeRecord(record);
  record = lockNext(record, "A"); storeRecord(record);
  record = lockNext(record, "desk"); storeRecord(record);
  markBackup("PRACTICE", 3, 2, 1000);
  clearSlot("PRACTICE", 3);
  assert.equal(readSlot("PRACTICE", 3), null);
  assert.equal(getStored(teamKey("PRACTICE", 3) + ":bak1"), null);
  assert.deepEqual(await recoveryOptions("PRACTICE", 3), []);
  assert.equal(readBackup("PRACTICE", 3), null);
});

test("Backup bookkeeping measures how far the downloaded file trails the locked decisions", () => {
  assert.equal(readBackup("PRACTICE", 4), null);
  markBackup("PRACTICE", 4, 3, 123456);
  assert.deepEqual(readBackup("PRACTICE", 4), {rounds: 3, at: 123456});
  putStored(teamKey("PRACTICE", 4).replace(":team:", ":backup:"), "not json");
  assert.equal(readBackup("PRACTICE", 4), null);
  assert.equal(backupBehind(0, null), 0);
  assert.equal(backupBehind(2, null), 2);
  assert.equal(backupBehind(5, {rounds: 3}), 2);
  assert.equal(backupBehind(3, {rounds: 5}), 0);
});
