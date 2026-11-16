/**
 * One Market First — Google Sheets как единственное хранилище игры (версия 3).
 *
 * Установка: см. README.md в этой папке. Скрипт привязывается к таблице (Расширения → Apps Script),
 * публикуется как веб-приложение, а его адрес вставляется в data-sync-url игры.
 *
 * Игроки таблицу и её ссылку не видят: страница игры знает только адрес веб-приложения. Таблицу открывает ведущий.
 *
 * Листы (создаются сами; для порядка их можно создать командой меню «One Market First → Set up the game»):
 *   Overview   по строке на команду: состав, где она сейчас, кредиты, что выбрала в каждом раунде.
 *   Team 1–4   по листу на команду: таблица принятых решений (раунд → решение → обоснование → заметки рабочего листа).
 *   Scores     оценки экспертов, которые ведущий отправляет из интерфейса игры (Strategy and hearing score sheets).
 *   Players    кто зашёл в игру, иностранный ли студент, в какой он команде. Последний столбец (id) — секретный пропуск игрока.
 *   Settings   состояние игры (lobby / formed / started), номер игры и время старта R1.
 *   Decisions  сырой журнал решений, только дополняется (время приёма ставит Google).
 *   Notes      последние версии заметок рабочих листов и Board Brief (источник для листов команд).
 *
 * Все листы, кроме Decisions, Notes и Players, скрипт ведёт значениями, а не формулами.
 * Пароль ведущего хранится в свойствах скрипта и в таблице не виден.
 */

var SHEETS = { overview: "Overview", scores: "Scores", players: "Players", settings: "Settings", decisions: "Decisions", notes: "Notes" };
var TEAM_COUNT = 4;
var DECISION_COLUMNS = ["received_at", "id", "room", "team", "market", "round", "choice", "method", "label", "cost", "credits",
  "problem", "game", "client_time", "sent_at", "clock_offset_s", "evidence", "tradeoff", "chain", "session", "content", "flags"];
var NOTE_COLUMNS = ["updated_at", "room", "team", "market", "round", "field", "text"];
var PLAYER_COLUMNS = ["joined_at", "name", "international", "team", "captain", "ready", "id"];
var SETTING_COLUMNS = ["key", "value", "updated_at"];
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
var OVERVIEW_COLUMNS = ["team", "market", "players", "captain", "stage", "credits_left", "last_activity"].concat(ROUNDS, ["game_result", "notes_filled", "flags"]);
var TEAM_HEADER = ["Round", "Stage", "Decision", "Choice", "How it was locked", "Cost", "Credits left", "Problem named", "Evidence or assumption",
  "Benefit and trade-off", "Worksheet notes", "Locked at", "Notes updated", "Flags"];
var TEAM_HEADER_ROW = 3;
var ROOM_PATTERN = /^OMF-[A-Z0-9]{5,7}-[0-9A-N][A-Z0-9]{3}$/;
var ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
var METHODS = ["submitted", "deadline", "default"];
var STATES = ["lobby", "formed", "started"];
var MAX_TEXT = 1800;
var MAX_BRIEF = 5400;
var MAX_EVENTS = 20;
var MAX_ITEMS = 40;
var MAX_PLAYERS = 80;
var MAX_NAME = 40;
var CLOCK_TOLERANCE_MS = 120000;
var NOTES_TOTAL = 17;

