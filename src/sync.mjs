import { ROUNDS } from './scenario.mjs';
import { replay, gameScore, validateRecord } from './rules.mjs';
import { hash53 } from './hash.mjs';
import { trueNow, clockStatus } from './clock.mjs';
import { readSyncState, writeSyncState, newRecord } from './storage.mjs';

// Optional second copy of every locked decision in a Google Sheet (Apps Script web app).
// The game never depends on it: decisions are always saved locally first, the number of confirmed
// decisions is remembered per table, and a failed send is simply retried with the same events.
// Events carry a deterministic id, so the sheet can drop duplicates and a re-send is always safe.

const SEPARATOR = "␟";
const state = {endpoint: "", status: "off", total: 0, pending: 0, pendingNotes: 0, error: ""};
let sending = null;

export function configureSync(url) {
  const endpoint = String(url || "").trim();
  state.endpoint = /^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*)$/.test(endpoint) ? endpoint : "";
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
    const body = [record.room, record.team, seq, event.round, event.choice, event.method, event.at, event.evidence, event.tradeoff, event.problem ?? ""].join(SEPARATOR);
    chain = hash53(chain + SEPARATOR + body);
    const step = path[seq];
    return {
      id: record.room + ":" + record.team + ":" + seq + ":" + chain,
      room: record.room, team: record.team, market: record.market, session: record.session, seq,
      round: event.round, choice: event.choice, method: event.method, label: step.label, cost: step.cost, credits: step.credits,
      clientTime: event.at, evidence: event.evidence, tradeoff: event.tradeoff, problem: event.problem ?? "", chain, content: record.content || "",
      // After the last decision the hidden game result is known; the sheet shows it next to the team.
      game: seq === ROUNDS.length - 1 ? gameScore(record).total : ""
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

// One request to the sheet. A reply that cannot be read from this page (or no network) falls back to an opaque
// request; the result then says it was not confirmed.
async function post(payload, request) {
  const options = {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify(payload), redirect: "follow"};
  try {
    const response = await request(state.endpoint, options);
    if (!response.ok) throw new Error("The sheet answered with status " + response.status + ".");
    const reply = await response.json();
    if (!reply?.ok) throw new Error(reply?.error || "The sheet rejected the request.");
    return {reply, readable: true};
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await request(state.endpoint, {...options, mode: "no-cors"});
    return {reply: null, readable: false};
  }
}

const envelope = () => ({v: 1, sentAt: new Date(trueNow()).toISOString(), clockOffsetMs: Math.round(clockStatus().offset)});

// Worksheet notes and the Board Brief that changed since they were last sent.
export function buildNotesPayload(record, sent) {
  const items = [];
  const hashes = {};
  const at = new Date(trueNow()).toISOString();
  for (const [key, value] of Object.entries(record.notes)) {
    const hash = hash53(value);
    hashes[key] = hash;
    if (sent.notes[key] !== hash) {
      const [round, field] = key.split(".");
      items.push({round, field, text: value, at});
    }
  }
  const briefHash = hash53(record.brief);
  const briefChanged = sent.brief !== briefHash && (record.brief !== "" || sent.brief !== null);
  return {items, brief: briefChanged ? {text: record.brief, at} : null, hashes, briefHash};
}

async function run(record, request, force) {
  try {
    const events = buildEvents(record);
    let sent = force ? {count: 0, notes: {}, brief: null} : readSyncState(record.room, record.team, state.endpoint);
    const unsent = events.slice(sent.count);
    const notes = buildNotesPayload(record, sent);
    const notesWaiting = notes.items.length + (notes.brief ? 1 : 0);
    state.total = events.length;
    state.pending = unsent.length;
    state.pendingNotes = notesWaiting;
    if (!unsent.length && !notesWaiting) {
      state.status = events.length || Object.keys(record.notes).length ? (state.status === "unconfirmed" ? "unconfirmed" : "ok") : "idle";
      return syncStatus();
    }
    state.status = "sending";
    let readable = true;
    let rejected = 0;

    if (unsent.length) {
      const result = await post({...envelope(), events: unsent}, request);
      readable = readable && result.readable;
      const confirmed = result.readable ? confirmedPrefix(unsent, result.reply) : unsent.length;
      rejected += result.readable ? (result.reply.rejected || []).length : 0;
      sent = {...sent, count: sent.count + confirmed};
      writeSyncState(record.room, record.team, state.endpoint, sent);
      state.pending = unsent.length - confirmed;
    }
    if (notesWaiting && !state.pending) {
      const result = await post({...envelope(), type: "notes", room: record.room, team: record.team, market: record.market, session: record.session,
        items: notes.items, ...(notes.brief ? {brief: notes.brief} : {})}, request);
      readable = readable && result.readable;
      rejected += result.readable ? (result.reply.rejected || []).length : 0;
      sent = {...sent, notes: notes.hashes, brief: notes.briefHash};
      writeSyncState(record.room, record.team, state.endpoint, sent);
      state.pendingNotes = 0;
    }
    state.error = rejected ? "The sheet rejected " + rejected + " item(s)." : "";
    state.status = state.pending || state.pendingNotes ? "retry" : readable ? "ok" : "unconfirmed";
  } catch (error) {
    state.status = "retry";
    state.error = error.message || "The sheet could not be reached.";
  }
  return syncStatus();
}

// Sends every decision and note the sheet has not confirmed yet. Safe to call as often as needed;
// a call that arrives while one is running joins it.
export function flushSync(record, {request = globalThis.fetch, force = false} = {}) {
  if (!state.endpoint || record.mode !== "live") return Promise.resolve(syncStatus());
  if (!sending) sending = run(record, request, force).finally(() => { sending = null; });
  return sending;
}

export function syncSummary() {
  const {status, total, pending, pendingNotes, error} = state;
  const waiting = [pending ? pending + (pending === 1 ? " decision" : " decisions") : "", pendingNotes ? pendingNotes + (pendingNotes === 1 ? " note" : " notes") : ""].filter(Boolean).join(" and ");
  const text = {
    ok: "Google Sheets: all " + total + (total === 1 ? " decision is" : " decisions are") + " saved with your notes.",
    sending: "Google Sheets: sending…",
    idle: "Google Sheets: connected. Decisions and notes are sent as you write.",
    unconfirmed: "Google Sheets: sent, but the browser cannot read the reply. Check the sheet, or send again.",
    retry: "Google Sheets: " + waiting + " waiting to be sent. Retrying automatically." + (error ? " (" + error + ")" : "")
  }[status];
  return text ? {state: status, text} : null;
}

// ---- Reading from the sheet ------------------------------------------------------------------------------
// The sheet is the only store, so a page that has no local save asks it (a team continuing on another device),
// the facilitator's page reads every team from it, and the room and start time come from its Settings.

export function syncEnabled() {
  return !!state.endpoint;
}

async function read(query, request) {
  const url = state.endpoint + (state.endpoint.includes("?") ? "&" : "?") + new URLSearchParams(query);
  const response = await request(url, {method: "GET", redirect: "follow", cache: "no-store"});
  if (!response.ok) throw new Error("The sheet answered with status " + response.status + ".");
  const reply = await response.json();
  if (!reply?.ok) throw new Error(reply?.error || "The sheet could not answer.");
  return reply;
}

// {room, start}: what the facilitator opened. Empty room means nothing is open yet.
export async function fetchConfig({request = globalThis.fetch} = {}) {
  const reply = await read({action: "config"}, request);
  return {room: reply.room || "", start: reply.start || ""};
}

export async function fetchTeam(room, team, {request = globalThis.fetch} = {}) {
  return read({action: "team", room, team}, request);
}

export async function fetchRoom(room, token, {request = globalThis.fetch} = {}) {
  return read({action: "room", room, token}, request);
}

// The facilitator opens a room: it is stored in the sheet's Settings for the teams to read.
export async function publishRoom(room, start, token, {request = globalThis.fetch} = {}) {
  const response = await request(state.endpoint, {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, redirect: "follow",
    body: JSON.stringify({v: 1, type: "room", token, room, start: new Date(start).toISOString()})});
  const reply = await response.json();
  if (!reply?.ok) throw new Error(reply?.error || "The sheet did not accept the room.");
  return reply;
}

// A table's saved game rebuilt from what the sheet holds. The record is checked like any other save.
export function recordFromPayload(payload, market) {
  const notes = {};
  for (const item of payload.notes || []) notes[item.round + "." + item.field] = item.text;
  const base = newRecord("live", payload.room, payload.team, market);
  return validateRecord({
    ...base, notes, brief: payload.brief?.text ?? "",
    history: (payload.decisions || []).map(item => ({round: item.round, choice: item.choice, method: item.method, at: item.at,
      evidence: item.evidence, tradeoff: item.tradeoff, ...(item.problem ? {problem: item.problem} : {})}))
  });
}
