/**
 * One Market First — приём решений команд в Google Sheets.
 *
 * Установка: см. README.md в этой папке. Скрипт привязывается к таблице
 * (Расширения → Apps Script), публикуется как веб-приложение, а его адрес
 * вставляется в data-sync-url игры.
 *
 * Каждое решение приходит событием с детерминированным id, поэтому повторная отправка
 * безопасна. Таблица только дополняется: правка уже записанного раунда создаёт новую строку
 * с пометкой CONFLICT, а время приёма (received_at) ставит Google, а не устройство команды.
 */

var SHEET_NAME = "Decisions";
var COLUMNS = ["received_at", "id", "room", "team", "market", "round", "choice", "method", "label", "cost", "credits",
  "client_time", "sent_at", "clock_offset_s", "evidence", "tradeoff", "chain", "session", "content", "flags"];
var ROOM_PATTERN = /^OMF-[A-Z0-9]{5,7}-[0-9A-N][A-Z0-9]{3}$/;
var ROUNDS = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];
var METHODS = ["submitted", "deadline", "default"];
var MAX_TEXT = 1800;
var MAX_EVENTS = 20;
var CLOCK_TOLERANCE_MS = 120000;

function doGet() {
  return jsonOutput({ ok: true, service: "one-market-first", version: 1 });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(20000);
    locked = true;
    var payload = JSON.parse(e && e.postData && e.postData.contents || "");
    var sheet = ensureSheet();
    var result = accept(payload, readExisting(sheet), new Date());
    if (result.rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, result.rows.length, COLUMNS.length).setValues(result.rows);
    }
    return jsonOutput({ ok: true, saved: result.saved, duplicates: result.duplicates, rejected: result.rejected });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

/**
 * Pure part of the request handling (tested outside Google).
 * existing = { ids: {id: true}, chains: {"room|team|round": chain} }
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

    rows.push([
      now, event.id, event.room, event.team, text(event.market, 40), event.round, text(event.choice, 40), event.method,
      text(event.label, 200), Number(event.cost) || 0, Number(event.credits) || 0,
      text(event.clientTime, 40), isFinite(sentAt) ? new Date(sentAt) : "", Math.round(clockOffsetMs / 1000),
      text(event.evidence, MAX_TEXT), text(event.tradeoff, MAX_TEXT), event.chain, text(event.session, 80), text(event.content, 16), flags.join("; ")
    ]);
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

// Text from students must never become a spreadsheet formula (=IMPORTXML(...), =HYPERLINK(...)).
function text(value, limit) {
  var plain = String(value === undefined || value === null ? "" : value).slice(0, limit);
  return /^[=+\-@\t\r]/.test(plain) ? "'" + plain : plain;
}

function readExisting(sheet) {
  var existing = { ids: {}, chains: {} };
  var last = sheet.getLastRow();
  if (last < 2) return existing;
  var values = sheet.getRange(2, 1, last - 1, COLUMNS.length).getValues();
  var id = COLUMNS.indexOf("id"), room = COLUMNS.indexOf("room"), team = COLUMNS.indexOf("team");
  var round = COLUMNS.indexOf("round"), chain = COLUMNS.indexOf("chain");
  values.forEach(function (row) {
    existing.ids[row[id]] = true;
    var key = row[room] + "|" + row[team] + "|" + row[round];
    if (!existing.chains[key]) existing.chains[key] = row[chain];
  });
  return existing;
}

function ensureSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOutput(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

/** Optional: a live overview for the facilitator. Menu: One Market First → Create overview sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("One Market First").addItem("Create overview sheet", "createOverview").addToUi();
}

function createOverview() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet();
  var sheet = spreadsheet.getSheetByName("Overview") || spreadsheet.insertSheet("Overview");
  sheet.clear();
  sheet.getRange("A1").setValue("Room code").setFontWeight("bold");
  sheet.getRange("B1").setValue("OMF-").setBackground("#fff2cc");
  sheet.getRange("A2:K2").setValues([["Table", "Market"].concat(ROUNDS, ["Credits left", "Last update"])]).setFontWeight("bold");
  for (var team = 1; team <= 4; team++) {
    var row = team + 2;
    var where = "Decisions!$C$2:$C=$B$1, Decisions!$D$2:$D=$A" + row;
    sheet.getRange(row, 1).setValue(team);
    sheet.getRange(row, 2).setFormula('=IFERROR(INDEX(FILTER(Decisions!$E$2:$E, ' + where + '), 1), "")');
    for (var index = 0; index < ROUNDS.length; index++) {
      var column = String.fromCharCode(67 + index); // C..I
      sheet.getRange(row, 3 + index).setFormula(
        '=IFERROR(INDEX(FILTER(ARRAYFORMULA(Decisions!$G$2:$G & IF(Decisions!$H$2:$H="default", "*", "")), ' + where +
        ', Decisions!$F$2:$F=' + column + '$2), 1), "")');
    }
    sheet.getRange(row, 10).setFormula('=IFERROR(MIN(FILTER(Decisions!$K$2:$K, ' + where + ')), "")');
    sheet.getRange(row, 11).setFormula('=IFERROR(MAX(FILTER(Decisions!$A$2:$A, ' + where + ')), "")').setNumberFormat("HH:mm:ss");
  }
  sheet.getRange("A8").setValue("* — решение по умолчанию (команда не успела зафиксировать выбор). Введите код комнаты в B1.");
  sheet.setFrozenRows(2);
}
