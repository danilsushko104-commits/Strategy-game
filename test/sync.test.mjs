import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/scenario.mjs';
import { makeRoom, marketForTable, validateRecord } from '../src/rules.mjs';
import { clearSlot, readSynced } from '../src/storage.mjs';
import { configureSync, buildEvents, flushSync, syncStatus, syncSummary } from '../src/sync.mjs';
import { replay } from '../src/rules.mjs';

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
  const remote = {notes: []};
  const request = async (url, options) => {
    calls.push({url, mode: options.mode || "cors", contentType: options.headers["Content-Type"]});
    if (fail) throw new TypeError("network error");
    const payload = JSON.parse(options.body);
    if (payload.type === "notes") {
      remote.notes.push(payload);
      return {ok: status === 200, status, json: async () => ({ok: true, saved: payload.items.length + (payload.brief ? 1 : 0), ignored: 0, rejected: []})};
    }
    const saved = [], duplicates = [];
    for (const event of payload.events) (stored.has(event.id) ? duplicates : saved).push(event.id);
    payload.events.forEach(event => stored.add(event.id));
    if (!cors && options.mode !== "no-cors") throw new TypeError("blocked by CORS");
    return {ok: status === 200, status, json: async () => ({ok: true, saved, duplicates})};
  };
  return Object.assign(remote, {request, stored, calls});
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
  assert.match(syncSummary().text, /all 4 decisions are saved with your notes/);
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
  assert.match(syncSummary().text, /3 decisions waiting to be sent/);

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

// ---- Worksheet notes and the Board Brief ----

const withNotes = (record, notes = {}, brief = "") => ({...record, notes, brief});

test("Notes and the Board Brief are sent as they change, once each, and only what changed", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  const remote = sheet();
  let record = withNotes(liveRecord(threeRounds()), {"R1.proposition": "Frequent travellers", "R1.cage": "Two differences"});
  await flushSync(record, {request: remote.request});
  assert.equal(remote.notes.length, 1);
  assert.deepEqual(remote.notes[0].items.map(item => item.round + "." + item.field).sort(), ["R1.cage", "R1.proposition"]);
  assert.equal(remote.notes[0].room, room);
  assert.equal(remote.notes[0].team, 1);
  assert.equal(remote.notes[0].brief, undefined);

  await flushSync(record, {request: remote.request});
  assert.equal(remote.notes.length, 1, "nothing changed, nothing sent");

  record = withNotes(record, {...record.notes, "R1.cage": "Two differences, edited", "R2.alternatives": "Mandiri vs BCA"}, "Fund a pilot");
  await flushSync(record, {request: remote.request});
  assert.equal(remote.notes.length, 2);
  assert.deepEqual(remote.notes[1].items.map(item => item.round + "." + item.field).sort(), ["R1.cage", "R2.alternatives"], "the unchanged note is not sent again");
  assert.equal(remote.notes[1].brief.text, "Fund a pilot");
  assert.equal(syncStatus().pendingNotes, 0);
});

test("Clearing a note sends the empty text so the sheet clears it too", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  const remote = sheet();
  let record = withNotes(liveRecord(threeRounds()), {"R1.cage": "something"});
  await flushSync(record, {request: remote.request});
  record = withNotes(record, {"R1.cage": ""});
  await flushSync(record, {request: remote.request});
  assert.equal(remote.notes.at(-1).items[0].text, "");
});

test("Notes wait while decisions are still pending, and a failed notes request is retried", async () => {
  clearSlot(room, 2);
  configureSync(URL);
  const record = withNotes(liveRecord(threeRounds(), 2), {"R1.cage": "idea"});
  const down = sheet({fail: true});
  const failed = await flushSync(record, {request: down.request});
  assert.equal(failed.status, "retry");
  assert.match(syncSummary().text, /3 decisions and 1 note waiting to be sent/);

  const up = sheet();
  const recovered = await flushSync(record, {request: up.request});
  assert.equal(recovered.status, "ok");
  assert.equal(up.stored.size, 3);
  assert.equal(up.notes.length, 1);
  assert.deepEqual(up.calls.map(call => call.mode), ["cors", "cors"], "decisions first, then notes");
});

test("Forcing a resend sends every decision and note again", async () => {
  clearSlot(room, 3);
  configureSync(URL);
  const remote = sheet();
  const record = withNotes(liveRecord(threeRounds(), 3), {"R1.cage": "idea"}, "brief");
  await flushSync(record, {request: remote.request});
  await flushSync(record, {request: remote.request, force: true});
  assert.equal(remote.notes.length, 2);
  assert.equal(remote.notes[1].items.length, 1);
  assert.equal(remote.notes[1].brief.text, "brief");
});

