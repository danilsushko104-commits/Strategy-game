/**
 * One Market First — Google Sheets как единственное хранилище игры.
 *
 * Установка: см. README.md в этой папке. Скрипт привязывается к таблице (Расширения → Apps Script),
 * публикуется как веб-приложение, а его адрес вставляется в data-sync-url игры.
 *
 * Листы (создаются командой меню «One Market First → Set up sheets»):
 *   Progress   одна строка на команду: где она, сколько кредитов, что выбрала в каждом раунде.
 *   R1 … R7    одна строка на команду для ОДНОГО раунда: решение, обоснование и заметки рабочего листа.
 *              Откройте лист нужного раунда, чтобы сравнить четыре команды рядом.
 *   Brief      Board Brief каждой команды.
 *   Decisions  сырой журнал решений, только дополняется (время приёма ставит Google).
 *   Notes      последние версии заметок рабочих листов и Board Brief (источник для R1 … R7 и Brief).
 *   Settings   комната и время старта R1, которые читают команды.
 *
 * Листы Progress, R1 … R7 и Brief скрипт ведёт значениями, а не формулами: их можно сортировать и
 * фильтровать, а Decisions и Notes оставлять нетронутыми.
 */

var SHEETS = { decisions: "Decisions", notes: "Notes", progress: "Progress", brief: "Brief", settings: "Settings" };
var DECISION_COLUMNS = ["received_at", "id", "room", "team", "market", "round", "choice", "method", "label", "cost", "credits",
  "problem", "game", "client_time", "sent_at", "clock_offset_s", "evidence", "tradeoff", "chain", "session", "content", "flags"];
var NOTE_COLUMNS = ["updated_at", "room", "team", "market", "round", "field", "text"];
var ROUNDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];
var ROUND_TITLES = ["Customer", "Evidence", "Entry route", "Readiness", "Competition", "Emergency", "Board"];
var ROUND_FIELDS = {
  R1: ["proposition", "cultural", "administrative", "geographic", "economic", "cage"],
  R2: ["alternatives"],
  R3: ["early", "middle", "later", "tradeoff"],
  R4: ["gate"],
  R5: ["position"],
  R6: ["holding", "response", "approval"],
  R7: ["board"]
};
var FIELD_LABELS = {
  proposition: "First customer, who uses Revolut, use case and channel",
  cultural: "Cultural · Singapore evidence → market evidence → impact",
  administrative: "Administrative · Singapore evidence → market evidence → impact",
  geographic: "Geographic · Singapore evidence → market evidence → impact",
  economic: "Economic · Singapore evidence → market evidence → impact",
  cage: "Two important differences and one decision they change",
  alternatives: "Two competing offers, how they compare and what you still need to learn",
  early: "Months 0–3 · first move, relationship and learning goal",
  middle: "Months 4–6 · test, metric and threshold",
  later: "Months 7–12 · next commitment and when to stop",
  tradeoff: "Rejected entry route, first costs and permissions to check",
  gate: "One open condition, its owner and how to verify it",
  position: "Response to the rival and why customers would choose you",
  holding: "First statement and two facts to verify",
  response: "First 24 hours and next 24 hours",
  approval: "Correction, who clears it and a reopening condition",
  board: "Funding request, milestone and why your market should go first"
};
var PROGRESS_COLUMNS = ["room", "team", "market", "stage", "credits_left", "last_activity"].concat(ROUNDS, ["game_result", "notes_filled", "flags"]);
var BRIEF_COLUMNS = ["room", "team", "market", "updated_at", "characters", "brief"];
var ROOM_PATTERN = /^OMF-[A-Z0-9]{5,7}-[0-9A-N][A-Z0-9]{3}$/;
var METHODS = ["submitted", "deadline", "default"];
var MAX_TEXT = 1800;
var MAX_BRIEF = 5400;
var MAX_EVENTS = 20;
var MAX_ITEMS = 40;
var CLOCK_TOLERANCE_MS = 120000;
var NOTES_TOTAL = 17;