// ---------------------------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------------------------

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || "ping";
    if (action === "ping") return jsonOutput({ ok: true, service: "one-market-first", version: 3 });
    if (action === "me") return jsonOutput(readMe(String(params.id || "")));
    if (action === "team") return jsonOutput(readTeamPayload(String(params.id || "")));
    if (action === "roster") {
      requireToken(params.token);
      return jsonOutput(readRoster());
    }
    if (action === "room") {
      requireToken(params.token);
      return jsonOutput(readRoomPayload());
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
    var type = payload && payload.type || "decisions";
    var handlers = {
      decisions: handleDecisions, notes: handleNotes, join: handleJoin, ready: handleReady, captain: handleCaptain,
      form: handleForm, start: handleStart, reset: handleReset, demo: handleDemo, scores: handleScores
    };
    if (!Object.prototype.hasOwnProperty.call(handlers, type)) throw new Error("Unsupported request.");
    return jsonOutput(handlers[type](payload));
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

// ---- Players ---------------------------------------------------------------------------------

function handleJoin(payload) {
  var id = validId(payload.id);
  var existing = findPlayer(readPlayers(), id);
  if (existing) return readMe(id);
  var settings = readSettings();
  if (settings.state === "started") throw new Error("The game has already started. Ask the facilitator to let you in.");
  var name = cleanName(payload.name);
  if (typeof payload.international !== "boolean") throw new Error("Say whether you are an international student.");
  addPlayer(name, payload.international, id, settings);
  return readMe(id);
}

/** Adds one player. After the teams are formed, a late player goes to the smallest team (keeping the mix of international students even). */
function addPlayer(name, international, id, settings) {
  var players = readPlayers();
  if (players.length >= MAX_PLAYERS) throw new Error("The game is full.");
  var lower = name.toLowerCase();
  if (players.some(function (player) { return String(player.name).toLowerCase() === lower; })) {
    throw new Error("That name is already taken. Add the first letter of your surname.");
  }
  var team = "";
  if (settings.state === "formed") {
    var sizes = [], kinds = [];
    for (var index = 0; index < TEAM_COUNT; index++) { sizes.push(0); kinds.push(0); }
    players.forEach(function (player) {
      var number = Number(player.team);
      if (number >= 1 && number <= TEAM_COUNT) { sizes[number - 1]++; if (player.international === "yes") kinds[number - 1]++; }
    });
    team = pickTeam(sizes, kinds, international, Math.random) + 1;
  }
  var sheet = sheetByName(SHEETS.players);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, PLAYER_COLUMNS.length).setValues([[new Date(), name, international ? "yes" : "no", team, "", "", id]]);
  if (team) refreshTeamViews(team);
}

function handleReady(payload) {
  var player = requirePlayer(payload.id);
  if (!Number(player.team)) throw new Error("You are not in a team yet.");
  writePlayerCell(player, "ready", payload.ready === false ? "" : "yes");
  return readMe(payload.id);
}

/** Any teammate can take over as captain (the device that plays for the team), for example when the first device fails. */
function handleCaptain(payload) {
  var player = requirePlayer(payload.id);
  var team = Number(player.team);
  if (!team) throw new Error("You are not in a team yet.");
  readPlayers().forEach(function (other) {
    if (Number(other.team) === team && other.captain === "yes" && other.id !== player.id) writePlayerCell(other, "captain", "");
  });
  writePlayerCell(player, "captain", "yes");
  refreshTeamViews(team);
  return readMe(payload.id);
}

// ---- Facilitator -----------------------------------------------------------------------------

/** The randomizer: four balanced teams, international students spread as evenly as possible. Can be repeated until the game starts. */
function handleForm(payload) {
  requireToken(payload.token);
  var settings = readSettings();
  if (settings.state === "started") throw new Error("The game has already started.");
  var players = readPlayers();
  if (players.length < TEAM_COUNT) throw new Error("At least " + TEAM_COUNT + " players are needed: one for each team.");
  var plan = assignTeams(players.map(function (player) { return { international: player.international === "yes" }; }), Math.random);
  // Team, captain and ready are the neighbouring columns D–F of the Players sheet: one write for everybody.
  sheetByName(SHEETS.players).getRange(2, 4, players.length, 3).setValues(players.map(function (player, index) {
    return [plan.teams[index], plan.captains[index] ? "yes" : "", ""];
  }));
  setSetting("state", "formed");
  for (var team = 1; team <= TEAM_COUNT; team++) refreshTeamViews(team);
  return readRoster();
}

