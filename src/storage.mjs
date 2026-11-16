import { CONFIG } from './scenario.mjs';
import { TEAMS, roomStart, validateRecord, CONTENT_ID } from './rules.mjs';

const prefix = CONFIG.game + ":" + CONFIG.version;
const memory = new Map();
let writable = true;

export function storageAvailable() {
  return writable;
}

export function getStored(key) {
  if (writable) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) memory.delete(key);
      else memory.set(key, value);
      return value;
    } catch {
      writable = false;
    }
  }
  return memory.get(key) ?? null;
}

export function putStored(key, value) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  if (writable) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      writable = false;
    }
  }
}

export function teamKey(room, team) {
  return prefix + ":" + room + ":team:" + team;
}

export function hostKey(room) {
  return prefix + ":" + room + ":facilitator";
}

function backupKey(room, team) {
  return prefix + ":" + room + ":backup:" + team;
}

const SNAPSHOTS = ["bak1", "bak2"];

// A save that cannot be opened. The app offers recovery instead of a dead end.
export class SaveError extends Error {
  constructor(message, {room, team} = {}) {
    super(message);
    this.name = "SaveError";
    this.room = room;
    this.team = team;
  }
}

function parseSlot(raw, room, team) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new SaveError("The saved data is damaged and cannot be read.", {room, team}); }
  try {
    const record = validateRecord(parsed);
    if (record.room !== room || record.team !== team) throw new Error("This saved record belongs to a different table.");
    return record;
  } catch (error) {
    throw new SaveError(error.message || "The saved game could not be read.", {room, team});
  }
}

export function readSlot(room, team) {
  const raw = getStored(teamKey(room, team));
  return raw === null ? null : parseSlot(raw, room, team);
}

function historyLength(raw) {
  try {
    const length = JSON.parse(raw)?.history?.length;
    return Number.isInteger(length) ? length : -1;
  } catch {
    return -1;
  }
}

// Every time the list of locked decisions changes, the previous good save moves into a two-step ring.
// Draft edits do not rotate the ring, so the snapshots stay one decision apart.
function rotateSnapshots(key, previous) {
  const [first, second] = SNAPSHOTS.map(slot => key + ":" + slot);
  const older = getStored(first);
  if (older !== null) {
    putStored(second, older);
    void mirrorPut(second, older);
  }
  putStored(first, previous);
  void mirrorPut(first, previous);
}

export function storeRecord(record) {
  const key = teamKey(record.room, record.team);
  const next = JSON.stringify(record);
  const previous = getStored(key);
  if (previous !== null && previous !== next) {
    const before = historyLength(previous);
    if (before >= 0 && before !== record.history.length) rotateSnapshots(key, previous);
  }
  putStored(key, next);
  void mirrorPut(key, next);
}

export function clearSlot(room, team) {
  const key = teamKey(room, team);
  for (const name of [key, ...SNAPSHOTS.map(slot => key + ":" + slot), backupKey(room, team)]) {
    putStored(name, null);
    void mirrorPut(name, null);
  }
}

// ---- Second copy in IndexedDB -------------------------------------------------------------
// Protects against failed or partial localStorage writes, quota errors and damaged values.
// Browsers usually clear both stores together, so a downloaded JSON file remains the real backup.

const mirrorState = {ok: null};
let mirrorDatabase = null;

function openMirror() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(prefix, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
}

function database() {
  mirrorDatabase ||= openMirror().catch(() => null);
  return mirrorDatabase;
}

function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", mode);
    const result = work(tx.objectStore("kv"));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function mirrorPut(key, value) {
  try {
    const db = await database();
    if (!db) { mirrorState.ok = false; return; }
    await transaction(db, "readwrite", store => value === null ? store.delete(key) : store.put(value, key));
    mirrorState.ok = true;
  } catch {
    mirrorState.ok = false;
  }
}

export async function mirrorGet(key) {
  try {
    const db = await database();
    if (!db) return null;
    return (await transaction(db, "readonly", store => store.get(key))) ?? null;
  } catch {
    return null;
  }
}

export function mirrorStatus() {
  return mirrorState.ok;
}

// ---- Recovery -----------------------------------------------------------------------------

// Readable copies of a table's save: the two snapshots and the IndexedDB mirror, best first.
export async function recoveryOptions(room, team) {
  const key = teamKey(room, team);
  const candidates = [
    ...SNAPSHOTS.map(slot => ({source: "snapshot " + slot, raw: getStored(key + ":" + slot)})),
    {source: "browser copy", raw: await mirrorGet(key)}
  ];
  const seen = new Set();
  const options = [];
  for (const {source, raw} of candidates) {
    if (raw === null || seen.has(raw)) continue;
    seen.add(raw);
    try {
      const record = parseSlot(raw, room, team);
      options.push({source, record, rounds: record.history.length});
    } catch { /* unreadable copy: not offered */ }
  }
  return options.sort((a, b) => b.rounds - a.rounds);
}

// ---- Persistence and backup bookkeeping ----------------------------------------------------

const persistence = {state: "unknown"};

export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) persistence.state = "unsupported";
    else if (await navigator.storage.persisted()) persistence.state = "granted";
    else persistence.state = (await navigator.storage.persist()) ? "granted" : "denied";
  } catch {
    persistence.state = "unsupported";
  }
  return persistence.state;
}

export function persistenceState() {
  return persistence.state;
}

export function readBackup(room, team) {
  try {
    const value = JSON.parse(getStored(backupKey(room, team)));
    return Number.isInteger(value?.rounds) && Number.isFinite(value.at) ? value : null;
  } catch {
    return null;
  }
}

export function markBackup(room, team, rounds, at) {
  putStored(backupKey(room, team), JSON.stringify({rounds, at}));
}

// How far the last downloaded backup trails behind the locked decisions.
export function backupBehind(decisions, backup) {
  return Math.max(0, decisions - (backup?.rounds ?? 0));
}

export function activeTeam(value) {
  const key = prefix + ":active";
  try {
    if (value === undefined) return JSON.parse(sessionStorage.getItem(key));
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newRecord(mode, room, team, market) {
  return validateRecord({
    game: CONFIG.game, version: CONFIG.version, content: CONTENT_ID, mode, room, team, market,
    session: newId(), history: [], drafts: {}, notes: {}, brief: "", bulletinB: false
  });
}

export function withSaveLock(key, change) {
  return navigator.locks?.request(key, change) || Promise.resolve().then(change);
}

export function knownTable(value) {
  return value && TEAMS.includes(value.team) && (value.room === "PRACTICE" || roomStart(value.room) !== null);
}
