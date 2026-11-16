import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, MARKETS } from '../src/scenario.mjs';
import { LEGACY, V3, tuning, useTuning, retestDelta } from '../src/tuning.mjs';
import { price, optionsFor, replay, gameScore, finalScore } from '../src/rules.mjs';
import { analyze } from '../scripts/balance.mjs';

const when = "2026-01-01T00:00:00.000Z";
function played(choices, {market = "indonesia", room = "PRACTICE", team = 1, mode = "practice", session = "s"} = {}) {
  return {game: CONFIG.game, version: CONFIG.version, mode, team, market, room, session, drafts: {}, notes: {}, brief: "", bulletinB: true,
    history: choices.map((choice, index) => ({round: "R" + (index + 1), choice, method: "submitted", at: when, evidence: "e", tradeoff: "t"}))};
}
const withTuning = (config, run) => { const restore = useTuning(config); try { return run(); } finally { restore(); } };
const forced = delta => ({...V3, randomness: {retestSpread: 0.2, draw: () => delta}});
const r7 = (record, market = "indonesia") => optionsFor("R7", replay({...record, history: record.history.slice(0, 6)}).state, market);

test("The approved settings are active and the legacy game stays available as plain rules", () => {
  assert.equal(tuning(), V3);
  assert.equal(V3.gameShare, 0.2);
  assert.equal(V3.askPilotTwo, true);
  assert.equal(V3.randomness.retestSpread, 0.2);
  withTuning(LEGACY, () => {
    assert.equal(LEGACY.gameShare, 0);
    assert.equal(LEGACY.askPilotTwo, false);
    for (const id of Object.keys(MARKETS)) assert.equal(price(id, "verify"), 2);
    assert.equal(retestDelta("anything"), 0);
    assert.equal(optionsFor("R7", replay(played(["A", "desk", "pilot", "reserve", "narrow", "targeted"])).state, "indonesia").some(option => option.id === "pilot2"), false);
  });
});

test("Market prices follow the table, never drop below zero and leave other markets alone", () => {
  withTuning(V3, () => {
    assert.equal(price("indonesia", "alliance"), 2);
    assert.equal(price("indonesia", "broaden"), 3);
    assert.equal(price("philippines", "pilot"), 1);
    assert.equal(price("thailand", "verify"), 1);
    assert.equal(price("vietnam", "pilot"), 3);
    assert.equal(price("vietnam", "verify"), 2);
    const r3 = optionsFor("R3", {credits: 9}, "philippines");
    assert.equal(r3.find(option => option.id === "pilot").cost, 1);
  });
  const cheap = {...V3, markets: {...V3.markets, indonesia: {price: {verify: -5}, testShift: 0}}};
  withTuning(cheap, () => assert.equal(price("indonesia", "verify"), 0));
});

test("A draw is fixed by room, table and round, so a replay and a restored save agree and rooms differ", () => {
  const options = {market: "indonesia", room: "OMF-ABCDE-0XYZ", team: 1, mode: "live"};
  const path = ["A", "desk", "pilot", "reserve", "keep", "full"];
  withTuning(V3, () => {
    const first = replay(played(path, options)).state.result;
    assert.equal(replay(played(path, options)).state.result, first);
    assert.equal(replay({...played(path, options), session: "another-device"}).state.result, first, "a restored save keeps its result");
    const rehearsals = new Set();
    for (let index = 0; index < 40; index++) rehearsals.add(replay(played(path, {session: "rehearsal-" + index})).state.result);
    assert.ok(rehearsals.size > 1, "practice tables draw from their own session, so rehearsals differ");
    const seen = new Set();
    for (let index = 0; index < 60; index++) seen.add(retestDelta(["OMF-ROOM" + index, 1, "R6", 1].join("|")));
    assert.deepEqual([...seen].sort(), [-1, 0, 1], "different rooms get different draws");
    let tablesDiffer = 0;
    for (let index = 0; index < 60; index++) {
      if (retestDelta(["OMF-ROOM" + index, 1, "R6", 1].join("|")) !== retestDelta(["OMF-ROOM" + index, 2, "R6", 1].join("|"))) tablesDiffer++;
    }
    assert.ok(tablesDiffer > 10, "tables in one room draw separately: " + tablesDiffer);
  });
});

test("The draw follows the configured chance", () => {
  withTuning(V3, () => {
    const counts = {"-1": 0, "0": 0, "1": 0};
    const runs = 6000;
    for (let index = 0; index < runs; index++) counts[retestDelta(["OMF-ROOM" + index, 2, "R6", 1].join("|"))]++;
    assert.ok(Math.abs(counts["-1"] / runs - 0.2) < 0.03, JSON.stringify(counts));
    assert.ok(Math.abs(counts["1"] / runs - 0.2) < 0.03, JSON.stringify(counts));
    assert.ok(Math.abs(counts["0"] / runs - 0.6) < 0.04, JSON.stringify(counts));
  });
  withTuning({...V3, randomness: {retestSpread: 0, draw: null}}, () => assert.equal(retestDelta("x"), 0));
});

test("Chance moves a full retest across the 16/20 line; a market shift and the 0-20 range apply", () => {
  const path = ["A", "desk", "pilot", "reserve", "keep", "full"];   // one cohort, no advantage: 15/20 before chance
  const outcome = (config, market = "indonesia") => withTuning(config, () => replay(played(path, {market})).state);
  assert.equal(outcome(forced(1)).launchEvidence, true, "a lucky draw reaches 16");
  assert.match(outcome(forced(1)).result, /16\/20/);
  assert.equal(outcome(forced(0)).launchEvidence, false);
  assert.match(outcome(forced(-1)).result, /14\/20/);
  assert.match(outcome(forced(0), "thailand").result, /14\/20/, "Thailand's shift lowers the result");
  const extreme = {...V3, markets: {...V3.markets, indonesia: {price: {}, testShift: 30}}, randomness: {retestSpread: 0.2, draw: () => 1}};
  assert.match(outcome(extreme).result, /20\/20/, "never above 20");
});

