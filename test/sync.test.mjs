import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/scenario.mjs';
import { makeRoom, marketForTable, validateRecord } from '../src/rules.mjs';
import { clearSlot, readSynced } from '../src/storage.mjs';
import { configureSync, buildEvents, flushSync, syncStatus, syncSummary } from '../src/sync.mjs';

const start = Date.parse("2026-11-14T18:30:00+03:00");
const room = makeRoom(start, 0, "ABC");
const URL = "https://script.google.com/macros/s/TEST/exec";
const at = minutes => new Date(start + minutes * 60_000).toISOString();

function liveRecord(history, team = 1) {
  return validateRecord({
    game: CONFIG.game, version: CONFIG.version, mode: "live", team, market: marketForTable(room, team), room, session: "s1", content: "abc12345",
    history, drafts: {}, notes: {}, brief: "", bulletinB: false
  });
}
const decision = (round, choice, minutes, method = "submitted") => ({round, choice, method, at: at(minutes), evidence: "e " + round, tradeoff: "t " + round});
const threeRounds = () => [decision("R1", "A", 5), decision("R2", "desk", 32, "default"), decision("R3", "pilot", 40)];

// A stand-in for the Apps Script web app.
function sheet({fail = false, status = 200, cors = true} = {}) {
  const stored = new Set();
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, mode: options.mode || "cors", contentType: options.headers["Content-Type"]});
    if (fail) throw new TypeError("network error");
    const payload = JSON.parse(options.body);
    const saved = [], duplicates = [];
    for (const event of payload.events) (stored.has(event.id) ? duplicates : saved).push(event.id);
    payload.events.forEach(event => stored.add(event.id));
    if (!cors && options.mode !== "no-cors") throw new TypeError("blocked by CORS");
    return {ok: status === 200, status, json: async () => ({ok: true, saved, duplicates})};
  };
  return {request, stored, calls};
}

test("Events are deterministic and the chain changes for every later decision when an earlier one is rewritten", () => {
  const honest = buildEvents(liveRecord(threeRounds()));
  assert.deepEqual(buildEvents(liveRecord(threeRounds())), honest);
  assert.deepEqual(honest.map(event => event.seq), [0, 1, 2]);
  assert.equal(honest[1].credits, 9);
  assert.match(honest[0].id, new RegExp("^" + room + ":1:0:[0-9a-z]{11}$"));

  const rewritten = threeRounds();
  rewritten[1] = decision("R2", "prototype", 20, "submitted");
  const forged = buildEvents(liveRecord(rewritten));
  assert.equal(forged[0].id, honest[0].id, "earlier, untouched rounds keep their ids");
  assert.notEqual(forged[1].chain, honest[1].chain);
  assert.notEqual(forged[2].chain, honest[2].chain, "the rewrite carries into every later link");
});

test("Everything locked is sent once, a repeat sends nothing and a new decision sends only itself", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  const remote = sheet();
  let record = liveRecord(threeRounds());
  let status = await flushSync(record, {request: remote.request});
  assert.equal(status.status, "ok");
  assert.equal(remote.stored.size, 3);
  assert.equal(readSynced(room, 1, URL), 3);
  assert.equal(remote.calls[0].contentType, "text/plain;charset=utf-8", "a simple request needs no preflight");

  await flushSync(record, {request: remote.request});
  assert.equal(remote.calls.length, 1, "nothing new, nothing sent");

  record = liveRecord([...threeRounds(), decision("R4", "reserve", 55)]);
  await flushSync(record, {request: remote.request});
  assert.equal(remote.calls.length, 2);
  assert.equal(remote.stored.size, 4);
  assert.match(syncSummary().text, /all 4 decisions are saved/);
});

test("When the sheet cannot be reached the decisions stay pending and the next flush delivers them", async () => {
  clearSlot(room, 2);
  configureSync(URL);
  const record = liveRecord(threeRounds(), 2);
  const down = sheet({fail: true});
  const failed = await flushSync(record, {request: down.request});
  assert.equal(failed.status, "retry");
  assert.equal(failed.pending, 3);
  assert.equal(readSynced(room, 2, URL), 0);
  assert.match(syncSummary().text, /3 decisions are waiting/);

  const up = sheet();
  const recovered = await flushSync(record, {request: up.request});
  assert.equal(recovered.status, "ok");
  assert.equal(up.stored.size, 3);
});

test("A reply the browser cannot read is sent again opaquely and reported as unconfirmed; duplicates are harmless", async () => {
  clearSlot(room, 3);
  configureSync(URL);
  const record = liveRecord(threeRounds(), 3);
  const remote = sheet({cors: false});
  const status = await flushSync(record, {request: remote.request});
  assert.equal(status.status, "unconfirmed");
  assert.deepEqual(remote.calls.map(call => call.mode), ["cors", "no-cors"]);
  assert.equal(remote.stored.size, 3, "the first request reached the sheet; the repeat added nothing new");
  assert.match(syncSummary().text, /cannot read the reply/);

  const again = await flushSync(record, {request: remote.request, force: true});
  assert.equal(again.pending, 0);
});

test("A server error or a malformed reply is a retry, not a loss", async () => {
  clearSlot(room, 4);
  configureSync(URL);
  const record = liveRecord(threeRounds(), 4);
  const broken = await flushSync(record, {request: async () => ({ok: false, status: 500, json: async () => ({})})});
  assert.equal(broken.status, "retry");
  assert.match(broken.error, /status 500/);
  const html = await flushSync(record, {request: async () => ({ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); }})});
  assert.equal(html.status, "retry");
  const rejected = await flushSync(record, {request: async () => ({ok: true, status: 200, json: async () => ({ok: false, error: "Unsupported request."})})});
  assert.match(rejected.error, /Unsupported request/);
  assert.equal(readSynced(room, 4, URL), 0);
});

test("Sync stays off without a valid https endpoint and never touches practice tables", async () => {
  configureSync("");
  assert.equal(syncStatus().status, "off");
  assert.equal(syncSummary(), null);
  configureSync("http://insecure.example/exec");
  assert.equal(syncStatus().status, "off");
  configureSync(URL);
  const remote = sheet();
  const practice = {...liveRecord([]), mode: "practice", room: "PRACTICE"};
  await flushSync(practice, {request: remote.request});
  assert.equal(remote.calls.length, 0);
});

test("A different endpoint starts counting again, so a new sheet receives the full history", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  const record = liveRecord(threeRounds());
  await flushSync(record, {request: sheet().request});
  assert.equal(readSynced(room, 1, URL), 3);
  assert.equal(readSynced(room, 1, "https://script.google.com/macros/s/OTHER/exec"), 0);
});
