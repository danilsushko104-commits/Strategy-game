import { replay } from './rules.mjs';
import { hash53 } from './hash.mjs';
import { trueNow, clockStatus } from './clock.mjs';
import { readSynced, writeSynced } from './storage.mjs';

// Optional second copy of every locked decision in a Google Sheet (Apps Script web app).
// The game never depends on it: decisions are always saved locally first, the number of confirmed
// decisions is remembered per table, and a failed send is simply retried with the same events.
// Events carry a deterministic id, so the sheet can drop duplicates and a re-send is always safe.

const SEPARATOR = "␟";
const state = {endpoint: "", status: "off", total: 0, pending: 0, error: ""};
let sending = null;

export function configureSync(url) {
  const endpoint = String(url || "").trim();
  state.endpoint = /^https:\/\/[^\s]+$/.test(endpoint) ? endpoint : "";
  state.status = state.endpoint ? "idle" : "off";
  state.error = "";
}

export function syncStatus() {
  return {...state};
}

// One event per locked decision. Each carries a chain hash over everything locked before it,
// so a decision that was rewritten later produces a different chain for the same round.
export function buildEvents(record) {
  const {path} = replay(record);
  let chain = "";
  return record.history.map((event, seq) => {
    const body = [record.room, record.team, seq, event.round, event.choice, event.method, event.at, event.evidence, event.tradeoff].join(SEPARATOR);
    chain = hash53(chain + SEPARATOR + body);
    const step = path[seq];
    return {
      id: record.room + ":" + record.team + ":" + seq + ":" + chain,
      room: record.room, team: record.team, market: record.market, session: record.session, seq,
      round: event.round, choice: event.choice, method: event.method, label: step.label, cost: step.cost, credits: step.credits,
      clientTime: event.at, evidence: event.evidence, tradeoff: event.tradeoff, chain, content: record.content || ""
    };
  });
}

// The leading run of events that the sheet reports as stored (or already there).
function confirmedPrefix(events, reply) {
  const known = new Set([...(reply.saved || []), ...(reply.duplicates || [])]);
  let count = 0;
  while (count < events.length && known.has(events[count].id)) count++;
  return count;
}

async function transmit(events, request) {
  const body = JSON.stringify({
    v: 1, sentAt: new Date(trueNow()).toISOString(), clockOffsetMs: Math.round(clockStatus().offset), events
  });
  const options = {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body, redirect: "follow"};
  try {
    const response = await request(state.endpoint, options);
    if (!response.ok) throw new Error("The sheet answered with status " + response.status + ".");
    const reply = await response.json();
    if (!reply?.ok) throw new Error(reply?.error || "The sheet rejected the request.");
    return {confirmed: confirmedPrefix(events, reply), readable: true, rejected: reply.rejected || []};
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Offline, or the reply cannot be read from this origin. A request without a readable reply
    // can still reach the sheet: send once more as an opaque request and report it as unconfirmed.
    await request(state.endpoint, {...options, mode: "no-cors"});
    return {confirmed: events.length, readable: false, rejected: []};
  }
}

async function run(record, request, force) {
  try {
    const events = buildEvents(record);
    const done = force ? 0 : readSynced(record.room, record.team, state.endpoint);
    const unsent = events.slice(done);
    state.total = events.length;
    state.pending = unsent.length;
    if (!unsent.length) {
      state.status = events.length ? (state.status === "unconfirmed" ? "unconfirmed" : "ok") : "idle";
      return syncStatus();
    }
    state.status = "sending";
    const result = await transmit(unsent, request);
    writeSynced(record.room, record.team, state.endpoint, done + result.confirmed);
    state.pending = unsent.length - result.confirmed;
    state.error = result.rejected.length ? "The sheet rejected " + result.rejected.length + " decision(s)." : "";
    state.status = state.pending ? "retry" : result.readable ? "ok" : "unconfirmed";
  } catch (error) {
    state.status = "retry";
    state.error = error.message || "The sheet could not be reached.";
  }
  return syncStatus();
}

// Sends every decision the sheet has not confirmed yet. Safe to call as often as needed;
// a call that arrives while one is running joins it.
export function flushSync(record, {request = globalThis.fetch, force = false} = {}) {
  if (!state.endpoint || record.mode !== "live") return Promise.resolve(syncStatus());
  if (!sending) sending = run(record, request, force).finally(() => { sending = null; });
  return sending;
}

export function syncSummary() {
  const {status, total, pending, error} = state;
  const text = {
    ok: "Google Sheets: all " + total + (total === 1 ? " decision is" : " decisions are") + " saved.",
    sending: "Google Sheets: sending…",
    idle: "Google Sheets: connected. Decisions are sent when they are locked.",
    unconfirmed: "Google Sheets: sent, but the browser cannot read the reply. Check the sheet, or send again.",
    retry: "Google Sheets: " + pending + (pending === 1 ? " decision is" : " decisions are") + " waiting to be sent. Retrying automatically." + (error ? " (" + error + ")" : "")
  }[status];
  return text ? {state: status, text} : null;
}
