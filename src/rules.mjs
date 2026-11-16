import { CONFIG, MARKETS, ROUNDS, WORKSHEET, RUBRIC, BRIEF, BULLETINS, SINGAPORE, PROBLEMS } from './scenario.mjs';
import { hash32 } from './hash.mjs';
import { tuning, retestDelta } from './tuning.mjs';

export const SCHEDULE = [
  [-20, 0, "SETUP", "Team assignments, Board brief and practice"],
  [0, 16, "R1", "Customer and CAGE"],
  [16, 32, "R2", "Customer evidence"],
  [32, 50, "R3", "Entry route and Uppsala"],
  [50, 60, "R4", "Readiness and checkpoint"],
  [60, 70, "BREAK", "Break and JSON checkpoint"],
  [70, 84, "R5", "Competitor response"],
  [84, 104, "R6", "Emergency · bulletin B at +8 minutes"],
  [104, 119, "R7", "Recommendation"],
  [119, 130, "PREP", "Board Brief preparation"],
  [130, 146, "PITCH", "Four pitches · 3 minutes and 1 question each"],
  [146, 150, "DEBRIEF", "Funding decision and debrief"]
].map(([from, to, id, label]) => ({from, to, id, label}));

const MINUTE = 60_000;
export const TEAMS = [1, 2, 3, 4];
export const PRICE = {
  interview: 2, prototype: 3, pilot: 2, alliance: 3, acquisition: 5,
  verify: 2, narrow: 1, broaden: 2, diligence: 1, targeted: 1,
  fullOne: 3, fullTwo: 4
};
// Base price plus the market's own adjustment (see tuning.mjs). Never below zero.
export function price(marketId, key) {
  return Math.max(0, PRICE[key] + (tuning().markets[marketId]?.price?.[key] ?? 0));
}

// The problem a profile's emergency note is about (the first one when it is about two).
export function problemFor(marketId, profileKey) {
  return MARKETS[marketId].profiles[profileKey].problems[0];
}

const ROUTES = { pilot: "Pilot with local provider", alliance: "Contractual alliance", acquisition: "Prepare an acquisition", planning: "Preparation without a selected route" };
export const OUTCOMES = {
  pilot2: ["Conditional pilot with two cohorts", "Request approval for two cohorts subject to confirmed permissions, provider readiness for each channel and the named launch condition. Name what you would do if one cohort misses its threshold."],
  pilot: ["Conditional first pilot", "Request approval for one cohort subject to confirmed permissions, provider readiness and the named launch condition. Add a second cohort only if it survived the correction and the first cohort meets your threshold."],
  deal: ["Conditional acquisition work", "Request continued deal work against the named closing condition. Closing, permissions, operational readiness and a separate launch decision remain ahead."],
  retest: ["Fund a supervised test", "Request one mock cohort without live funds or public launch. Return to the Board with proof against your stated milestone."],
  defer: ["Fund preparation and defer", "Request a specific preparation step. Name the unresolved obstacle, evidence required and review date."]
};

// Fingerprint of everything a team reads or is charged for. Saves remember it, so a page that was
// republished with different content can warn instead of silently showing other results.
// Changes to the rule logic itself are covered by CONFIG.version.
const tuned = tuning();
export const CONTENT_ID = hash32(JSON.stringify([MARKETS, ROUNDS, PROBLEMS, BULLETINS, WORKSHEET, RUBRIC, BRIEF, SINGAPORE, PRICE, SCHEDULE, OUTCOMES, CONFIG.budget,
  tuned.name, tuned.gameShare, tuned.askPilotTwo, tuned.scoring, tuned.markets, tuned.randomness.retestSpread]));

export function contentMismatch(record) {
  return !!record?.content && record.content !== CONTENT_ID;
}

function permutations(items) {
  if (items.length === 1) return [items];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, rest) => rest !== index)).map(rest => [item, ...rest]));
}

const assignments = permutations(Object.keys(MARKETS));

export function makeRoom(start, assignmentIndex, suffix) {
  return "OMF-" + Math.floor(start / MINUTE).toString(36).toUpperCase() + "-" +
    assignmentIndex.toString(36).toUpperCase() + suffix.toUpperCase();
}

