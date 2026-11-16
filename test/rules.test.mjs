import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, MARKETS, ROUNDS, RUBRIC } from '../src/scenario.mjs';
import { LEGACY, useTuning } from '../src/tuning.mjs';
import { SCHEDULE, makeRoom, roomStart, marketForTable, phaseAt, optionsFor, replay, settleDeadlines,
  updateDraft, updateNote, updateBrief, lockRound, validateRecord, scoreJury, compareScores } from '../src/rules.mjs';

// These tests pin the rule mechanics with equal prices and no chance (the game before v3).
// The approved v3 settings are tested in balance.test.mjs.
useTuning(LEGACY);

const start = Date.parse("2026-11-14T18:30:00+03:00");
const minute = delta => start + delta * 60_000;
const room = makeRoom(start, 0, "123");
const names = Object.keys(MARKETS);

function record(market = "indonesia", mode = "practice", team = 1) {
  return {game: CONFIG.game, version: CONFIG.version, mode, team, market, room: mode === "live" ? room : "PRACTICE",
    session: "test", history: [], drafts: {}, notes: {}, brief: "", bulletinB: false};
}

function lock(current, choice, now = start, fallback = false) {
  const round = ROUNDS[current.history.length].id;
  if (!fallback) {
    current = updateDraft(current, round, "choice", choice, now);
    current = updateDraft(current, round, "evidence", "Relevant evidence", now);
    current = updateDraft(current, round, "tradeoff", "Cost of the alternative", now);
  }
  return lockRound(current, round, now, fallback);
}

function run(choices, market = "indonesia") {
  let current = record(market);
  for (const choice of choices) {
    if (current.history.length === 5) current.bulletinB = true;
    current = lock(current, choice);
  }
  return current;
}

function offer(current, id) {
  const round = ROUNDS[current.history.length].id;
  return optionsFor(round, replay(current).state, current.market).find(item => item.id === id);
}

test("R4 buys a live-pilot evidence path even with zero credits left", () => {
  const base = ["A", "prototype", "alliance"];
  const checked = run([...base, "verify", "keep"]);
  assert.equal(offer(checked, "targeted").cost, 0);
  const repaired = lock({...checked, bulletinB: true}, "targeted");
  assert.equal(offer(repaired, "pilot").blocked, "");
  assert.match(replay(repaired).state.result, /Four of five/);
  const skipped = run([...base, "reserve", "keep", "targeted"]);
  assert.ok(offer(skipped, "pilot").blocked);
  assert.equal(offer(skipped, "retest").blocked, "");
});

test("R5 narrowing differs from keeping the offer", () => {
  const current = run(["B", "desk", "pilot", "reserve", "narrow", "targeted"]);
  assert.equal(offer(current, "pilot").blocked, "");
  assert.match(replay(current).state.result, /narrow prototype/);
  assert.equal(replay(current).state.credits, 5);
});

test("An alliance can afford two cohorts and an all-channel retest only by retaining enough reserve", () => {
  const route = run(["A", "desk", "alliance", "reserve", "broaden", "full"]);
  assert.equal(replay(route).state.cohorts, 2);
  assert.equal(replay(route).state.credits, 0);
  assert.match(replay(route).state.result, /16\/20, cohort 2 17\/20/);
  const checked = run(["A", "interview", "alliance", "reserve", "broaden"]);
  assert.ok(offer(checked, "full").blocked);
  assert.equal(replay(lock({...checked, bulletinB: true}, "targeted")).state.cohorts, 1);
});

test("A full correction can miss the one-cohort comprehension gate", () => {
  const base = run(["A", "desk", "pilot", "reserve", "keep", "full"]);
  assert.match(replay(base).state.result, /15\/20.*missed/);
  assert.ok(offer(base, "pilot").blocked);
  assert.equal(offer(base, "retest").blocked, "");
  const researched = run(["A", "prototype", "pilot", "reserve", "keep", "full"]);
  assert.match(replay(researched).state.result, /16\/20.*met/);
  assert.equal(offer(researched, "pilot").blocked, "");
});

test("The acquisition has its own R5 action and R7 mandate", () => {
  const acquisition = run(["A", "interview", "acquisition", "reserve"]);
  assert.ok(offer(acquisition, "broaden").blocked);
  assert.equal(offer(acquisition, "diligence").cost, 1);
  const current = run(["A", "interview", "acquisition", "reserve", "diligence", "targeted"]);
  assert.equal(replay(current).state.credits, 0);
  assert.ok(offer(current, "pilot").blocked);
  assert.equal(offer(current, "deal").blocked, "");
  assert.ok(offer(run(["A", "desk", "acquisition", "reserve", "keep", "full"]), "deal").blocked);
  assert.ok(offer(run(["A", "desk", "acquisition", "reserve", "diligence", "hold"]), "deal").blocked);
});

test("Missing the entry round leaves an explicit mock-only route, and verification keeps a zero-credit route viable", () => {
  const current = run(["A", "desk"]);
  const noRoute = lock(current, null, start, true);
  assert.equal(replay(noRoute).state.route, "planning");
  const later = run(["B", "prototype", "alliance", "verify", "narrow", "targeted"]);
  assert.equal(replay(later).state.credits, 0);
  assert.equal(offer(later, "pilot").blocked, "");
});