function handleStart(payload) {
  requireToken(payload.token);
  var settings = readSettings();
  if (settings.state !== "formed") throw new Error("Form the teams first.");
  var room = String(payload.room || "");
  var start = Date.parse(payload.start);
  if (!ROOM_PATTERN.test(room) || !isFinite(start)) throw new Error("Bad game number or start time.");
  var markets = payload.markets;
  if (!Array.isArray(markets) || markets.length !== TEAM_COUNT || !markets.every(function (market) { return /^[a-z]{3,20}$/.test(market); })) throw new Error("Bad market list.");
  setSetting("room", room);
  setSetting("start", new Date(start).toISOString());
  setSetting("markets", markets.join(","));
  setSetting("state", "started");
  for (var team = 1; team <= TEAM_COUNT; team++) refreshTeamViews(team);
  return readRoster();
}

/** Saves a copy of the spreadsheet in the facilitator's Drive, then clears every game sheet for the next game. */
function handleReset(payload) {
  requireToken(payload.token);
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (payload.copy !== false) spreadsheet.copy(spreadsheet.getName() + " · saved " + Utilities.formatDate(new Date(), "Etc/UTC", "yyyy-MM-dd HH:mm") + " UTC");
  clearGameData();
  return readRoster();
}

/** For trying the game alone: adds players that are not real. */
function handleDemo(payload) {
  requireToken(payload.token);
  var settings = readSettings();
  if (settings.state === "started") throw new Error("The game has already started.");
  var count = Math.max(1, Math.min(24, Math.floor(Number(payload.count) || 8)));
  var made = 0;
  for (var number = 1; number <= 90 && made < count; number++) {
    var name = "Demo " + number;
    if (readPlayers().some(function (player) { return player.name === name; })) continue;
    addPlayer(name, typeof payload.international === "boolean" ? payload.international : Math.random() < 0.4, Utilities.getUuid(), settings);
    made++;
  }
  return readRoster();
}

/** The experts' scores: a table that the facilitator's page assembles (its Strategy and hearing score sheets). */
function handleScores(payload) {
  requireToken(payload.token);
  var table = payload.table;
  if (!Array.isArray(table) || !table.length || table.length > 40) throw new Error("Unsupported scores table.");
  var width = 0;
  table.forEach(function (row) {
    if (!Array.isArray(row) || row.length > 24) throw new Error("Unsupported scores table.");
    width = Math.max(width, row.length);
  });
  var rows = table.map(function (row) {
    var cells = row.map(function (cell) { return typeof cell === "number" && isFinite(cell) ? cell : text(cell, 300); });
    while (cells.length < width) cells.push("");
    return cells;
  });
  var sheet = sheetByName(SHEETS.scores);
  clearSheet(sheet);
  sheet.getRange(1, 1, rows.length, width).setValues(rows);
  sheet.getRange(1, 1, 1, width).setFontWeight("bold").setBackground("#dcd8ff");
  sheet.getRange(rows.length + 2, 1, 1, 2).setValues([["Updated by the game", new Date()]]);
  sheet.setFrozenRows(1);
  return { ok: true, rows: rows.length };
}

// ---- Decisions and notes ---------------------------------------------------------------------

function handleDecisions(payload) {
  var allowed = allowedTeam(payload && payload.participant);
  var sheet = sheetByName(SHEETS.decisions);
  var result = accept(payload, readExisting(sheet), new Date(), allowed);
  if (result.rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, result.rows.length, DECISION_COLUMNS.length).setValues(result.rows);
    refreshTeamViews(allowed.team);
  }
  return { ok: true, saved: result.saved, duplicates: result.duplicates, rejected: result.rejected };
}

function handleNotes(payload) {
  var allowed = allowedTeam(payload && payload.participant);
  if (payload.room !== allowed.room || Number(payload.team) !== allowed.team) throw new Error("These notes do not belong to your team.");
  var sheet = sheetByName(SHEETS.notes);
  var result = acceptNotes(payload, readNotes(sheet), new Date());
  result.upserts.forEach(function (row) { upsertRow(sheet, [1, 2, 4, 5], [row[1], row[2], row[4], row[5]], row); });
  if (result.upserts.length) refreshTeamViews(result.team);
  return { ok: true, saved: result.saved, ignored: result.ignored, rejected: result.rejected };
}