function roomParts(value) {
  return /^OMF-([A-Z0-9]{5,7})-([0-9A-N])([A-Z0-9]{3})$/.exec(String(value).trim().toUpperCase());
}

export function roomStart(value) {
  const match = roomParts(value);
  if (!match) return null;
  const start = parseInt(match[1], 36) * MINUTE;
  return start >= Date.UTC(2025, 0, 1) && start <= Date.UTC(2100, 0, 1) ? start : null;
}

export function marketForTable(room, team) {
  const match = roomParts(room);
  return match ? assignments[parseInt(match[2], 36)]?.[team - 1] : null;
}

export function phaseAt(room, now) {
  const minute = (now - roomStart(room)) / MINUTE;
  const phase = SCHEDULE.find(item => minute >= item.from && minute < item.to);
  return phase ? {...phase, minute, bulletinB: phase.id === "R6" && minute >= 92} :
    {id: minute < 0 ? "SETUP" : "END", minute, to: minute < 0 ? 0 : null, bulletinB: false};
}

function endOfRound(room, id) {
  return roomStart(room) + SCHEDULE.find(phase => phase.id === id).to * MINUTE;
}

function startOfRound(room, id) {
  return roomStart(room) + SCHEDULE.find(phase => phase.id === id).from * MINUTE;
}

export function initialProgress() {
  return {
    credits: CONFIG.budget, profile: null, research: null, route: null, verified: false, narrow: false,
    cohorts: 1, diligence: false, incident: null, launchEvidence: false, result: null
  };
}

function option(id, cost, label, description, blocked = "") {
  return {id, cost, label, description, blocked};
}