test("A local test backend on this machine is accepted without https", () => {
  configureSync("http://localhost:8080/sheets");
  assert.equal(syncStatus().status, "idle");
  configureSync("http://127.0.0.1:3000/sheets");
  assert.equal(syncStatus().status, "idle");
  configureSync("http://example.org/sheets");
  assert.equal(syncStatus().status, "off");
  configureSync("http://localhost.evil.example/sheets");
  assert.equal(syncStatus().status, "off");
});

// ---- Reading from the sheet ----

import { createBackend } from '../scripts/fake-google.mjs';
import { fetchConfig, fetchTeam, fetchRoom, publishRoom, recordFromPayload, syncEnabled } from '../src/sync.mjs';

// The game's own requests, answered by the real Code.gs on a fake spreadsheet.
function viaScript(backend) {
  return async (url, options = {}) => {
    const {status, body} = backend.handle(options.method || "GET", url.replace(/^https:\/\/script\.google\.com\/macros\/s\/TEST\/exec/, "/"), options.body || "");
    return {ok: status === 200, status, json: async () => JSON.parse(body)};
  };
}

test("A team continues on another device from what the sheet holds: decisions, notes and brief", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  assert.equal(syncEnabled(), true);
  const backend = createBackend();
  const request = viaScript(backend);
  const original = withNotes(liveRecord([...threeRounds(), decision("R4", "verify", 55)]), {"R1.cage": "Two differences", "R3.early": "Month 0-3"}, "Fund the pilot");
  await flushSync(original, {request});

  const payload = await fetchTeam(room, 1, {request});
  const restored = recordFromPayload(payload, original.market);
  assert.deepEqual(restored.history.map(event => [event.round, event.choice, event.method, event.at, event.evidence]),
    original.history.map(event => [event.round, event.choice, event.method, event.at, event.evidence]));
  assert.equal(restored.notes["R1.cage"], "Two differences");
  assert.equal(restored.notes["R3.early"], "Month 0-3");
  assert.equal(restored.brief, "Fund the pilot");
  assert.notEqual(restored.session, original.session, "a restored game is a new session");
  // The restored game replays to the same state.
  assert.equal(replay(restored).state.credits, replay(original).state.credits);
});

test("An empty sheet restores to a fresh game; unknown or tampered data is refused", async () => {
  configureSync(URL);
  const backend = createBackend();
  const request = viaScript(backend);
  const empty = recordFromPayload(await fetchTeam(room, 4, {request}), "vietnam");
  assert.equal(empty.history.length, 0);
  assert.throws(() => recordFromPayload({room, team: 4, decisions: [{round: "R1", choice: "ZZ", method: "submitted", at: at(5), evidence: "e", tradeoff: "t"}], notes: []}, "vietnam"));
});

test("The room and start time are published by the facilitator and read by teams", async () => {
  configureSync(URL);
  const backend = createBackend({token: "a good password"});
  const request = viaScript(backend);
  assert.deepEqual(await fetchConfig({request}), {room: "", start: ""});
  await assert.rejects(publishRoom(room, start, "wrong", {request}), /Wrong facilitator password/);
  await publishRoom(room, start, "a good password", {request});
  assert.deepEqual(await fetchConfig({request}), {room, start: new Date(start).toISOString()});
});

test("The facilitator reads every team of the room, with the password", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  const backend = createBackend({token: "a good password"});
  const request = viaScript(backend);
  await flushSync(liveRecord(threeRounds()), {request});
  await assert.rejects(fetchRoom(room, "nope", {request}), /Wrong facilitator password/);
  const data = await fetchRoom(room, "a good password", {request});
  assert.deepEqual(data.teams.map(team => team.decisions.length), [3, 0, 0, 0]);
});

test("A note typed while a send is running is sent right after it, not at the next timer", async () => {
  clearSlot(room, 1);
  configureSync(URL);
  const remote = sheet();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let first = true;
  const slow = async (url, options) => {
    if (first) { first = false; await gate; }          // the first request (the decisions) is slow
    return remote.request(url, options);
  };
  const early = withNotes(liveRecord(threeRounds()), {});
  const running = flushSync(early, {request: slow});
  // The facilitator-visible moment: the team types while the decisions are still being sent.
  const later = withNotes(early, {"R1.cage": "typed during the send"});
  const joined = flushSync(later, {request: slow});
  release();
  await Promise.all([running, joined]);
  assert.equal(remote.stored.size, 3, "the decisions arrived");
  assert.equal(remote.notes.length, 1, "and the note was sent without waiting for another trigger");
  assert.equal(remote.notes[0].items[0].text, "typed during the send");
  assert.equal(syncStatus().pendingNotes, 0);
});