test("Rooms assign four different markets and follow both seminar clocks", () => {
  const permutations = Array.from({length: 24}, (_, index) => makeRoom(start, index, "ABC"))
    .map(id => [1, 2, 3, 4].map(team => marketForTable(id, team)));
  assert.equal(new Set(permutations.map(values => values.join(","))).size, 24);
  permutations.forEach(values => assert.deepEqual(values.slice().sort(), names.slice().sort()));
  assert.equal(roomStart(room), start);
  for (const phase of SCHEDULE) assert.equal(phaseAt(room, minute(phase.from)).id, phase.id);
  assert.equal(phaseAt(room, minute(91.9)).bulletinB, false);
  assert.equal(phaseAt(room, minute(92)).bulletinB, true);
  assert.throws(() => validateRecord({...record("thailand", "live")}), /Invalid team/);
});

test("A timely complete draft locks at deadline, incomplete drafts default, and later edits cannot change the result", () => {
  let current = record("indonesia", "live");
  current = updateDraft(current, "R1", "choice", "B", minute(1));
  current = updateDraft(current, "R1", "evidence", "Evidence", minute(2));
  current = updateDraft(current, "R1", "tradeoff", "Trade-off", minute(15.9));
  assert.throws(() => updateDraft(current, "R1", "evidence", "Too late", minute(16)), /not open/);
  current = settleDeadlines(current, minute(16));
  assert.equal(current.history[0].method, "deadline");
  assert.equal(replay(current).state.profile, "B");
  assert.deepEqual(validateRecord(current).history, current.history);
  current = settleDeadlines(current, minute(32));
  assert.equal(current.history[1].method, "default");
  assert.equal(current.history[1].choice, "desk");
  assert.strictEqual(settleDeadlines(current, minute(32)), current);
});

test("Emergency, checkpoints and the Board brief respect release and deadline rules", () => {
  let current = record("indonesia", "live");
  current = lock(current, "A", minute(1));
  current = lock(current, "desk", minute(20));
  current = lock(current, "pilot", minute(34));
  current = lock(current, "reserve", minute(55));
  current = updateNote(current, "R4", "gate", "A published payment claim", minute(56));
  const checkpoint = validateRecord(JSON.parse(JSON.stringify(current)));
  assert.equal(checkpoint.notes["R4.gate"], "A published payment claim");
  assert.equal(phaseAt(room, minute(61)).id, "BREAK");
  current = lock(checkpoint, "narrow", minute(71));
  assert.throws(() => updateDraft(current, "R6", "choice", "targeted", minute(88)), /Bulletin B/i);
  assert.throws(() => lockRound(current, "R6", minute(88)), /bulletin B/);
  current = lock(current, "targeted", minute(93));
  assert.throws(() => lockRound(current, "R6", minute(94)), /already closed/);
  assert.throws(() => updateNote(current, "R6", "holding", "x", minute(104)), /not open/);
  current = lock(current, "pilot", minute(106));
  current = updateBrief(current, "Our proposed launch", minute(120));
  assert.throws(() => updateBrief(current, "Too late", minute(130)), /closed/);
  assert.deepEqual(validateRecord(current).history, current.history);
  assert.throws(() => validateRecord({...current, version: "v1"}), /another game/);
  const altered = structuredClone(current);
  altered.history[5].at = new Date(minute(88)).toISOString();
  assert.throws(() => validateRecord(altered), /timestamp/);
});

test("Every general action has a useful path and all four Board outcomes are reachable on each market", () => {
  let paths = 0;
  for (const marketId of names) {
    const outcomes = new Set();
    const chosen = new Set();
    function enumerate(current) {
      if (current.history.length === ROUNDS.length) {
        outcomes.add(current.history.at(-1).choice);
        assert.ok(replay(current).state.credits >= 0);
        paths++;
        return;
      }
      const round = ROUNDS[current.history.length];
      if (round.id === "R6") current = {...current, bulletinB: true};
      for (const item of optionsFor(round.id, replay(current).state, marketId)) {
        if (item.blocked) continue;
        chosen.add(round.id + "." + item.id);
        enumerate(lock(current, item.id));
      }
    }
    enumerate(record(marketId));
    assert.deepEqual([...outcomes].sort(), ["deal","defer","pilot","retest"]);
    for (const id of ["R2.interview","R2.prototype","R4.verify","R5.narrow","R5.broaden","R5.diligence","R6.full"])
      assert.ok(chosen.has(id), id + " should have an affordable valid route");
  }
  assert.ok(paths > 1500);
  console.log(paths + " valid complete paths checked");
});

test("Judges average 70 written and 30 oral, with the two defined tie breaks", () => {
  const master = {complete: true, checks: RUBRIC.map(() => [true, true, true, true])};
  assert.deepEqual(scoreJury([master, master, master]), {written:70, oral:30, uppsala:16, total:100});
  const partial = structuredClone(master);
  partial.checks[5][0] = false;
  assert.equal(scoreJury([master, master, partial]).oral, 85 / 3);
  assert.equal(scoreJury([master, master, null]), null);
  assert.equal(scoreJury([{complete:true}, {complete:true}, {complete:true}]).total, 0);
  assert.ok(compareScores({total:90, oral:26, uppsala:10}, {total:90, oral:24, uppsala:16}) < 0);
  assert.ok(compareScores({total:90, oral:26, uppsala:14}, {total:90, oral:26, uppsala:16}) > 0);
});