export function optionsFor(id, state, marketId) {
  const market = MARKETS[marketId];
  const profile = market.profiles[state.profile];
  let options;
  switch (id) {
    case "R1":
      options = Object.entries(market.profiles).map(([key, item]) => option(key, 0, item.name, item.journey));
      break;
    case "R2":
      options = [
        option("desk", 0, "Keep the base dossier", "Use the market facts and first customer signal. Preserve credits for entry or the emergency."),
        option("interview", price(marketId, "interview"), "Buy an interview follow-up", "Get evidence about why this segment might switch. This measures stated preferences."),
        option("prototype", price(marketId, "prototype"), "Test the mock journey", "Get a result on how users interpret the quote, status or support screen. No money moves.")
      ];
      break;
    case "R3":
      options = [
        option("pilot", price(marketId, "pilot"), ROUTES.pilot, "Scope one use case, in one city, with one cohort. The local provider handles any authorized activity after permission and readiness checks."),
        option("alliance", price(marketId, "alliance"), ROUTES.alliance, "Prepare a co-branded offer and define distribution and support responsibilities. In R5 you may add a second cohort if you can afford it."),
        option("acquisition", price(marketId, "acquisition"), ROUTES.acquisition, "Screen the target, plan diligence and integration. The deeper transaction check in R5 is needed for a deal mandate at the Board.")
      ];
      break;
    case "R4":
      options = [
        option("reserve", 0, "Keep a reserve", "Record a permission or contract dependency. Pay the standard rates if you later need to issue and test a correction."),
        option("verify", price(marketId, "verify"), "Verify readiness", "Buy a scoped finding and pre-agreed correction wording. An approved one-channel correction is free. A full correction and retest costs one credit less.")
      ];
      break;
    case "R5":
      options = [
        option("keep", 0, "Keep your proposition", "Keep the use case and one channel. Defend a claim the competitor still leaves open."),
        option("narrow", price(marketId, "narrow"), "Narrow and test the proposition", "Keep the R1 profile. Limit the corridor, subgroup or promise and unlock a five-person mock result. You may reuse the tested scope for a targeted correction."),
        option("broaden", price(marketId, "broaden"), "Add a second cohort and channel", "Reach a second group in the same city and segment. Full correction costs more when two channels are exposed.",
          state.route === "alliance" ? "" : "Available on the alliance route."),
        option("diligence", price(marketId, "diligence"), "Investigate the deal’s main risk", "Get a target-specific finding and a closing condition. This qualifies you to request deal work once outreach has been corrected.",
          state.route === "acquisition" ? "" : "Available on the acquisition route.")
      ];
      break;
    case "R6":
      options = [
        option("hold", 0, "Hold outreach", "Publish a holding statement and document the incident. The next ask can fund preparation and a later review."),
        option("targeted", state.verified ? 0 : price(marketId, "targeted"), "Correct one channel", "Pick the problem you are correcting and pause all uncorrected messages. Keep one cohort. If you name what your customers actually misunderstood, readiness verification or the narrow mock test lets you validate the correction in that cohort."),
        option("full", (state.cohorts === 2 ? price(marketId, "fullTwo") : price(marketId, "fullOne")) - Number(state.verified),
          "Correct every channel and retest", "Correct all planned channels and run a mock comprehension check with 20 people per cohort. Each cohort needs at least 16 correct responses. A prior prototype, preparation of approved wording or a narrowed test can improve the result. Real tests vary: a result can land one answer above or below the expectation.")
      ];
      break;
    case "R7": {
      const pilotBlock = !["pilot", "alliance"].includes(state.route) ? "Requires a pilot or alliance route." :
        state.launchEvidence ? "" : "Requires evidence that users understood the corrected offer.";
      const dealBlock = state.route !== "acquisition" ? "Requires the acquisition route." :
        !state.diligence ? "Requires the R5 deal-risk check." :
        state.incident === "hold" ? "Requires at least a targeted public correction in R6." : "";
      const pilotTwoBlock = state.route !== "alliance" ? "Requires the alliance route." :
        state.cohorts !== 2 ? "Requires two cohorts from the second-channel step." :
        state.launchEvidence ? "" : "Requires evidence that users in both cohorts understood the corrected offer.";
      options = [
        ...(tuning().askPilotTwo ? [option("pilot2", 0, "Request conditional approval for a pilot with two cohorts",
          "The Board can approve both cohorts. Each cohort still depends on the stated launch conditions.", pilotTwoBlock)] : []),
        option("pilot", 0, "Request conditional approval for a pilot", "The Board can approve the next step. Live activity still depends on the stated launch conditions.", pilotBlock),
        option("deal", 0, "Request a conditional mandate for deal work", "Request deeper diligence or negotiation against a specific closing condition. A go-live decision follows separately.", dealBlock),
        option("retest", 0, "Request one revised mock test", "Use one cohort with no live funds. Return to the Board before seeking pilot approval.",
          state.incident === "hold" ? "Outreach is on hold. Request preparation and a review instead." : ""),
        option("defer", 0, "Defer live activity and fund preparation", "Request one preparatory step and set a condition and a date for returning to the Board.")
      ];
      break;
    }
    default: throw new Error("Unknown round.");
  }

  return options.map(item => ({
    ...item,
    blocked: item.blocked || (item.cost > state.credits ? "Needs " + item.cost + " credits. You have " + state.credits + "." : "")
  }));
}

function fallbackFor(round, state, marketId) {
  if (round.id === "R3") return option("planning", 0, ROUTES.planning, "Continue with one mock cohort. There is no live entry route to present.");
  return optionsFor(round.id, state, marketId).find(item => item.id === round.fallback);
}

function dealClause(route) {
  return {
    pilot: "Check that the local provider is ready and permitted to run the specified activity. The provider must approve claims about fees and availability.",
    alliance: "Set the exact approval responsibility in the draft agreement. Both firms must clear a co-branded public offer before release.",
    acquisition: "Check which permissions, vendor terms and claims would survive a change of control. The target’s existing arrangements do not carry over automatically."
  }[route] || "Scope a mock test and identify a licensed provider before discussing any live activity.";
}

export function pendingFact(round, state, marketId) {
  const market = MARKETS[marketId];
  const profile = market.profiles[state.profile];
  return {
    R2: profile?.signal,
    R4: dealClause(state.route),
    R5: profile?.competitor,
    R7: "The Board can fund one next step and reserve first-launch priority for that market. State exactly what it is being asked to approve."
  }[round];
}

