import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// A stand-in for Google Sheets and Apps Script that runs the real integrations/google-sheets/Code.gs on an
// in-memory spreadsheet. It serves two purposes: tests of the whole round trip (game → script → sheets → game)
// and a local backend (`node scripts/serve.mjs --fake-sheets`) so the game can be tried without Google.

const SCRIPT = new URL("../integrations/google-sheets/Code.gs", import.meta.url);

class FakeRange {
  constructor(sheet, row, column, rows, columns) { Object.assign(this, {sheet, row, column, rows, columns}); }
  getValues() {
    return Array.from({length: this.rows}, (_, r) => Array.from({length: this.columns}, (_, c) => this.sheet.rows[this.row - 1 + r]?.[this.column - 1 + c] ?? ""));
  }
  setValues(values) {
    values.forEach((line, r) => {
      const target = (this.sheet.rows[this.row - 1 + r] ||= []);
      line.forEach((value, c) => { target[this.column - 1 + c] = value; });
    });
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.columns; c++) if (this.sheet.rows[this.row - 1 + r]) this.sheet.rows[this.row - 1 + r][this.column - 1 + c] = "";
    return this;
  }
  setNotes(notes) { this.sheet.notes = notes; return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setWrap() { return this; }
  setVerticalAlignment() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() { let last = 0; this.rows.forEach((row, index) => { if (row && row.some(value => value !== "")) last = index + 1; }); return last; }
  getLastColumn() { return Math.max(0, ...Array.from(this.rows, row => row?.length ?? 0)); }
  getRange(row, column, rows = 1, columns = 1) { return new FakeRange(this, row, column, rows, columns); }
  setFrozenRows(count) { this.frozen = count; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); this.copies = []; }
  getName() { return "One Market First"; }
  getSheetByName(name) { return this.sheets.get(name) ?? null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.set(name, sheet); return sheet; }
  getSheets() { return [...this.sheets.values()]; }
  deleteSheet(sheet) { this.sheets.delete(sheet.getName()); }
  copy(name) { this.copies.push(name); }
}

export function createBackend({token = ""} = {}) {
  const spreadsheet = new FakeSpreadsheet();
  const properties = new Map(token ? [["FACILITATOR_TOKEN", token]] : []);
  const context = vm.createContext({
    Date, JSON, Math, Number, String, Array, Object, RegExp, isFinite, Error,
    SpreadsheetApp: {getActiveSpreadsheet: () => spreadsheet, getUi: () => ({createMenu: () => ({addItem() { return this; }, addToUi() {}})})},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => properties.get(key) ?? null, setProperty: (key, value) => properties.set(key, value)})},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    ContentService: {MimeType: {JSON: "json"}, createTextOutput: body => ({body, setMimeType() { return this; }})},
    Utilities: {formatDate: date => date.toISOString().slice(0, 16), getUuid: () => randomUUID()}
  });
  vm.runInContext(readFileSync(SCRIPT, "utf8"), context, {filename: "Code.gs"});

  const reply = output => ({status: 200, headers: {"content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*"}, body: output.body});
  return {
    script: context,
    spreadsheet,
    setToken(value) { properties.set("FACILITATOR_TOKEN", value); },
    // Handle a request the way the web app does. `url` may carry a query string for GET.
    handle(method, url, body = "") {
      if (method === "OPTIONS") return {status: 204, headers: {"access-control-allow-origin": "*", "access-control-allow-headers": "*"}, body: ""};
      if (method === "GET" || method === "HEAD") {
        const parameter = Object.fromEntries(new URL(url, "http://local").searchParams);
        return reply(context.doGet({parameter}));
      }
      return reply(context.doPost({postData: {contents: body}}));
    },
    // The rows of a sheet as objects, for assertions and for looking at the data.
    table(name) {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet || sheet.getLastRow() < 1) return [];
      const [header, ...rows] = sheet.rows.filter(row => row && row.some(value => value !== ""));
      return rows.map(row => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])));
    }
  };
}