// ---------------------------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------------------------

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || "ping";
    if (action === "ping") return jsonOutput({ ok: true, service: "one-market-first", version: 2 });
    if (action === "config") return jsonOutput(readConfig());
    if (action === "team") return jsonOutput(readTeamPayload(String(params.room || ""), Number(params.team)));
    if (action === "room") {
      requireToken(params.token);
      return jsonOutput(readRoomPayload(String(params.room || "")));
    }
    return jsonOutput({ ok: false, error: "Unknown action." });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message || error) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(20000);
    locked = true;
    var payload = JSON.parse(e && e.postData && e.postData.contents || "");
    ensureSheets();
    if (payload && payload.type === "notes") return jsonOutput(handleNotes(payload));
    if (payload && payload.type === "room") return jsonOutput(handleRoom(payload));
    return jsonOutput(handleDecisions(payload));
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function handleDecisions(payload) {
  var sheet = sheetByName(SHEETS.decisions);
  var result = accept(payload, readExisting(sheet), new Date());
  if (result.rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, result.rows.length, DECISION_COLUMNS.length).setValues(result.rows);
    var seen = {};
    result.rows.forEach(function (row) {
      var key = row[2] + "|" + row[3];
      if (!seen[key]) { seen[key] = true; refreshTeamViews(row[2], row[3]); }
    });
  }
  return { ok: true, saved: result.saved, duplicates: result.duplicates, rejected: result.rejected };
}

function handleNotes(payload) {
  var sheet = sheetByName(SHEETS.notes);
  var result = acceptNotes(payload, readNotes(sheet), new Date());
  result.upserts.forEach(function (row) { upsertRow(sheet, [1, 2, 4, 5], [row[1], row[2], row[4], row[5]], row); });
  if (result.upserts.length) refreshTeamViews(result.room, result.team);
  return { ok: true, saved: result.saved, ignored: result.ignored, rejected: result.rejected };
}

function handleRoom(payload) {
  requireToken(payload.token);
  var room = String(payload.room || "");
  var start = Date.parse(payload.start);
  if (!ROOM_PATTERN.test(room) || !isFinite(start)) throw new Error("Bad room or start time.");
  var sheet = sheetByName(SHEETS.settings);
  sheet.getRange(2, 1, 1, 3).setValues([[room, new Date(start), new Date()]]);
  return { ok: true, room: room };
}

function requireToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty("FACILITATOR_TOKEN");
  if (!expected) throw new Error("The facilitator password is not set. Menu: One Market First → Set facilitator password.");
  if (String(token || "") !== expected) throw new Error("Wrong facilitator password.");
}

// ---------------------------------------------------------------------------------------------
// Pure logic (tested outside Google)
// ---------------------------------------------------------------------------------------------

/**
 * Decisions. existing = { ids: {id: true}, chains: {"room|team|round": chain} }
 */