function responseResult(state, selection, profile, marketId, record, problem) {
  if (selection === "hold") return {
    incident: "hold", launchEvidence: false, cohorts: state.cohorts,
    result: "Outreach stopped. Preserve the evidence and propose a review date."
  };
  if (selection === "targeted") {
    const loss = state.cohorts === 2 ? "The second cohort is removed. " : "";
    const label = PROBLEMS.find(item => item.id === problem)?.label.split(":")[0].toLowerCase() ?? "that";
    if (!profile.problems.includes(problem)) {
      // Naming another problem corrects something the customers were not confused about.
      return {
        cohorts: 1, incident: "targeted", launchEvidence: false,
        result: loss + "The correction addresses " + label + ", but your customers were confused about something else, so it does not reach them. " +
          "No comprehension result is available. A new test is needed before a pilot ask."
      };
    }
    const proven = state.verified || state.narrow;
    const reason = state.verified ? "The prior wording review supports a scoped follow-up." :
      state.narrow ? "The earlier narrow prototype supports a scoped follow-up." : "";
    return {
      cohorts: 1, incident: "targeted", launchEvidence: proven,
      result: loss + (proven ? reason + " Four of five mock users in the retained cohort understood the correction. The result supports a conditional proposal for that scope." :
        "One channel is corrected. No comprehension result is available yet. A new test is needed before a pilot ask.")
    };
  }
  const advantage = state.narrow ? 2 : Number(state.verified || state.research === "prototype");
  const shift = tuning().markets[marketId]?.testShift ?? 0;
  // A live room fixes the draw (room, table, round). A practice table uses its own session, so rehearsals differ.
  const seed = record.mode === "practice" ? "practice-" + record.session : record.room;
  const draw = cohort => retestDelta([seed, record.team, "R6", cohort].join("|"));
  const clamp = value => Math.min(20, Math.max(0, value));
  const firstBase = state.narrow ? 18 : state.cohorts === 2 ? 16 + advantage : 15 + advantage;
  const firstResult = clamp(firstBase + shift + draw(1));
  const counts = state.cohorts === 2 ? [firstResult, clamp(17 + shift + draw(2))] : [firstResult];
  const launchEvidence = counts.every(count => count >= 16);
  return {
    incident: "full", launchEvidence, cohorts: state.cohorts,
    result: "Full retest: " + counts.map((count, index) => "cohort " + (index + 1) + " " + count + "/20").join(", ") +
      " correctly identified the scope and corrected claim. The threshold is 16/20 in each cohort. " +
      (launchEvidence ? "The retest met the threshold. " : "The retest missed the threshold. A revised test is needed for a pilot. ") + profile.incident
  };
}

function applyChoice(state, round, selection, marketId, record, event) {
  const market = MARKETS[marketId];
  const profile = market.profiles[state.profile];
  const next = {...state, credits: state.credits - selection.cost, result: null};
  switch (round.id) {
    case "R1":
      next.profile = selection.id;
      next.result = "Selected " + market.profiles[selection.id].name + ". The dossier and later events follow this profile.";
      break;
    case "R2":
      next.research = selection.id;
      next.result = {desk: "The base dossier is your evidence. Record what you would test next.", interview: profile.interview, prototype: profile.prototype}[selection.id];
      break;
    case "R3":
      next.route = selection.id;
      next.result = market.candidates[selection.id]?.join(" · ") || selection.description;
      break;
    case "R4":
      next.verified = selection.id === "verify";
      next.result = next.verified ? "Scoped review: " + profile.review + " Use the approved template: ‘This is a concept test for [scope]. Availability, timing and fees depend on [conditions]. For questions: [approved contact].’ This supports a one-channel follow-up and lowers the cost of the full retest." :
        "Reserve retained. The open condition remains: " + dealClause(state.route);
      break;
    case "R5":
      next.narrow = selection.id === "narrow";
      next.diligence = selection.id === "diligence";
      next.cohorts = selection.id === "broaden" ? 2 : 1;
      next.result = {keep: "One cohort. The key claim still needs to stand up to the rival’s offer.", narrow: profile.narrow,
        broaden: "Two cohorts and two channels. A targeted correction retains one cohort. A full retest can keep both.", diligence: market.diligence}[selection.id];
      break;
    case "R6":
      Object.assign(next, responseResult(state, selection.id, profile, marketId, record, event?.problem));
      break;
    case "R7":
      next.result = OUTCOMES[selection.id][1];
      break;
  }
  return next;
}

