import { ROUNDS } from './scenario.mjs';
import { tuning, useTuning } from './tuning.mjs';
import { optionsFor, replay, gameScore, problemFor } from './rules.mjs';

// What the player sees of the hidden game result while playing: the points already earned and the most
// the result can still reach. The ceiling comes from searching the rest of the decision tree.

const WHEN = "2026-01-01T00:00:00.000Z";

// One more decision, as the search takes it. A one-channel correction names the problem the customers
// are confused about (the best case).
function advance(record, choice) {
  const round = ROUNDS[record.history.length].id;
  const problem = round === "R6" && choice === "targeted" ? {problem: problemFor(record.market, record.history[0].choice)} : {};
  return {...record, history: [...record.history, {round, choice, method: "submitted", at: WHEN, evidence: "e", tradeoff: "t", ...problem}]};
}

const cache = new Map();

// The highest game result still reachable, assuming the best case in the full retest.
export function bestReachable(record) {
  const settings = tuning();
  const key = settings.name + "|" + record.market + "|" + record.history.map(event => event.choice + (event.problem ? ":" + event.problem : "")).join(">");
  if (cache.has(key)) return cache.get(key);

  let forced = [0, 0];
  const chance = settings.randomness.retestSpread > 0;
  const restore = chance ? useTuning({...settings, randomness: {...settings.randomness, draw: name => forced[name.endsWith("|2") ? 1 : 0]}}) : () => {};
  try {
    const search = current => {
      if (current.history.length === ROUNDS.length) return gameScore(current).total;
      const round = ROUNDS[current.history.length];
      const state = replay(current).state;
      let best = 0;
      for (const item of optionsFor(round.id, state, current.market)) {
        if (item.blocked) continue;
        const next = advance(current, item.id);
        if (chance && round.id === "R6" && item.id === "full") {
          const draws = state.cohorts === 2 ? [-1, 0, 1].flatMap(a => [-1, 0, 1].map(b => [a, b])) : [-1, 0, 1].map(a => [a, 0]);
          for (const combo of draws) {
            forced = combo;
            best = Math.max(best, search(next));
          }
          forced = [0, 0];
        } else {
          best = Math.max(best, search(next));
        }
      }
      return best;
    };
    const value = search(record);
    cache.set(key, value);
    return value;
  } finally {
    restore();
  }
}

// {earned, possible, final, parts}: `earned` counts what is already decided (research, checks, the emergency
// response, and after R7 the request and the reserve); `possible` is the ceiling; `final` is set after R7.
export function gameProgress(record) {
  const decided = record.history.length;
  if (decided === ROUNDS.length) {
    const result = gameScore(record);
    return {earned: result.total, possible: result.total, final: result.total, parts: result.parts};
  }
  const table = tuning().scoring;
  const parts = [];
  if (decided > 0) {
    const {state} = replay(record);
    if (decided >= 2) parts.push({label: "Customer research", points: table.research[state.research] ?? 0});
    if (decided >= 4 && state.verified) parts.push({label: "Readiness check", points: table.verified});
    if (decided >= 5 && state.narrow) parts.push({label: "Narrowed proposition", points: table.narrow});
    if (decided >= 6) {
      const response = {hold: table.response.hold, targeted: state.launchEvidence ? table.response.targetedProven : table.response.targetedOpen,
        full: state.launchEvidence ? table.response.fullPassed : table.response.fullFailed}[state.incident] ?? 0;
      parts.push({label: "Emergency response", points: response});
    }
  }
  const earned = parts.reduce((sum, part) => sum + part.points, 0);
  return {earned, possible: Math.max(earned, bestReachable(record)), final: null, parts};
}