test("The two-cohort pilot request exists only in the proposal and only for a proven alliance", () => {
  const proven = ["A", "desk", "alliance", "reserve", "broaden", "full"];
  withTuning(forced(1), () => {
    const menu = r7(played(proven, {market: "philippines"}), "philippines");
    assert.equal(menu.find(option => option.id === "pilot2").blocked, "");
  });
  withTuning(forced(-1), () => {
    const menu = r7(played(proven, {market: "philippines"}), "philippines");
    assert.match(menu.find(option => option.id === "pilot2").blocked, /both cohorts understood/);
  });
  withTuning(V3, () => {
    const single = r7(played(["A", "desk", "pilot", "reserve", "narrow", "targeted"]));
    assert.match(single.find(option => option.id === "pilot2").blocked, /alliance route/);
    const oneCohort = r7(played(["A", "desk", "alliance", "reserve", "narrow", "targeted"]));
    assert.match(oneCohort.find(option => option.id === "pilot2").blocked, /two cohorts/);
  });
});

test("The game score ranks the requests, rewards a kept reserve only behind a real ask and always adds up", () => {
  const base = ["A", "desk", "pilot", "reserve", "narrow", "targeted"];
  withTuning(V3, () => {
    assert.equal(gameScore(played(base)), null, "not before the Board request");
    const score = ask => gameScore(played([...base, ask]));
    assert.ok(score("pilot").total > score("retest").total);
    assert.ok(score("retest").total > score("defer").total);
    assert.ok(score("pilot").parts.some(part => /Reserve kept/.test(part.label)));
    assert.ok(!score("defer").parts.some(part => /Reserve kept/.test(part.label)), "hoarding behind a deferral earns nothing");
    for (const ask of ["pilot", "retest", "defer"]) {
      const result = score(ask);
      assert.equal(result.total, result.parts.reduce((sum, part) => sum + part.points, 0));
      assert.ok(result.total >= 0 && result.total <= 100);
    }
    const capped = {...V3, scoring: {...V3.scoring, credit: 50}};
    withTuning(capped, () => assert.equal(gameScore(played([...base, "pilot"])).total, 100, "the total is capped at 100"));
  });
});

test("The final grade mixes expert and game scores in the configured proportion", () => {
  assert.equal(finalScore(80, 50, 0.1), 77);
  assert.equal(finalScore(80, 50, 0), 80);
  assert.equal(finalScore(60, 100), 68, "the approved setting counts the game score for 20%");
  assert.equal(withTuning(LEGACY, () => finalScore(60, 100)), 60, "the legacy setting ignores the game score");
});

// The author's rules of thumb, kept as guards so a later change of numbers cannot quietly break them.
test("The proposal keeps every route and every option worth choosing somewhere, and no market ahead", () => {
  const result = analyze(V3);
  const markets = Object.values(result.markets);
  for (const market of markets) {
    const values = ["pilot", "alliance", "acquisition"].map(route => market.routeBest[route]?.value);
    assert.ok(values.every(Number.isFinite), market.name + " has a route that cannot be completed");
    assert.ok(Math.max(...values) - Math.min(...values) <= 5, market.name + " favours one route too much: " + values);
    for (const [key, entry] of Object.entries(market.options)) assert.ok(entry.viable > 0, market.name + " " + key + " is never worth choosing");
  }
  const roots = markets.map(market => market.root);
  assert.ok(Math.max(...roots) - Math.min(...roots) <= 3, "markets differ by " + (Math.max(...roots) - Math.min(...roots)));
});

test("Balance analysis leaves the active setting as it found it", () => {
  const before = tuning();
  analyze(LEGACY);
  assert.equal(tuning(), before);
});

// Every route and every kind of request can actually be reached in the approved game, in every market.
test("All five Board requests and every purchasable action have an affordable path in each market", () => {
  for (const marketId of Object.keys(MARKETS)) {
    const requests = new Set();
    const actions = new Set();
    let completed = 0;
    const walk = record => {
      if (record.history.length === 7) {
        requests.add(record.history[6].choice);
        assert.ok(replay(record).state.credits >= 0, "credits never go negative");
        completed++;
        return;
      }
      const round = "R" + (record.history.length + 1);
      for (const item of optionsFor(round, replay(record).state, marketId)) {
        if (item.blocked) continue;
        actions.add(round + "." + item.id);
        walk({...record, history: [...record.history, {round, choice: item.id, method: "submitted", at: when, evidence: "e", tradeoff: "t"}]});
      }
    };
    // Chance decides the retest, so look at both a lucky and an unlucky world.
    for (const delta of [-1, 0, 1]) {
      withTuning(forced(delta), () => walk(played([], {market: marketId})));
    }
    assert.deepEqual([...requests].sort(), ["deal", "defer", "pilot", "pilot2", "retest"], marketId);
    for (const id of ["R2.interview", "R2.prototype", "R3.alliance", "R3.acquisition", "R4.verify", "R5.narrow", "R5.broaden", "R5.diligence", "R6.full"]) {
      assert.ok(actions.has(id), marketId + " cannot afford " + id);
    }
    assert.ok(completed > 1000, marketId + " has only " + completed + " paths");
  }
});