// A decision needs a choice, evidence and a trade-off; correcting one channel in R6 also needs the problem.
export function isDraftComplete(draft, roundId) {
  const basic = !!draft?.choice && !!draft.evidence?.trim() && !!draft.tradeoff?.trim();
  return basic && (roundId !== "R6" || draft.choice !== "targeted" || PROBLEMS.some(item => item.id === draft.problem));
}

function resolveChoice(event, round, state, marketId) {
  if (event.method === "default") {
    const fallback = fallbackFor(round, state, marketId);
    if (event.choice !== fallback.id) throw new Error("Unexpected default in " + round.id + ".");
    return fallback;
  }
  if (!["submitted", "deadline"].includes(event.method) || !isDraftComplete(event, round.id)) {
    throw new Error("Incomplete decision in " + round.id + ".");
  }
  const chosen = optionsFor(round.id, state, marketId).find(item => item.id === event.choice);
  if (!chosen || chosen.blocked) throw new Error(chosen?.blocked || "Invalid choice in " + round.id + ".");
  return chosen;
}

export function replay(record) {
  let state = initialProgress();
  const path = record.history.map((event, index) => {
    const round = ROUNDS[index];
    if (!round || event.round !== round.id) throw new Error("Decisions are out of order.");
    const chosen = resolveChoice(event, round, state, record.market);
    state = applyChoice(state, round, chosen, record.market, record, event);
    return {...event, label: chosen.label, cost: chosen.cost, credits: state.credits, result: state.result, state};
  });
  return {state, path};
}

function newDecision(record, progress, round, method, now) {
  const draft = record.drafts[round.id] || {};
  const choice = method === "default" ? fallbackFor(round, progress, record.market).id : draft.choice;
  const event = {round: round.id, method, choice, at: new Date(now).toISOString(), evidence: draft.evidence || "", tradeoff: draft.tradeoff || "",
    ...(round.id === "R6" && choice === "targeted" ? {problem: draft.problem} : {})};
  if (method !== "default") resolveChoice(event, round, progress, record.market);
  return {...record, history: [...record.history, event]};
}

export function settleDeadlines(record, now) {
  if (record.mode !== "live") return record;
  for (const round of ROUNDS.slice(record.history.length)) {
    const deadline = endOfRound(record.room, round.id);
    if (now < deadline) break;
    const {state} = replay(record);
    const draft = record.drafts[round.id];
    const valid = isDraftComplete(draft, round.id) && optionsFor(round.id, state, record.market).some(item => item.id === draft.choice && !item.blocked);
    record = newDecision(record, state, round, valid ? "deadline" : "default", deadline);
  }
  return record;
}

export function lockRound(record, roundId, now, useDefault = false) {
  const round = ROUNDS[record.history.length];
  if (round?.id !== roundId) throw new Error("This round is already closed.");
  assertOpen(record, roundId, now);
  if (roundId === "R6" && !canReadBulletinB(record, now)) throw new Error("Wait for bulletin B before locking a response.");
  if (useDefault && record.mode === "live") throw new Error("The classroom default applies when the round closes.");
  return newDecision(record, replay(record).state, round, useDefault ? "default" : "submitted", now);
}

export function canReadBulletinB(record, now) {
  return record.mode === "practice" ? record.bulletinB :
    now >= roomStart(record.room) + 92 * MINUTE;
}

export function assertOpen(record, roundId, now) {
  const round = ROUNDS.find(item => item.id === roundId);
  if (!round) throw new Error("Unknown round.");
  if (record.mode === "live") {
    if (phaseAt(record.room, now).id !== roundId) throw new Error("This round is not open.");
  } else {
    const active = ROUNDS[record.history.length]?.id;
    const justLocked = record.history.at(-1)?.round;
    if (active !== roundId && justLocked !== roundId) throw new Error("This practice round is closed.");
  }
}