/** The room and team this player may write to; a request from anyone else is refused. */
function allowedTeam(id) {
  var settings = readSettings();
  if (settings.state !== "started" || !settings.room) throw new Error("The game has not started yet.");
  var player = requirePlayer(id);
  var team = Number(player.team);
  if (!(team >= 1 && team <= TEAM_COUNT)) throw new Error("You are not in a team.");
  return { room: settings.room, team: team };
}

function requireToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty("FACILITATOR_TOKEN");
  if (!expected) throw new Error("The facilitator password is not set. Menu: One Market First → Set facilitator password.");
  if (String(token || "") !== expected) throw new Error("Wrong facilitator password.");
}

function validId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("Unknown player. Reload the page.");
  return id;
}

function requirePlayer(id) {
  var player = findPlayer(readPlayers(), validId(id));
  if (!player) throw new Error("Unknown player. Join the game first.");
  return player;
}

function cleanName(value) {
  var name = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > MAX_NAME) throw new Error("Enter your name (2 to " + MAX_NAME + " characters).");
  if (!/^[\p{L}\p{N}]/u.test(name) || /[<>\u0000-\u001f]/.test(name)) throw new Error("Start your name with a letter and avoid special characters.");
  return name;
}

// ---------------------------------------------------------------------------------------------
// Pure logic (tested outside Google)
// ---------------------------------------------------------------------------------------------

function shuffle(list, random) {
  var items = list.slice();
  for (var index = items.length - 1; index > 0; index--) {
    var other = Math.floor(random() * (index + 1));
    var held = items[index]; items[index] = items[other]; items[other] = held;
  }
  return items;
}

/** The team (0-based) a new player goes to: the smallest one, then the one with fewest players of the same kind; ties are drawn. */
function pickTeam(sizes, kinds, international, random) {
  var best = [], bestKey = null;
  sizes.forEach(function (size, team) {
    var same = international ? kinds[team] : size - kinds[team];
    var key = size * 1000 + same;
    if (bestKey === null || key < bestKey) { bestKey = key; best = [team]; }
    else if (key === bestKey) best.push(team);
  });
  return best[Math.floor(random() * best.length)];
}

/**
 * players = [{international: boolean}]. Returns {teams: [1..4 per player], captains: [boolean per player]}.
 * Team sizes differ by at most one; international students (dealt first) are spread over the teams as evenly as possible.
 */
function assignTeams(players, random) {
  var order = shuffle(players.map(function (player, index) { return index; }), random);
  var sequence = order.filter(function (index) { return players[index].international; })
    .concat(order.filter(function (index) { return !players[index].international; }));
  var sizes = [], kinds = [];
  for (var team = 0; team < TEAM_COUNT; team++) { sizes.push(0); kinds.push(0); }
  var teams = players.map(function () { return 0; });
  sequence.forEach(function (index) {
    var team = pickTeam(sizes, kinds, players[index].international, random);
    sizes[team]++;
    if (players[index].international) kinds[team]++;
    teams[index] = team + 1;
  });
  var captains = players.map(function () { return false; });
  for (var number = 1; number <= TEAM_COUNT; number++) {
    var members = [];
    teams.forEach(function (team, index) { if (team === number) members.push(index); });
    if (members.length) captains[members[Math.floor(random() * members.length)]] = true;
  }
  return { teams: teams, captains: captains };
}

/**
 * Decisions. existing = { ids: {id: true}, chains: {"room|team|round": chain} }.
 * allowed = { room, team }: events for any other room or team are rejected.
 */
