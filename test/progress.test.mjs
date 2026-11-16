import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, MARKETS, ROUNDS } from '../src/scenario.mjs';
import { LEGACY, useTuning } from '../src/tuning.mjs';
import { optionsFor, replay, gameScore, problemFor } from '../src/rules.mjs';
import { gameProgress, bestReachable } from '../src/progress.mjs';

const when = "2026-01-01T00:00:00.000Z";
const base = market => ({game: CONFIG.game, version: CONFIG.version, mode: "practice", team: 1, market, room: "PRACTICE", session: "progress", drafts: {}, notes: {}, brief: "", bulletinB: true, history: []});
function step(record, choice) {
  const round = ROUNDS[record.history.length].id;
  const problem = round === "R6" && choice === "targeted" ? {problem: problemFor(record.market, record.history[0].choice)} : {};
  return {...record, history: [...record.history, {round, choice, method: "submitted", at: when, evidence: "e", tradeoff: "t", ...problem}]};
}
// A deterministic walk: always the first affordable option, or the one at a given index.
function walk(market, picks) {
  let record = base(market);
  const records = [record];
  for (let index = 0; index < ROUNDS.length; index++) {
    const open = optionsFor(ROUNDS[index].id, replay(record).state, market).filter(option => !option.blocked);
    record = step(record, open[Math.min(picks[index] ?? 0, open.length - 1)].id);
    records.push(record);
  }
  return records;
}

test("At the start nothing is earned and the ceiling is the best the game can give", () => {
  const start = gameProgress(base("indonesia"));
  assert.equal(start.earned, 0);
  assert.equal(start.final, null);
  assert.ok(start.possible > 60 && start.possible <= 100, "ceiling " + start.possible);
  assert.equal(bestReachable(base("indonesia")), start.possible);
});

test("Earned points grow with each decision, the ceiling never rises, and the end matches the game result", () => {
  for (const market of Object.keys(MARKETS)) {
    for (const picks of [[], [1, 2, 1, 1, 1, 1, 0], [0, 1, 0, 1, 2, 2, 1], [1, 1, 1, 1, 0, 2, 3]]) {
      const records = walk(market, picks);
      let previous = {earned: 0, possible: Infinity};
      for (const record of records) {
        const now = gameProgress(record);
        assert.ok(now.earned <= now.possible + 1e-9, market + ": earned above the ceiling");
        assert.ok(now.earned >= previous.earned - 1e-9, market + ": earned fell");
        assert.ok(now.possible <= previous.possible + 1e-9, market + ": the ceiling rose from " + previous.possible + " to " + now.possible);
        previous = now;
      }
      const end = gameProgress(records.at(-1));
      assert.equal(end.final, gameScore(records.at(-1)).total);
      assert.equal(end.earned, end.possible);
      assert.equal(end.parts.reduce((sum, part) => sum + part.points, 0), end.final);
    }
  }
});

test("A spent budget shows up: the ceiling falls when a costly route is taken", () => {
  const cheap = gameProgress(step(step(step(base("thailand"), "A"), "desk"), "pilot"));
  const costly = gameProgress(step(step(step(base("thailand"), "A"), "prototype"), "acquisition"));
  assert.ok(costly.possible < cheap.possible, costly.possible + " < " + cheap.possible);
});

test("Without chance the ceiling is plain, and the search leaves the active settings alone", () => {
  const restore = useTuning(LEGACY);
  try {
    assert.ok(bestReachable(base("vietnam")) > 0);
  } finally {
    restore();
  }
  assert.ok(gameProgress(base("vietnam")).possible > 0);
});

test("The ceiling search is fast enough to run on every decision", () => {
  const started = performance.now();
  for (const market of Object.keys(MARKETS)) bestReachable({...base(market), session: "timing-" + market});
  assert.ok(performance.now() - started < 1500, "took " + Math.round(performance.now() - started) + " ms for four markets");
});