export function updateDraft(record, roundId, field, value, now) {
  assertOpen(record, roundId, now);
  if (ROUNDS[record.history.length]?.id !== roundId) throw new Error("The decision has already been locked.");
  if (field === "choice") {
    if (roundId === "R6" && !canReadBulletinB(record, now)) throw new Error("Wait for bulletin B.");
    const selected = optionsFor(roundId, replay(record).state, record.market).find(item => item.id === value && !item.blocked);
    if (!selected) throw new Error("This choice is unavailable.");
  } else if (field === "problem") {
    if (roundId !== "R6" || !PROBLEMS.some(item => item.id === value)) throw new Error("Choose one of the listed problems.");
  } else if (field !== "evidence" && field !== "tradeoff") throw new Error("Unknown draft field.");
  const draft = {...record.drafts[roundId], [field]: value.slice(0, CONFIG.maxNote)};
  return {...record, drafts: {...record.drafts, [roundId]: draft}};
}

export function updateNote(record, roundId, field, value, now) {
  assertOpen(record, roundId, now);
  if (!WORKSHEET[roundId]?.some(item => item[0] === field)) throw new Error("Unknown worksheet field.");
  return {...record, notes: {...record.notes, [roundId + "." + field]: value.slice(0, CONFIG.maxNote)}};
}

export function updateBrief(record, value, now) {
  const ready = record.mode === "practice" ? record.history.length === ROUNDS.length : phaseAt(record.room, now).id === "PREP";
  if (!ready) throw new Error("The Board Brief is closed for editing.");
  return {...record, brief: value.slice(0, CONFIG.maxNote * 3)};
}

function normalizeNotes(source) {
  const notes = {};
  for (const [round, fields] of Object.entries(WORKSHEET)) {
    for (const [field] of fields) {
      const key = round + "." + field;
      if (typeof source?.[key] === "string") notes[key] = source[key].slice(0, CONFIG.maxNote);
    }
  }
  return notes;
}

function cleanText(value) {
  return typeof value === "string" ? value.slice(0, CONFIG.maxNote) : "";
}

export function validateRecord(record) {
  if (record?.game !== CONFIG.game || record.version !== CONFIG.version) throw new Error("This file belongs to another game or rules version.");
  const {mode, team, market, room, history} = record;
  if (!["live", "practice"].includes(mode) || !TEAMS.includes(team) || !Object.hasOwn(MARKETS, market) ||
      (mode === "live" ? roomStart(room) === null || room !== room.trim().toUpperCase() || marketForTable(room, team) !== market : room !== "PRACTICE") ||
      !Array.isArray(history) || history.length > ROUNDS.length) throw new Error("Invalid team or room record.");
  const clean = {
    game: CONFIG.game, version: CONFIG.version, mode, team, market, room,
    session: cleanText(record.session), content: typeof record.content === "string" ? record.content.slice(0, 16) : "", history: [], drafts: {},
    notes: normalizeNotes(record.notes), bulletinB: mode === "practice" && record.bulletinB === true,
    brief: typeof record.brief === "string" ? record.brief.slice(0, CONFIG.maxNote * 3) : ""
  };
  if (!clean.session) throw new Error("The record is missing a session ID.");
  if (mode === "practice" && history.length >= 6 && !clean.bulletinB) throw new Error("The emergency decision is missing bulletin B.");
  clean.history = history.map((event, index) => {
    const round = ROUNDS[index];
    const at = Date.parse(event?.at);
    if (!Number.isFinite(at)) throw new Error("Invalid timestamp in " + round.id + ".");
    if (mode === "live") {
      const first = startOfRound(room, round.id) + (round.id === "R6" && event.method === "submitted" ? 8 * MINUTE : 0);
      const last = endOfRound(room, round.id);
      const timely = event.method === "submitted" ? at >= first && at < last : at === last;
      if (!timely) throw new Error("Decision timestamp does not match the room schedule.");
    }
    return {round: event.round, choice: event.choice, method: event.method, at: new Date(at).toISOString(),
      evidence: cleanText(event.evidence), tradeoff: cleanText(event.tradeoff),
      ...(typeof event.problem === "string" && event.problem ? {problem: event.problem.slice(0, 24)} : {})};
  });
  replay(clean);
  for (const {id} of ROUNDS) {
    const draft = record.drafts?.[id];
    if (!draft || typeof draft !== "object") continue;
    clean.drafts[id] = {choice: cleanText(draft.choice), evidence: cleanText(draft.evidence), tradeoff: cleanText(draft.tradeoff),
      ...(typeof draft.problem === "string" && draft.problem ? {problem: draft.problem.slice(0, 24)} : {})};
  }
  return clean;
}