function accept(payload, existing, now) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.events) || !payload.events.length || payload.events.length > MAX_EVENTS) {
    throw new Error("Unsupported request.");
  }
  var sentAt = Date.parse(payload.sentAt);
  var clockOffsetMs = Number(payload.clockOffsetMs) || 0;
  var seen = {};
  var rows = [], saved = [], duplicates = [], rejected = [];
  payload.events.forEach(function (event) {
    var problem = validateEvent(event);
    if (problem) { rejected.push({ id: String(event && event.id || ""), reason: problem }); return; }
    if (existing.ids[event.id] || seen[event.id]) { duplicates.push(event.id); return; }
    seen[event.id] = true;

    var flags = [];
    var key = event.room + "|" + event.team + "|" + event.round;
    var earlier = existing.chains[key];
    if (earlier && earlier !== event.chain) flags.push("CONFLICT: this round was recorded earlier with different content");
    if (isFinite(sentAt) && Math.abs(sentAt - now.getTime()) > CLOCK_TOLERANCE_MS) flags.push("CLOCK: the device clock differs from Google by over 2 min");
    existing.chains[key] = existing.chains[key] || event.chain;

    var values = {
      received_at: now, id: event.id, room: event.room, team: event.team, market: text(event.market, 40), round: event.round,
      choice: text(event.choice, 40), method: event.method, label: text(event.label, 200), cost: Number(event.cost) || 0, credits: Number(event.credits) || 0,
      problem: text(event.problem, 24), game: event.game === undefined || event.game === null || event.game === "" ? "" : Number(event.game) || 0,
      client_time: text(event.clientTime, 40), sent_at: isFinite(sentAt) ? new Date(sentAt) : "", clock_offset_s: Math.round(clockOffsetMs / 1000),
      evidence: text(event.evidence, MAX_TEXT), tradeoff: text(event.tradeoff, MAX_TEXT), chain: event.chain, session: text(event.session, 80),
      content: text(event.content, 16), flags: flags.join("; ")
    };
    rows.push(DECISION_COLUMNS.map(function (column) { return values[column]; }));
    saved.push(event.id);
  });
  return { rows: rows, saved: saved, duplicates: duplicates, rejected: rejected };
}

function validateEvent(event) {
  if (!event || typeof event !== "object") return "not an object";
  if (typeof event.room !== "string" || !ROOM_PATTERN.test(event.room)) return "bad room";
  var team = Number(event.team);
  if (team !== Math.floor(team) || team < 1 || team > 4) return "bad team";
  if (ROUNDS.indexOf(event.round) < 0) return "bad round";
  if (Number(event.seq) !== ROUNDS.indexOf(event.round)) return "round does not match its position";
  if (METHODS.indexOf(event.method) < 0) return "bad method";
  if (typeof event.chain !== "string" || !/^[0-9a-z]{11}$/.test(event.chain)) return "bad chain";
  if (typeof event.id !== "string" || event.id.length > 120 || event.id.indexOf(event.room + ":" + team + ":" + event.seq + ":") !== 0) return "bad id";
  return "";
}

/**
 * Worksheet notes and the Board Brief. existing = { "room|team|round|field": updatedAtMs }.
 * The newest version of each note wins; an older one that arrives late is ignored.
 */
function acceptNotes(payload, existing, now) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.items) || payload.items.length > MAX_ITEMS) throw new Error("Unsupported request.");
  if (typeof payload.room !== "string" || !ROOM_PATTERN.test(payload.room)) throw new Error("Bad room.");
  var team = Number(payload.team);
  if (team !== Math.floor(team) || team < 1 || team > 4) throw new Error("Bad team.");
  var market = text(payload.market, 40);
  var upserts = [], saved = 0, ignored = 0, rejected = [];
  var items = payload.items.slice();
  if (payload.brief && typeof payload.brief === "object") items.push({ round: "BRIEF", field: "brief", text: payload.brief.text, at: payload.brief.at });

  items.forEach(function (item) {
    var isBrief = item && item.round === "BRIEF" && item.field === "brief";
    var allowed = isBrief || (item && ROUND_FIELDS[item.round] && ROUND_FIELDS[item.round].indexOf(item.field) >= 0);
    if (!allowed) { rejected.push({ round: String(item && item.round), field: String(item && item.field), reason: "unknown field" }); return; }
    var at = Date.parse(item.at);
    var updatedAt = isFinite(at) ? at : now.getTime();
    var key = payload.room + "|" + team + "|" + item.round + "|" + item.field;
    if (existing[key] !== undefined && existing[key] >= updatedAt) { ignored++; return; }
    existing[key] = updatedAt;
    upserts.push([new Date(updatedAt), payload.room, team, market, item.round, item.field, text(item.text, isBrief ? MAX_BRIEF : MAX_TEXT)]);
    saved++;
  });
  return { upserts: upserts, saved: saved, ignored: ignored, rejected: rejected, room: payload.room, team: team };
}

