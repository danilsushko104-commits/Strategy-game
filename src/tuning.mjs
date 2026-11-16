import { hash53 } from './hash.mjs';

// Every number the game designer may want to change lives here: what the game result is worth,
// how markets differ, and how much chance there is. Two sets exist:
//   LEGACY   the game as it was played so far (no game score, equal markets, no chance). Active by default.
//   PROPOSAL a draft for the course author to accept or change; `node scripts/balance.mjs` evaluates it.
// To adopt the proposal: set `let active = PROPOSAL` below, raise CONFIG.version and rebuild.

const MARKET_IDS = ["indonesia", "philippines", "thailand", "vietnam"];
const equalMarkets = () => Object.fromEntries(MARKET_IDS.map(id => [id, {price: {}, testShift: 0, note: ""}]));

// Game score, 0-100 (hidden from students). All values are drafts.
const SCORING = {
  ask: {pilot2: 70, pilot: 45, deal: 54, retest: 22, defer: 10},
  research: {desk: 0, interview: 4, prototype: 6},
  verified: 5,
  narrow: 4,
  response: {hold: 0, targetedProven: 8, targetedOpen: 3, fullPassed: 12, fullFailed: 4},
  secondCohort: 0,
  dealFullCorrection: 10,
  credit: 2,
  creditCap: 5
};

export const LEGACY = {
  name: "legacy",
  gameShare: 0,
  askPilotTwo: false,
  scoring: SCORING,
  markets: equalMarkets(),
  randomness: {retestSpread: 0, draw: null}
};

// Credit deltas apply on top of the base prices in rules.mjs (PRICE). `testShift` moves the number of
// correct answers in a full retest. The reasons are hypotheses drawn from the market facts in scenario.mjs
// and must be confirmed by the author or a fintech specialist.
export const V3 = {
  ...LEGACY,
  name: "v3",
  gameShare: 0.2,
  askPilotTwo: true,
  markets: {
    indonesia: {price: {alliance: -1, broaden: 1}, testShift: 0, note: "Partners can open distribution cheaply, but each extra channel across an archipelago needs more support."},
    philippines: {price: {pilot: -1, verify: 1}, testShift: 0, note: "A local provider scopes one cohort quickly, but the domestic payout step and the cross-border corridor need separate checks."},
    thailand: {price: {verify: -1, diligence: 1}, testShift: -1, note: "A mature PromptPay–PayNow corridor makes readiness checks cheaper, but strong travel-card alternatives raise the bar for proving understanding and a technical review of a target is deeper."},
    vietnam: {price: {pilot: 1}, testShift: 0, note: "No documented direct Singapore corridor makes a pilot harder to scope, so an alliance with local banks looks relatively better."}
  },
  randomness: {retestSpread: 0.2, draw: null}
};

let active = V3;

export function tuning() {
  return active;
}

// Switch the active set (tests and the balance report). Returns a function that restores the previous one.
export function useTuning(next) {
  const previous = active;
  active = next;
  return () => { active = previous; };
}

// Chance in the full retest: a result moves by -1 or +1 correct answers with probability `retestSpread`
// each. The draw comes from a hash of room, table and round, so the same save always replays to the same
// result, restoring from JSON changes nothing, and different rooms and tables get different draws.
export function retestDelta(key) {
  const {retestSpread, draw} = active.randomness;
  if (!retestSpread) return 0;
  if (draw) return draw(key);
  const unit = Number.parseInt(hash53(key), 36) / 2 ** 53;
  return unit < retestSpread ? -1 : unit >= 1 - retestSpread ? 1 : 0;
}