function checkedCount(expert, row) {
  const checks = expert?.checks?.[row];
  return Array.isArray(checks) ? checks.slice(0, 4).filter(check => check === true).length : 0;
}

// One expert's points: every ticked check is worth a quarter of its row's weight.
export function scoreExpert(expert) {
  let written = 0;
  let oral = 0;
  let uppsala = 0;
  RUBRIC.forEach(([section, name, weight], index) => {
    const points = checkedCount(expert, index) * weight / 4;
    if (section === "Written") written += points;
    else oral += points;
    if (name === "Uppsala and entry route") uppsala += points;
  });
  return {written, oral, uppsala, total: written + oral};
}

export function scoreJury(submissions) {
  if (!Array.isArray(submissions) || submissions.length !== 3 || ![0, 1, 2].every(index => submissions[index]?.complete)) return null;
  let written = 0;
  let oral = 0;
  let uppsala = 0;
  for (const expert of submissions) {
    const score = scoreExpert(expert);
    written += score.written;
    oral += score.oral;
    uppsala += score.uppsala;
  }
  return {written: written / 3, oral: oral / 3, uppsala: uppsala / 3, total: (written + oral) / 3};
}

export function compareScores(a, b) {
  return b.total - a.total || b.oral - a.oral || b.uppsala - a.uppsala;
}

// The hidden game result, 0-100: what the Board can be asked for, how well the ask is supported by evidence
// and how much budget was kept. It is built from the saved state, so it needs no extra storage.
export function gameScore(record) {
  const {state, path} = replay(record);
  if (path.length !== ROUNDS.length) return null;
  const table = tuning().scoring;
  const ask = path.at(-1).choice;
  const parts = [["Request to the Board · " + ask, table.ask[ask] ?? 0], ["Customer research · " + state.research, table.research[state.research] ?? 0]];
  if (state.verified) parts.push(["Readiness check", table.verified]);
  if (state.narrow) parts.push(["Narrowed proposition", table.narrow]);
  const response = {hold: table.response.hold, targeted: state.launchEvidence ? table.response.targetedProven : table.response.targetedOpen,
    full: state.launchEvidence ? table.response.fullPassed : table.response.fullFailed}[state.incident];
  parts.push(["Emergency response · " + state.incident, response ?? 0]);
  if (ask === "pilot" && state.cohorts === 2 && state.launchEvidence) parts.push(["Second cohort kept", table.secondCohort]);
  if (ask === "deal" && state.incident === "full") parts.push(["Whole campaign corrected before the deal ask", table.dealFullCorrection]);
  // Unspent credits only count when there is a real step to fund, so hoarding behind a deferral earns nothing.
  if (["pilot", "pilot2", "deal"].includes(ask)) parts.push(["Reserve kept", Math.min(state.credits, table.creditCap) * table.credit]);
  const total = Math.min(100, Math.max(0, parts.reduce((sum, [, points]) => sum + points, 0)));
  return {total, parts: parts.map(([label, points]) => ({label, points}))};
}

// The final grade: expert score (0-100) and game score (0-100) in the configured proportion.
export function finalScore(jury, game, share = tuning().gameShare) {
  return jury * (1 - share) + game * share;
}