/** The first recorded decision of every round (later rows for the same round are conflicts). */
function pickDecisions(decisions) {
  var byRound = {}, extra = {};
  decisions.forEach(function (decision) {
    if (!byRound[decision.round]) byRound[decision.round] = decision;
    else extra[decision.round] = (extra[decision.round] || 0) + 1;
  });
  return { byRound: byRound, conflicts: extra };
}

function millis(value) {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value) || 0;
}

function methodText(method) {
  return method === "default" ? "default (the team did not lock a choice)" : method === "deadline" ? "locked by the deadline" : method === "submitted" ? "locked by the team" : "";
}

/** One row of a round sheet: decision, reasoning and worksheet notes of one team in one round. */
function buildRoundRow(round, team, picked, notes) {
  var decision = picked.byRound[round];
  var fields = ROUND_FIELDS[round].map(function (field) { return notes[round + "." + field] ? notes[round + "." + field].text : ""; });
  var notesAt = ROUND_FIELDS[round].reduce(function (latest, field) {
    var note = notes[round + "." + field];
    return note && note.updatedAt > latest ? note.updatedAt : latest;
  }, 0);
  var flags = [];
  if (decision && decision.flags) flags.push(decision.flags);
  if (picked.conflicts[round]) flags.push("CONFLICT: " + picked.conflicts[round] + " more record(s) for this round");
  return [team.room, team.team, team.market, decision ? methodText(decision.method) : "waiting", decision ? decision.label : "",
    decision ? decision.choice : "", decision ? decision.method : "", decision ? decision.cost : "", decision ? decision.credits : "",
    decision ? decision.problem : "", decision ? decision.evidence : "", decision ? decision.tradeoff : ""]
    .concat(fields, [decision ? decision.received_at : "", notesAt ? new Date(notesAt) : "", flags.join("; ")]);
}

/** One row of the Progress sheet. */
function buildProgressRow(team, picked, notes, brief, decisions) {
  var decided = ROUNDS.filter(function (round) { return picked.byRound[round]; }).length;
  var last = picked.byRound[ROUNDS[Math.max(0, decided - 1)]];
  var stage = decided >= ROUNDS.length ? "Finished" : decided === 0 ? "Not started" : ROUNDS[decided] + " · " + ROUND_TITLES[decided] + " (" + decided + " of " + ROUNDS.length + " decided)";
  var latest = 0;
  decisions.forEach(function (decision) { latest = Math.max(latest, millis(decision.received_at)); });
  Object.keys(notes).forEach(function (key) { latest = Math.max(latest, notes[key].updatedAt); });
  if (brief && brief.updatedAt) latest = Math.max(latest, brief.updatedAt);
  var cells = ROUNDS.map(function (round) {
    var decision = picked.byRound[round];
    return decision ? decision.choice + (decision.method === "default" ? " *" : "") : "";
  });
  var filled = Object.keys(notes).filter(function (key) { return notes[key].text && key.indexOf("BRIEF") !== 0; }).length;
  var game = picked.byRound.R7 && picked.byRound.R7.game !== "" ? picked.byRound.R7.game : "";
  var flagged = decisions.filter(function (decision) { return decision.flags; }).length;
  return [team.room, team.team, team.market, stage, last ? last.credits : "", latest ? new Date(latest) : ""].concat(cells, [game,
    filled + " of " + NOTES_TOTAL + (brief && brief.text ? " · brief" : ""), flagged ? flagged + " flagged" : ""]);
}

/** A cell with student text must never become a spreadsheet formula (=IMPORTXML(...), =HYPERLINK(...)). */
function text(value, limit) {
  var plain = String(value === undefined || value === null ? "" : value).slice(0, limit);
  return /^[=+\-@\t\r]/.test(plain) ? "'" + plain : plain;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function rowsToObjects(values, columns) {
  return values.map(function (row) {
    var object = {};
    columns.forEach(function (column, index) { object[column] = row[index]; });
    return object;
  });
}

function readTable(sheet, columns) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return rowsToObjects(sheet.getRange(2, 1, last - 1, columns.length).getValues(), columns);
}