function accept(payload, existing, now, allowed) {
  if (!payload || payload.v !== 1 || !Array.isArray(payload.events) || !payload.events.length || payload.events.length > MAX_EVENTS) {
    throw new Error("Unsupported request.");
  }
  var sentAt = Date.parse(payload.sentAt);
  var clockOffsetMs = Number(payload.clockOffsetMs) || 0;
  var seen = {};
  var rows = [], saved = [], duplicates = [], rejected = [];
  payload.events.forEach(function (event) {
    var problem = validateEvent(event, allowed);
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

function validateEvent(event, allowed) {
  if (!event || typeof event !== "object") return "not an object";
  if (typeof event.room !== "string" || !ROOM_PATTERN.test(event.room)) return "bad room";
  var team = Number(event.team);
  if (team !== Math.floor(team) || team < 1 || team > TEAM_COUNT) return "bad team";
  if (allowed && (event.room !== allowed.room || team !== allowed.team)) return "not your team or game";
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
  if (team !== Math.floor(team) || team < 1 || team > TEAM_COUNT) throw new Error("Bad team.");
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

function titleCase(value) {
  var word = String(value || "");
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
}

function notesText(round, notes) {
  return ROUND_FIELDS[round].map(function (field) {
    var note = notes[round + "." + field];
    return note && note.text ? FIELD_LABELS[field] + "\n" + note.text : "";
  }).filter(function (part) { return part; }).join("\n\n");
}

/** One row of a team sheet: the decision of one round, its reasoning and the worksheet notes. */
function buildRoundRow(round, picked, notes) {
  var decision = picked.byRound[round];
  var notesAt = ROUND_FIELDS[round].reduce(function (latest, field) {
    var note = notes[round + "." + field];
    return note && note.updatedAt > latest ? note.updatedAt : latest;
  }, 0);
  var flags = [];
  if (decision && decision.flags) flags.push(decision.flags);
  if (picked.conflicts[round]) flags.push("CONFLICT: " + picked.conflicts[round] + " more record(s) for this round");
  var index = ROUNDS.indexOf(round);
  return [round, ROUND_TITLES[index], decision ? decision.label : "", decision ? decision.choice : "", decision ? methodText(decision.method) : "waiting",
    decision ? decision.cost : "", decision ? decision.credits : "", decision ? decision.problem : "", decision ? decision.evidence : "",
    decision ? decision.tradeoff : "", notesText(round, notes), decision ? decision.received_at : "", notesAt ? new Date(notesAt) : "", flags.join("; ")];
}

/** The whole team sheet as a block of rows: a title line, the decisions table and the Board Brief. */
function buildTeamBlock(info, picked, notes, brief, decisions) {
  var progress = buildOverviewRow(info, picked, notes, brief, decisions);
  var title = ["Team " + info.team, info.market ? titleCase(info.market) : "Market not assigned yet", "Players", info.players || "—", "Captain", info.captain || "—",
    "Credits left", progress[5], "Game result", progress[ROUNDS.length + 7]];
  var rows = [title, [], TEAM_HEADER].concat(ROUNDS.map(function (round) { return buildRoundRow(round, picked, notes); }));
  rows.push([], ["Board Brief", brief && brief.text ? brief.text : ""]);
  return rows;
}

/** One row of the Overview sheet. */
function buildOverviewRow(info, picked, notes, brief, decisions) {
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
  return [info.team, info.market ? titleCase(info.market) : "", info.players || "", info.captain || "", stage, last ? last.credits : "", latest ? new Date(latest) : ""].concat(cells, [game,
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

function rowsToObjects(values, columns, firstRow) {
  return values.map(function (row, index) {
    var object = { _row: firstRow + index };
    columns.forEach(function (column, position) { object[column] = row[position]; });
    return object;
  });
}

function readTable(sheet, columns) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return rowsToObjects(sheet.getRange(2, 1, last - 1, columns.length).getValues(), columns, 2);
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

function readPlayers() {
  return readTable(sheetByName(SHEETS.players), PLAYER_COLUMNS);
}

function findPlayer(players, id) {
  for (var index = 0; index < players.length; index++) if (players[index].id === id) return players[index];
  return null;
}

function writePlayerCell(player, column, value) {
  var position = PLAYER_COLUMNS.indexOf(column) + 1;
  sheetByName(SHEETS.players).getRange(player._row, position, 1, 1).setValues([[value]]);
  player[column] = value;
}

/** {state, room, start, markets}: the game as the facilitator has taken it so far. */
function readSettings() {
  var settings = { state: "lobby", room: "", start: "", markets: [] };
  readTable(sheetByName(SHEETS.settings), SETTING_COLUMNS).forEach(function (row) {
    if (row.key === "markets") settings.markets = String(row.value).split(",").filter(function (market) { return market; });
    else if (row.key === "start" || row.key === "room" || row.key === "state") settings[row.key] = String(row.value);
  });
  if (STATES.indexOf(settings.state) < 0) settings.state = "lobby";
  return settings;
}

function setSetting(key, value) {
  var sheet = sheetByName(SHEETS.settings);
  upsertRow(sheet, [0], [key], [key, value, new Date()]);
}

function memberList(players, team) {
  return players.filter(function (player) { return Number(player.team) === team; }).map(function (player) {
    return { name: player.name, captain: player.captain === "yes", ready: player.ready === "yes" };
  });
}

/** What a player's page needs: the state of the game, the player's team and, once it runs, the room code and start time. */
function readMe(id) {
  var players = readPlayers();
  var settings = readSettings();
  var player = ID_PATTERN.test(id) ? findPlayer(players, id) : null;
  var base = { ok: true, state: settings.state, players: players.length };
  if (!player) return Object.assign(base, { found: false });
  var team = Number(player.team) || 0;
  var running = settings.state === "started";
  return Object.assign(base, {
    found: true, name: player.name, international: player.international === "yes", team: team, captain: player.captain === "yes",
    ready: player.ready === "yes", members: team ? memberList(players, team) : [],
    room: running ? settings.room : "", start: running ? settings.start : ""
  });
}

function readRoster() {
  var players = readPlayers();
  var settings = readSettings();
  return {
    ok: true, state: settings.state, room: settings.room, start: settings.start,
    players: players.map(function (player) {
      return { name: player.name, international: player.international === "yes", team: Number(player.team) || 0, captain: player.captain === "yes", ready: player.ready === "yes" };
    })
  };
}

function teamData(team) {
  var settings = readSettings();
  var room = settings.room;
  var decisions = room ? readTable(sheetByName(SHEETS.decisions), DECISION_COLUMNS).filter(function (row) { return row.room === room && Number(row.team) === Number(team); }) : [];
  var notes = {}, brief = null, market = settings.markets[team - 1] || (decisions.length ? decisions[0].market : "");
  if (room) readTable(sheetByName(SHEETS.notes), NOTE_COLUMNS).forEach(function (row) {
    if (row.room !== room || Number(row.team) !== Number(team)) return;
    var updatedAt = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || 0;
    if (row.round === "BRIEF") brief = { text: row.text, updatedAt: updatedAt };
    else notes[row.round + "." + row.field] = { text: row.text, updatedAt: updatedAt };
  });
  return { room: room, team: Number(team), market: market, decisions: decisions, notes: notes, brief: brief };
}

/** What a team needs to continue on another device: its own decisions and notes, for a player of that team. */
function readTeamPayload(id) {
  var allowed = allowedTeam(id);
  return teamPayload(teamData(allowed.team));
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

function readRoomPayload() {
  var settings = readSettings();
  if (!settings.room) throw new Error("The game has not started yet.");
  var teams = [];
  for (var team = 1; team <= TEAM_COUNT; team++) teams.push(teamPayload(teamData(team)));
  return { ok: true, room: settings.room, teams: teams };
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

function teamSheetName(team) {
  return "Team " + team;
}

function refreshTeamViews(team) {
  team = Number(team);
  var data = teamData(team);
  var picked = pickDecisions(data.decisions);
  var members = memberList(readPlayers(), team);
  var captain = members.filter(function (member) { return member.captain; })[0];
  var info = { team: team, market: data.market, players: members.map(function (member) { return member.name; }).join(", "), captain: captain ? captain.name : "" };
  var block = buildTeamBlock(info, picked, data.notes, data.brief, data.decisions);
  var sheet = sheetByName(teamSheetName(team));
  clearSheet(sheet);
  var width = TEAM_HEADER.length;
  sheet.getRange(1, 1, block.length, width).setValues(block.map(function (row) {
    var cells = row.slice();
    while (cells.length < width) cells.push("");
    return cells;
  }));
  upsertRow(sheetByName(SHEETS.overview), [0], [team], buildOverviewRow(info, picked, data.notes, data.brief, data.decisions));
}

function clearSheet(sheet) {
  var rows = sheet.getLastRow();
  var columns = sheet.getLastColumn();
  if (rows > 0 && columns > 0) sheet.getRange(1, 1, rows, columns).clearContent();
}

// ---------------------------------------------------------------------------------------------
// Setup and menu
// ---------------------------------------------------------------------------------------------

function sheetByName(name) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeader(sheet, columns, notes) {
  if (sheet.getLastRow() === 0) {
    var header = sheet.getRange(1, 1, 1, columns.length);
    header.setValues([columns]).setFontWeight("bold").setBackground("#dcd8ff");
    sheet.setFrozenRows(1);
    if (notes) header.setNotes([columns.map(function (column) { return notes[column] || ""; })]);
  }
}

/** Creates every sheet in the order the facilitator reads them. Safe to run again. */
function ensureSheets() {
  ensureHeader(sheetByName(SHEETS.overview), OVERVIEW_COLUMNS, { stage: "Where the team is now", credits_left: "Credits after its latest decision", R1: "Choice made in the round; * = the default was recorded", game_result: "Hidden game result (0-100), known after R7" });
  for (var team = 1; team <= TEAM_COUNT; team++) {
    var sheet = sheetByName(teamSheetName(team));
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 2).setValues([["Team " + team, "Waiting for the game to start"]]);
      sheet.getRange(TEAM_HEADER_ROW, 1, 1, TEAM_HEADER.length).setValues([TEAM_HEADER]).setFontWeight("bold").setBackground("#dcd8ff");
      sheet.getRange(1, 1, 1, 1).setFontWeight("bold");
      sheet.setFrozenRows(TEAM_HEADER_ROW);
    }
  }
  ensureHeader(sheetByName(SHEETS.scores), ["Scores arrive from the game: Facilitator → Strategy and hearing score sheets → Send scores to Google Sheets."]);
  ensureHeader(sheetByName(SHEETS.players), PLAYER_COLUMNS, { id: "Secret pass of the player. Do not share." });
  ensureHeader(sheetByName(SHEETS.settings), SETTING_COLUMNS);
  ensureHeader(sheetByName(SHEETS.decisions), DECISION_COLUMNS);
  ensureHeader(sheetByName(SHEETS.notes), NOTE_COLUMNS);
}

/** Empties every game sheet; the layout stays. */
function clearGameData() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  spreadsheet.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (/^Team [1-9]$/.test(name) || name === SHEETS.scores) clearSheet(sheet);
    else if ([SHEETS.overview, SHEETS.players, SHEETS.settings, SHEETS.decisions, SHEETS.notes].indexOf(name) >= 0 && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  });
  ensureSheets();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("One Market First")
    .addItem("Set up the game (sheets + password)", "setupGame")
    .addItem("Set facilitator password", "setFacilitatorPassword")
    .addItem("Start a new game (saves a copy)", "newSession")
    .addToUi();
}

function setupGame() {
  ensureSheets();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ["Sheet1", "Лист1"].forEach(function (name) {
    var extra = spreadsheet.getSheetByName(name);
    if (extra && extra.getLastRow() === 0 && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(extra);
  });
  if (!PropertiesService.getScriptProperties().getProperty("FACILITATOR_TOKEN")) setFacilitatorPassword();
  else SpreadsheetApp.getUi().alert("The sheets are ready. The facilitator password is already set.");
}

function setFacilitatorPassword() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt("Facilitator password", "Choose a password for the facilitator panel (at least 8 characters). Players never see it.", ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var password = answer.getResponseText().trim();
  if (password.length < 8) { ui.alert("The password needs at least 8 characters."); return; }
  PropertiesService.getScriptProperties().setProperty("FACILITATOR_TOKEN", password);
  ui.alert("Saved. The sheets are ready: Overview, Team 1–4, Scores, Players, Settings, Decisions, Notes.");
}

function newSession() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert("Start a new game?", "A copy of this spreadsheet is saved in your Drive, then all game data here is cleared and the players have to join again.", ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  spreadsheet.copy(spreadsheet.getName() + " · saved " + Utilities.formatDate(new Date(), "Etc/UTC", "yyyy-MM-dd HH:mm") + " UTC");
  clearGameData();
  ui.alert("A copy was saved and the data was cleared.");
}

function jsonOutput(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
