import { CONFIG } from './scenario.mjs';
import { TEAMS, roomStart, validateRecord } from './rules.mjs';

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

export function readSlot(room, team) {
  const raw = getStored(teamKey(room, team));
  if (raw === null) return null;
  const record = validateRecord(JSON.parse(raw));
  if (record.room !== room || record.team !== team) throw new Error("This saved record belongs to a different table.");
  return record;
}

export function storeRecord(record) {
  putStored(teamKey(record.room, record.team), JSON.stringify(record));
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
    game: CONFIG.game, version: CONFIG.version, mode, room, team, market,
    session: newId(), history: [], drafts: {}, notes: {}, brief: "", bulletinB: false
  });
}

export function withSaveLock(key, change) {
  return navigator.locks?.request(key, change) || Promise.resolve().then(change);
}

export function knownTable(value) {
  return value && TEAMS.includes(value.team) && (value.room === "PRACTICE" || roomStart(value.room) !== null);
}