function readExisting(sheet) {
  var existing = { ids: {}, chains: {} };
  readTable(sheet, DECISION_COLUMNS).forEach(function (row) {
    existing.ids[row.id] = true;
    var key = row.room + "|" + row.team + "|" + row.round;
    if (!existing.chains[key]) existing.chains[key] = row.chain;
  });
  return existing;
}

function readNotes(sheet) {
  var existing = {};
  readTable(sheet, NOTE_COLUMNS).forEach(function (row) {
    existing[row.room + "|" + row.team + "|" + row.round + "|" + row.field] = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || 0;
  });
  return existing;
}

function teamData(room, team) {
  var decisions = readTable(sheetByName(SHEETS.decisions), DECISION_COLUMNS).filter(function (row) { return row.room === room && Number(row.team) === Number(team); });
  var notes = {}, brief = null, market = decisions.length ? decisions[0].market : "";
  readTable(sheetByName(SHEETS.notes), NOTE_COLUMNS).forEach(function (row) {
    if (row.room !== room || Number(row.team) !== Number(team)) return;
    market = market || row.market;
    var updatedAt = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || 0;
    if (row.round === "BRIEF") brief = { text: row.text, updatedAt: updatedAt };
    else notes[row.round + "." + row.field] = { text: row.text, updatedAt: updatedAt };
  });
  return { room: room, team: Number(team), market: market, decisions: decisions, notes: notes, brief: brief };
}

function readConfig() {
  var values = sheetByName(SHEETS.settings).getRange(2, 1, 1, 3).getValues()[0];
  if (!values[0]) return { ok: true, room: "", start: "" };
  return { ok: true, room: String(values[0]), start: values[1] instanceof Date ? values[1].toISOString() : String(values[1]) };
}

/** What a team needs to continue on another device: its decisions and notes. */
function readTeamPayload(room, team) {
  if (!ROOM_PATTERN.test(room) || !(team >= 1 && team <= 4)) throw new Error("Bad room or team.");
  return teamPayload(teamData(room, team));
}

function teamPayload(data) {
  var picked = pickDecisions(data.decisions);
  return {
    ok: true, room: data.room, team: data.team, market: data.market,
    decisions: ROUNDS.filter(function (round) { return picked.byRound[round]; }).map(function (round) {
      var d = picked.byRound[round];
      return { round: round, choice: d.choice, method: d.method, at: String(d.client_time), evidence: d.evidence, tradeoff: d.tradeoff, problem: d.problem, id: d.id };
    }),
    notes: Object.keys(data.notes).map(function (key) {
      return { round: key.split(".")[0], field: key.split(".")[1], text: data.notes[key].text, at: new Date(data.notes[key].updatedAt).toISOString() };
    }),
    brief: data.brief ? { text: data.brief.text, at: new Date(data.brief.updatedAt).toISOString() } : null
  };
}

function readRoomPayload(room) {
  if (!ROOM_PATTERN.test(room)) throw new Error("Bad room.");
  return { ok: true, room: room, teams: [1, 2, 3, 4].map(function (team) { return teamPayload(teamData(room, team)); }) };
}

// ---------------------------------------------------------------------------------------------
// Writing the views
// ---------------------------------------------------------------------------------------------

function upsertRow(sheet, keyColumns, keyValues, row) {
  var last = sheet.getLastRow();
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, row.length).getValues();
    for (var index = 0; index < values.length; index++) {
      var match = keyColumns.every(function (column, i) { return String(values[index][column]) === String(keyValues[i]); });
      if (match) { sheet.getRange(index + 2, 1, 1, row.length).setValues([row]); return; }
    }
  }
  sheet.getRange(last + 1, 1, 1, row.length).setValues([row]);
}

