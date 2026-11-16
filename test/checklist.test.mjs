import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, RUBRIC } from '../src/scenario.mjs';
import { LEGACY, useTuning } from '../src/tuning.mjs';
import { makeRoom, hostChecklist } from '../src/rules.mjs';

const start = Date.parse("2026-11-14T18:30:00+03:00");
const room = makeRoom(start, 0, "ABC");
const at = minutes => start + minutes * 60_000;
const when = "2026-01-01T00:00:00.000Z";

function record(team, decisions) {
  const choices = ["A", "desk", "pilot", "reserve", "keep", "hold", "defer"].slice(0, decisions);
  return {game: CONFIG.game, version: CONFIG.version, mode: "live", team, market: "indonesia", room, session: "s", drafts: {}, notes: {}, brief: "", bulletinB: true,
    history: choices.map((choice, index) => ({round: "R" + (index + 1), choice, method: "submitted", at: when, evidence: "e", tradeoff: "t"}))};
}
const sheet = () => ({complete: true, checks: RUBRIC.map(() => [true, true, true, true])});
const allSheets = () => Object.fromEntries([1, 2, 3, 4].map(team => [team, [sheet(), sheet(), sheet()]]));
const allRecords = () => Object.fromEntries([1, 2, 3, 4].map(team => [team, record(team, 7)]));
const states = result => result.steps.map(step => step.state).join(" ");
const step = (result, id) => result.steps.find(item => item.id === id);

test("Before the seminar the facilitator is told to get the tables in", () => {
  const result = hostChecklist({room, now: at(-60), grades: {}, records: {}, joined: false});
  assert.equal(result.phase.id, "SETUP");
  assert.equal(states(result), "done now later later later later");
  assert.match(result.next, /Ask every team to open the page/);
  assert.equal(step(result, "files").detail, "0 of 4 tables have all 7 decisions. Missing: table 1, table 2, table 3, table 4.");
});

test("Ticking that the tables are in moves on to waiting for the game, then to the rounds", () => {
  const waiting = hostChecklist({room, now: at(-5), grades: {}, records: {}, joined: true});
  assert.equal(states(waiting), "done done now later later later");
  assert.match(waiting.next, /Wait for R1/);
  const running = hostChecklist({room, now: at(40), grades: {}, records: {}, joined: true});
  assert.equal(step(running, "game").state, "now");
  assert.equal(step(running, "game").detail, "The rounds are running.");
  assert.match(running.next, /checkpoint JSON at the break/);
});

test("A finished game or team data in the sheet counts as proof that the tables joined", () => {
  assert.equal(step(hostChecklist({room, now: at(40), grades: {}, records: {}, joined: false}), "joined").done, false, "a running game alone proves nothing");
  assert.equal(step(hostChecklist({room, now: at(40), grades: {}, records: {2: record(2, 4)}, joined: false}), "joined").done, true, "team data that has arrived does");
  assert.equal(step(hostChecklist({room, now: at(125), grades: {}, records: {}, joined: false}), "joined").done, true, "a finished game does");
});

test("After R7 the next job is waiting for the team data, and a table still playing is reported", () => {
  const result = hostChecklist({room, now: at(125), grades: {}, records: {1: record(1, 7), 2: record(2, 4)}, joined: false});
  assert.equal(result.phase.id, "PREP");
  assert.equal(step(result, "game").done, true);
  assert.equal(step(result, "files").state, "now");
  assert.equal(step(result, "files").detail, "1 of 4 tables have all 7 decisions. Missing: table 2, table 3, table 4. Still playing: table 2.");
  assert.match(result.next, /appear here from Google Sheets/);
});

test("Expert sheets are counted and the ranking step opens when everything is in", () => {
  const partial = {1: [sheet(), sheet(), {complete: false, checks: []}], 2: [sheet(), sheet(), sheet()]};
  const result = hostChecklist({room, now: at(140), grades: partial, records: allRecords(), joined: true});
  assert.equal(step(result, "files").done, true);
  assert.equal(step(result, "sheets").detail, "5 of 12 sheets are marked complete (three experts for each of four tables).");
  assert.equal(step(result, "sheets").state, "now");
  assert.equal(step(result, "ranking").done, false);

  const done = hostChecklist({room, now: at(140), grades: allSheets(), records: allRecords(), joined: true});
  assert.equal(states(done), "done done done done done done");
  assert.match(done.next, /Everything is done/);
});

test("Without a game result the team files are optional", () => {
  const restore = useTuning(LEGACY);
  try {
    const result = hostChecklist({room, now: at(125), grades: allSheets(), records: {}, joined: true});
    assert.equal(step(result, "files").done, true);
    assert.match(step(result, "files").detail, /^Optional without a game result\. 0 of 4/);
    assert.equal(step(result, "ranking").done, true, "the expert sheets alone rank the tables");
  } finally {
    restore();
  }
});