// Table by table: the expert score, the game result (from the imported team JSON) and the final grade.
// The final grade needs the game result only while the game counts towards the grade.
export function standings(grades, records = {}) {
  const share = tuning().gameShare;
  const rows = TEAMS.map(team => {
    const jury = scoreJury(grades?.[team]);
    const game = share > 0 && records?.[team] ? (gameScore(records[team])?.total ?? null) : null;
    const ready = !!jury && (share === 0 || game !== null);
    const final = ready ? finalScore(jury.total, game ?? 0, share) : null;
    return {team, jury, game, final, key: ready ? {total: final, oral: jury.oral, uppsala: jury.uppsala} : null};
  });
  const ranks = rankScores(rows.map(row => row.key));
  return rows.map((row, index) => ({...row, rank: ranks[index],
    tied: !!row.key && rows.some((other, rival) => rival !== index && other.key && compareScores(other.key, row.key) === 0)}));
}

// The facilitator's "what's next" list. Only the facilitator's own browser knows these facts: the room,
// the clock, the imported team files and the expert sheets. Whether the teams have joined cannot be seen,
// so that step is ticked by hand.
export function hostChecklist({room, now, grades, records, joined}) {
  const phase = phaseAt(room, now);
  const counted = tuning().gameShare > 0;
  const full = TEAMS.filter(team => records?.[team]?.history?.length === ROUNDS.length);
  const partial = TEAMS.filter(team => records?.[team] && records[team].history.length < ROUNDS.length);
  const missing = TEAMS.filter(team => !full.includes(team));
  const sheets = TEAMS.reduce((sum, team) => sum + [0, 1, 2].filter(expert => grades?.[team]?.[expert]?.complete).length, 0);
  const ranked = standings(grades, records).every(row => row.key);
  const finished = ["PREP", "PITCH", "DEBRIEF", "END"].includes(phase.id);
  const list = (tables) => tables.map(team => "table " + team).join(", ");
  const steps = [
    {id: "room", title: "Room created", done: true,
      detail: "Show the room code and the table assignment to the students."},
    // An imported team file, or a finished game, proves that the tables were in.
    {id: "joined", title: "Every table has joined", done: !!joined || finished || TEAMS.some(team => records?.[team]),
      detail: "Each team opens the page and enters the room code with its table number. This page cannot see the teams, so tick the box once you have checked."},
    {id: "game", title: "The game is played", done: finished,
      detail: finished ? "All seven rounds are over." : phase.id === "SETUP" ? "R1 has not started yet." : "The rounds are running."},
    {id: "files", title: "Team files collected", done: counted ? full.length === TEAMS.length : true,
      detail: (counted ? "" : "Optional without a game result. ") + full.length + " of " + TEAMS.length + " tables imported with all " + ROUNDS.length + " decisions" +
        (missing.length ? ". Missing: " + list(missing) : "") + (partial.length ? ". Incomplete (a checkpoint): " + list(partial) : "") + "."},
    {id: "sheets", title: "Expert sheets complete", done: sheets === TEAMS.length * 3,
      detail: sheets + " of " + TEAMS.length * 3 + " sheets are marked complete (three experts for each of four tables)."},
    {id: "ranking", title: "Ranking and export", done: ranked,
      detail: ranked ? "The ranking is ready: check it and export the scores." : "Ready when the two steps above are done."}
  ];
  const current = steps.findIndex(step => !step.done);
  const next = {
    joined: "Ask every team to open the page and join with the room code and its table number.",
    game: phase.id === "SETUP" ? "Wait for R1. Explain the mandate and run the practice example." : "Run the seminar. Teams download a checkpoint JSON at the break.",
    files: "After R7 each team presses Download team JSON. Import every file in the score sheets section.",
    sheets: "The three experts complete their score sheets for every table.",
    ranking: "Check the ranking and export the CSV."
  }[steps[current]?.id] ?? "Everything is done. Keep the team journals and the exported scores.";
  return {phase, steps: steps.map((step, index) => ({...step, state: step.done ? "done" : index === current ? "now" : "later"})), next};
}

// Competition ranking: equal scores share a rank. Entries without a score have no rank.
export function rankScores(scores) {
  return scores.map(score => score ? 1 + scores.filter(other => other && compareScores(other, score) < 0).length : null);
}