function refreshTeamViews(room, team) {
  var data = teamData(room, team);
  var picked = pickDecisions(data.decisions);
  var info = { room: room, team: Number(team), market: data.market };
  ROUNDS.forEach(function (round) {
    if (!picked.byRound[round] && !ROUND_FIELDS[round].some(function (field) { return data.notes[round + "." + field]; })) return;
    var row = buildRoundRow(round, info, picked, data.notes);
    upsertRow(sheetByName(round), [0, 1], [room, team], row);
  });
  upsertRow(sheetByName(SHEETS.progress), [0, 1], [room, team], buildProgressRow(info, picked, data.notes, data.brief, data.decisions));
  if (data.brief && data.brief.text) {
    upsertRow(sheetByName(SHEETS.brief), [0, 1], [room, team], [room, team, data.market, new Date(data.brief.updatedAt), data.brief.text.length, data.brief.text]);
  }
}

// ---------------------------------------------------------------------------------------------
// Setup and menu
// ---------------------------------------------------------------------------------------------

function sheetByName(name) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function roundColumns(round) {
  return ["room", "team", "market", "status", "decision", "choice", "method", "cost", "credits_left", "problem", "evidence", "tradeoff"]
    .concat(ROUND_FIELDS[round], ["decided_at", "notes_updated_at", "flags"]);
}

function ensureHeader(sheet, columns, notes) {
  if (sheet.getLastRow() === 0) {
    var header = sheet.getRange(1, 1, 1, columns.length);
    header.setValues([columns]).setFontWeight("bold").setBackground("#dcd8ff");
    sheet.setFrozenRows(1);
    if (notes) header.setNotes([columns.map(function (column) { return notes[column] || ""; })]);
  }
}

function ensureSheets() {
  ensureHeader(sheetByName(SHEETS.decisions), DECISION_COLUMNS);
  ensureHeader(sheetByName(SHEETS.notes), NOTE_COLUMNS);
  ensureHeader(sheetByName(SHEETS.progress), PROGRESS_COLUMNS, { stage: "Where the team is now", credits_left: "Credits after its latest decision", R1: "Choice made in the round; * = the default was recorded", game_result: "Hidden game result (0-100), known after R7" });
  ensureHeader(sheetByName(SHEETS.brief), BRIEF_COLUMNS);
  ensureHeader(sheetByName(SHEETS.settings), ["room", "r1_start", "updated_at"]);
  ROUNDS.forEach(function (round) { ensureHeader(sheetByName(round), roundColumns(round), FIELD_LABELS); });
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("One Market First")
    .addItem("Set up sheets", "setupSheets")
    .addItem("Set facilitator password", "setFacilitatorPassword")
    .addItem("Start a new session (saves a copy)", "newSession")
    .addToUi();
}

function setupSheets() {
  ensureSheets();
  SpreadsheetApp.getUi().alert("Sheets are ready: Progress, R1 … R7, Brief, Decisions, Notes, Settings.");
}

function setFacilitatorPassword() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt("Facilitator password", "Choose a password for the facilitator panel (at least 8 characters). Teams never see it.", ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var password = answer.getResponseText().trim();
  if (password.length < 8) { ui.alert("The password needs at least 8 characters."); return; }
  PropertiesService.getScriptProperties().setProperty("FACILITATOR_TOKEN", password);
  ui.alert("Saved.");
}

function newSession() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert("Start a new session?", "A copy of this spreadsheet is saved in your Drive, then all game data here is cleared.", ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  spreadsheet.copy(spreadsheet.getName() + " · saved " + Utilities.formatDate(new Date(), "Etc/UTC", "yyyy-MM-dd HH:mm") + " UTC");
  spreadsheet.getSheets().forEach(function (sheet) {
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  });
  ui.alert("A copy was saved and the data was cleared.");
}

function jsonOutput(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
