import { MARKETS, BULLETINS, RUBRIC, QUESTION } from './scenario.mjs';
import { TEAMS, SCHEDULE, makeRoom, roomStart, marketForTable, phaseAt, standings, compareScores, hostChecklist } from './rules.mjs';
import { tuning } from './tuning.mjs';
import { hostKey, getStored, putStored } from './storage.mjs';
import { esc, button, disclosure, facts, stage, saveFile, interval, countdown, textReport, scoresCsv, scoresSheetTable } from './presentation.mjs';
import { trueNow } from './clock.mjs';
import { syncEnabled, fetchRoom, fetchRoster, hostCommand, pushScores, recordFromPayload } from './sync.mjs';

function freshPanel() {
  return {grades: {}};
}

// `records` are the teams' games rebuilt from the sheet; they are read again, never stored here.
// In the hosted game the sheet also holds the players, the state of the game and the room code (an internal detail).
const host = {room: "", selected: 1, panel: freshPanel(), records: {}, token: getStored(hostKey("token")) || "",
  state: "", players: [], delay: 2, scoresSent: {at: 0, error: ""},
  refresh: {at: 0, error: "", loading: false, problems: {}}};

function loadPanel(room) {
  try {
    const panel = JSON.parse(getStored(hostKey(room)));
    host.panel = panel && typeof panel.grades === "object" ? {grades: panel.grades} : freshPanel();
  } catch {
    host.panel = freshPanel();
  }
}

function storePanel() {
  putStored(hostKey(host.room), JSON.stringify(host.panel));
}

function connectionText() {
  const {at, error, loading} = host.refresh;
  if (!syncEnabled()) return "This page has no Google Sheets address (data-sync-url), so team data cannot be loaded.";
  if (!host.token) return "Enter the facilitator password to see the players and run the game.";
  if (error) return "Could not read Google Sheets: " + error;
  if (loading && !at) return "Loading from Google Sheets…";
  const time = at ? new Date(at).toLocaleTimeString("en-GB", {timeZone: "Europe/Moscow"}) : "";
  if (!host.room) return (at ? "Updated " + time + " Moscow time · " : "") + "Connected.";
  const withData = TEAMS.filter(team => host.records[team]).length;
  const problems = Object.entries(host.refresh.problems).map(([team, message]) => " Team " + team + " could not be read (" + message + ").").join("");
  return (at ? "Updated " + time + " Moscow time · " : "") + withData + " of " + TEAMS.length + " teams have data." + problems;
}

function connectionHtml() {
  return `<div class="pv-panel" data-host-connection><h3>Google Sheets</h3>
    <p class="pv-inline-note" data-host-connection-text>${esc(connectionText())}</p>
    <label class="pv-field pv-block-gap">Facilitator password<input class="pv-input" type="password" data-host="token" value="${esc(host.token)}" autocomplete="off"></label>
    <div class="pv-actions pv-file-actions">${button("Refresh now", "host-refresh")}</div></div>`;
}

// ---- The players: join, form teams, start -----------------------------------------------------------

function playersSummary() {
  const players = host.players;
  const international = players.filter(player => player.international).length;
  const ready = players.filter(player => player.ready).length;
  if (!host.state) return "Waiting for the first answer from Google Sheets.";
  if (host.state === "lobby") return players.length ? players.length + " players joined (" + international + " international). Form the teams when everyone is in." :
    "No players yet. Players open the game page, press “Join your team” and enter their name. They never see the sheet.";
  if (host.state === "formed") return "Teams are formed. " + ready + " of " + players.length + " players are ready. You can shuffle again until you start.";
  return "The game is running. " + players.length + " players in four teams.";
}

function teamCards() {
  return TEAMS.map(team => {
    const members = host.players.filter(player => player.team === team);
    const market = host.room ? MARKETS[marketForTable(host.room, team)] : null;
    return `<div class="pv-panel"><span class="pv-mono">Team ${team}</span><strong>${market ? esc(market.name) : "Market is drawn at the start"}</strong>
      <small>${members.length} ${members.length === 1 ? "player" : "players"}</small>
      <ul class="pv-team-list">${members.map(player => "<li>" + esc(player.name) + (player.international ? " · intl" : "") + (player.captain ? " · captain" : "") + (player.ready ? " ✔" : "") + "</li>").join("")}</ul></div>`;
  }).join("");
}

function playersHtml() {
  const {state, players} = host;
  const delays = [0, 2, 5, 10].map(minutes => '<option value="' + minutes + '"' + (host.delay === minutes ? " selected" : "") + ">" + (minutes ? "in " + minutes + " minutes" : "right now") + "</option>").join("");
  const lobby = state === "lobby" ? (players.length ? '<ul class="pv-team-list">' + players.map(player => "<li>" + esc(player.name) + (player.international ? " · international" : "") + "</li>").join("") + "</ul>" : "") : "";
  const actions = state === "started" ? button("Start a new game", "host-reset", "text") :
    [button(state === "formed" ? "Shuffle the teams again" : "Form teams", "host-form", state === "formed" ? "" : "primary"),
      state === "formed" ? `<label class="pv-field pv-inline-field">R1 opens<select class="pv-input" data-host="delay">${delays}</select></label>` + button("Start the game", "host-start", "primary") : "",
      button("Add demo players (test)", "host-demo", "text"), button("Start a new game", "host-reset", "text")].join("");
  return `<div class="pv-panel pv-block-gap" data-host-players><h3>Players and teams</h3>
    <p class="pv-inline-note" data-host-players-text>${esc(playersSummary())}</p>${lobby}
    ${state === "formed" || state === "started" ? '<div class="pv-host-assignments pv-block-gap">' + teamCards() + "</div>" : ""}
    <div class="pv-actions pv-file-actions">${state ? actions : ""}</div></div>`;
}

function activeRoom() {
  return `<div class="pv-panel pv-block-gap">
    <div class="pv-clock" data-host-clock><span data-host-phase></span><strong data-host-time></strong></div>
    <p data-host-cue class="pv-block-gap"></p>
  </div>`;
}

let checklistPhase = null;

// The line under "The game is played": the next start or the time left in this part.
function progressText(phase, now) {
  const bulletin = phase.id === "R6" && !phase.bulletinB;
  const delta = phase.to === null ? null : roomStart(host.room) + (bulletin ? 92 : phase.to) * 60_000 - now;
  return phase.id === "SETUP" ? "R1 opens at " + interval(host.room, 0, 1).slice(0, 5) + " Moscow time, in " + (delta === null ? "—" : countdown(delta)) :
    delta === null ? "The seminar is over." : phase.label + " · " + countdown(delta) + " left in this part";
}

function checklistHtml(now) {
  const {phase, steps, next} = hostChecklist({room: host.room, now, grades: host.panel.grades, records: host.records});
  checklistPhase = phase.id;
  const marks = {done: "✔", now: "●", later: "○"};
  const extras = {
    game: '<p class="pv-inline-note" data-host-progress>' + esc(progressText(phase, now)) + "</p>",
    files: button("Refresh now", "host-refresh"),
    sheets: button("Send scores to Google Sheets", "host-scores-sync"),
    ranking: button("Export scores CSV", "host-scores")
  };
  const items = steps.map((step, index) => `<li data-state="${step.state}"><span class="pv-step-mark" aria-hidden="true">${marks[step.state]}</span>
    <div><strong>${index + 1}. ${esc(step.title)}</strong>${step.state === "now" ? ' <span class="pv-mono">now</span>' : ""}<p>${esc(step.detail)}</p>${step.state === "done" && !["game", "sheets"].includes(step.id) ? "" : extras[step.id] ?? ""}</div></li>`).join("");
  return `<div class="pv-panel pv-checklist" data-host-checklist><h3>What’s next</h3>
    <p class="pv-next"><strong>${esc(next)}</strong></p><ol class="pv-steps">${items}</ol></div>`;
}

function refreshChecklist() {
  const box = document.querySelector("#one-market-first [data-host-checklist]");
  if (box && host.room) box.outerHTML = checklistHtml(trueNow());
}

function scoresTable() {
  const rows = standings(host.panel.grades, host.records);
  const counted = tuning().gameShare > 0;
  const complete = rows.every(row => row.key);
  const ranked = rows.filter(row => row.key).sort((a, b) => compareScores(a.key, b.key));
  const tied = complete ? ranked.filter(row => compareScores(row.key, ranked[0].key) === 0) : [];
  const heading = !complete ? (counted ? "Complete all three expert sheets and wait for every team’s data from Google Sheets to rank the proposals." :
      "Complete all three expert sheets for every team to rank the proposals.") :
    tied.length > 1 ? "The Chair decides between teams " + tied.map(row => row.team).join(", ") + " and gives a rubric-based reason." :
      "First launch priority · Team " + ranked[0].team + " · " + MARKETS[marketForTable(host.room, ranked[0].team)].name;
  const number = value => (value === null || value === undefined ? "Pending" : value.toFixed(1));
  const body = (complete ? ranked : rows).map(row => "<tr><td>" + esc(MARKETS[marketForTable(host.room, row.team)].name) + "</td>" +
    [row.jury?.written, row.jury?.oral].map(value => "<td>" + number(value) + "</td>").join("") +
    (counted ? "<td>" + number(row.game) + "</td><td>" + number(row.final) + "</td>" : "<td>" + number(row.jury?.total) + "</td>") + "</tr>").join("");
  return `<div class="pv-panel">
    <h3>Board ranking</h3><p>${esc(heading)}</p>
    ${counted ? '<p class="pv-inline-note">Final = ' + Math.round((1 - tuning().gameShare) * 100) + "% experts + " + Math.round(tuning().gameShare * 100) + "% game result. The game result comes from the team data in Google Sheets.</p>" : ""}
    <table class="pv-scores"><thead><tr><th scope="col">Market</th><th scope="col">Written</th><th scope="col">Oral</th>${counted ? '<th scope="col">Game</th><th scope="col">Final</th>' : '<th scope="col">Total</th>'}</tr></thead>
    <tbody>${body}</tbody></table>
    <div class="pv-actions pv-file-actions">${button("Send scores to Google Sheets", "host-scores-sync", "primary")}${button("Export scores CSV", "host-scores")}${button("Export for Excel", "host-scores-ru")}</div>
    <p class="pv-inline-note" data-host-scores-sent>${esc(scoresSentText())}</p></div>`;
}

function scoresSentText() {
  const {at, error} = host.scoresSent;
  if (error) return "The scores could not be sent: " + error;
  return at ? "Scores sheet updated at " + new Date(at).toLocaleTimeString("en-GB", {timeZone: "Europe/Moscow"}) + " Moscow time. It updates by itself after each change." :
    "The Scores sheet fills by itself once you mark an expert sheet. You can also press the button.";
}

function journalHtml(team) {
  const record = host.records[team];
  return record ? disclosure("Team journal from Google Sheets · " + record.history.length + "/7 decisions", '<p class="pv-worksheet-note">' + esc(textReport(record)) + "</p>") : "";
}

function judgeTable(team) {
  const data = host.panel.grades[team] || [];
  const sheets = [0, 1, 2].map(expert => {
    const grade = data[expert] || {checks: [], complete: false};
    return disclosure("Expert " + (expert + 1) + " · " + (grade.complete ? "complete" : "draft"),
      RUBRIC.map(([section, name, points, criteria], row) => `<fieldset class="pv-panel">
        <legend>${esc(section + " · " + name + " · " + points / 4 + " per check")}</legend><div class="pv-checks">
        ${criteria.map((item, index) => `<label><input type="checkbox" data-host="check" data-expert="${expert}" data-row="${row}" data-check="${index}"
          ${grade.checks[row]?.[index] ? "checked" : ""}> ${esc(item)}</label>`).join("")}
        </div></fieldset>`).join("") +
      '<label class="pv-panel pv-field"><span><input type="checkbox" data-host="complete" data-expert="' + expert + '"' +
      (grade.complete ? " checked" : "") + '> This expert sheet is complete</span></label>');
  }).join("");
  const teamOptions = TEAMS.map(value => '<option value="' + value + '"' + (team === value ? " selected" : "") + ">Team " + value +
    " · " + esc(MARKETS[marketForTable(host.room, value)].name) + "</option>").join("");
  return `<div class="pv-panel">
    <h3>Strategy and hearing score sheets</h3>
    <p>Team data arrives from Google Sheets on its own. Review written checks during the game and preparation. Score the pitch and common answer separately. Three experts submit their four independent checks for each criterion.</p>
    <label class="pv-field pv-block-gap">Review team<select class="pv-input" data-host="selected">${teamOptions}</select></label>
    <div data-host-journal>${journalHtml(team)}</div>
    ${sheets}
  </div>`;
}

function guide(room) {
  const schedule = SCHEDULE.map(item =>
    ["<li><strong>", esc(interval(room, item.from, item.to)), "</strong><span>", esc(item.label), "</span></li>"].join("")).join("");
  return disclosure("Facilitator script and timetable", `
    <div class="pv-wording">
      <h3>Before R1</h3>
      <p>Ask everyone to open the game page, press “Join your team” and enter their name. When all are in, press “Form teams”: the randomizer keeps four teams balanced and spreads the international students evenly. Press “Shuffle the teams again” for a new draw. Players see their team number and press “I’m ready”; you press “Start the game”. Each team plays on one device, the captain’s. Run the case in English and read the Board brief without assigning student positions.</p>
      <p>Explain credits with a sample. With 5 practice credits, buying an interview for 2 leaves 3, so a response costing 4 is unavailable. Every real team starts with 9.</p>
      <p>Explain the deadline. A complete, affordable browser draft locks when time runs out. The free default is applied if any required draft field is missing. Keep printed round cards and one blank ledger per team for an offline fallback.</p>
      ${facts([["Expert 1","Open the session, project the clock, warn with two minutes left and time each pitch."],
        ["Expert 2","Support the team devices, check budgets and keep the R4 checkpoints."],
        ["Expert 3","Read both crisis bulletins and gather journals, score sheets and Board Briefs."],
        ["Board Chair","Give the assignment, ask the same question in each hearing and announce the decision."]])}
      <ul class="pv-schedule">${schedule}</ul>
      <h3>Board hearing</h3>
      <p>Draw the order before preparation. Each team gets three minutes and one minute for this question. “${esc(QUESTION)}”</p>
      <p>Announce the market, the preparation or implementation step funded now, and the condition for live activity. Break a total-score tie by oral score, then Uppsala score. The Chair decides any remaining tie and explains the reason.</p>
    </div>`);
}

export function renderHost(now = trueNow()) {
  const played = host.room ? activeRoom() + checklistHtml(now) + guide(host.room) + '<div class="pv-block-gap">' + scoresTable() + judgeTable(host.selected) + "</div>" : "";
  return stage("Facilitator dashboard", "Seminar operations", connectionHtml() + playersHtml() + played, "review");
}

export function hostClock(root, now) {
  const clock = root.querySelector("[data-host-clock]");
  if (!clock || !host.room) return;
  const phase = phaseAt(host.room, now);
  const bulletin = phase.id === "R6" && !phase.bulletinB;
  const delta = phase.to === null ? null : roomStart(host.room) + (bulletin ? 92 : phase.to) * 60_000 - now;
  const cue = {
    SETUP: "Create mixed tables, explain the mandate and run the practice example.",
    R1: "Release the Singapore baseline and assigned market. Remind teams to build their own CAGE.",
    R2: "The selected profile gets a customer signal and a choice of evidence packages.",
    R3: "Release local candidate files and ask for learning and commitment thresholds.",
    R4: "Explain what the scoped review buys. Everything is saved in Google Sheets as the teams write.",
    R5: "Each profile receives a different rival move. Ask how the team now competes.",
    R7: "Each team chooses what to fund and states the condition for its next commitment.",
    BREAK: "Nothing to export: the data is in Google Sheets. Teams can reopen the page after the break.",
    R6: bulletin ? BULLETINS.A : BULLETINS.B + " Each team sees its customer-specific note.",
    PREP: "Read the Board Briefs at the bottom of each Team sheet, finish the written checks and give teams the pitch order.",
    PITCH: "One four-minute slot per team. " + QUESTION,
    DEBRIEF: "Reconcile all scores. Announce the selected next investment and its live-launch condition.",
    END: "Session complete. Export the ranking and keep the team journals."
  }[phase.id] || phase.label;
  clock.dataset.near = delta !== null && delta <= 120_000;
  clock.querySelector("[data-host-phase]").textContent = phase.label || phase.id;
  clock.querySelector("[data-host-time]").textContent = delta === null ? "—" : countdown(delta);
  root.querySelector("[data-host-cue]").textContent = cue;

  // The checklist follows the clock: restate it when the phase changes, and keep its progress line live.
  if (phase.id !== checklistPhase) {
    const box = root.querySelector("[data-host-checklist]");
    if (box) box.outerHTML = checklistHtml(now);
  }
  const progress = root.querySelector("[data-host-progress]");
  if (progress) progress.textContent = progressText(phase, now);
}

function exportScores(russianExcel = false) {
  saveFile("revolut-" + host.room.toLowerCase() + "-scores" + (russianExcel ? "-excel-ru" : "") + ".csv",
    scoresCsv(host.room, host.panel.grades, {russianExcel, records: host.records}), "text/csv;charset=utf-8");
}

function requireToken() {
  if (!host.token) throw new Error("Enter the facilitator password first.");
}

// A new internal game number: it carries the R1 start and which team gets which market. Nobody types it.
function newGameNumber(startAt) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return makeRoom(startAt, random[0] % 24, (random[1] % 46656).toString(36).padStart(3, "0"));
}

async function sendScores() {
  if (!host.token || !host.room) return;
  try {
    await pushScores(host.token, scoresSheetTable(host.room, host.panel.grades, host.records));
    host.scoresSent = {at: trueNow(), error: ""};
  } catch (error) {
    host.scoresSent = {...host.scoresSent, error: error.message || "no answer"};
  }
  const note = document.querySelector("#one-market-first [data-host-scores-sent]");
  if (note) note.textContent = scoresSentText();
}

let scoresTimer = null;
function scheduleScores() {
  if (!host.token || !host.room) return;
  clearTimeout(scoresTimer);
  scoresTimer = setTimeout(() => void sendScores(), 4000);
}

function applyRoster(roster) {
  host.state = roster.state;
  host.players = roster.players;
  if (roster.room !== host.room) {
    host.room = roster.state === "started" && roomStart(roster.room) !== null ? roster.room : "";
    host.records = {};
    host.selected = 1;
    if (host.room) loadPanel(host.room);
    else host.panel = freshPanel();
  }
}

export async function handleHostAction(id, target, ui) {
  if (id === "host-refresh") await refreshHostData(ui);
  else if (id === "host-scores") exportScores();
  else if (id === "host-scores-ru") exportScores(true);
  else if (id === "host-scores-sync") {
    requireToken();
    await sendScores();
    if (host.scoresSent.error) throw new Error(host.scoresSent.error);
    ui.announce("The Scores sheet is updated.");
  } else if (id === "host-demo") {
    requireToken();
    applyRoster(await hostCommand("demo", host.token, {count: 8}));
    ui.announce("Added 8 demo players. They are not real: use “Start a new game” to remove them.");
    ui.render("#omf-stage-title");
  } else if (id === "host-form") {
    requireToken();
    if (host.state === "formed" && !await ui.ask("Shuffle the teams again?", "The players’ teams change and they have to press “I’m ready” again.", "Shuffle")) return;
    applyRoster(await hostCommand("form", host.token));
    ui.announce("Teams formed. The players see their team number on their screens.");
    ui.render("#omf-stage-title");
  } else if (id === "host-start") {
    requireToken();
    const waiting = host.players.filter(player => !player.ready).length;
    if (waiting && !await ui.ask("Start the game?", waiting + " of " + host.players.length + " players have not pressed “I’m ready”. Start anyway?", "Start the game")) return;
    const startAt = (host.delay ? Math.ceil((trueNow() + host.delay * 60_000) / 60_000) : Math.floor(trueNow() / 60_000)) * 60_000;
    const next = newGameNumber(startAt);
    if (roomStart(next) === null) throw new Error("The clock is outside 2025–2099.");
    applyRoster(await hostCommand("start", host.token, {room: next, start: new Date(startAt).toISOString(), markets: TEAMS.map(team => marketForTable(next, team))}));
    ui.announce("The game starts. Players’ screens open by themselves.");
    ui.render("#omf-stage-title");
    void refreshHostData(ui);
  } else if (id === "host-reset") {
    requireToken();
    if (!await ui.ask("Start a new game?", "A copy of the spreadsheet is saved in your Drive. Then all players, teams and results are removed and the players have to join again.", "Start a new game")) return;
    applyRoster(await hostCommand("reset", host.token));
    ui.announce("A new game is ready. A copy of the previous one was saved.");
    ui.render("#omf-stage-title");
  }
}

export function updateHostField(input, render) {
  const {host: field} = input.dataset;
  if (field === "delay") {
    host.delay = Number(input.value) || 0;
    return;
  }
  if (field === "token") {
    host.token = input.value.trim();
    putStored(hostKey("token"), host.token);
    if (render) void refreshHostData({render});
    return;
  }
  if (!host.room || !render) return;
  if (field === "selected") {
    host.selected = Number(input.value);
    render();
    return;
  }
  if (field !== "check" && field !== "complete") return;
  const team = host.selected;
  const expert = Number(input.dataset.expert);
  const grades = host.panel.grades[team] || [{checks: []}, {checks: []}, {checks: []}];
  const grade = grades[expert];
  if (field === "complete") grade.complete = input.checked;
  else {
    const row = Number(input.dataset.row);
    grade.checks[row] ||= [];
    grade.checks[row][Number(input.dataset.check)] = input.checked;
    grade.complete = false;
    input.closest("details").querySelector('[data-host="complete"]').checked = false;
  }
  input.closest("details").querySelector("summary").textContent = "Expert " + (expert + 1) + " · " + (grade.complete ? "complete" : "draft");
  host.panel.grades[team] = grades;
  storePanel();
  const previous = input.closest(".pv-stage-body").querySelector(".pv-scores").closest(".pv-panel");
  previous.outerHTML = scoresTable();
  refreshChecklist();
  scheduleScores();
}

// What changed in the sheet shows without redrawing the page (the experts' open sheets stay open).
function refreshHostViews() {
  const text = document.querySelector("#one-market-first [data-host-connection-text]");
  if (text) text.textContent = connectionText();
  const players = document.querySelector("#one-market-first [data-host-players]");
  if (players) {
    const next = document.createElement("div");
    next.innerHTML = playersHtml();
    const fresh = next.firstElementChild;
    // The page is redrawn only when the roster changed, so an open drop-down is not closed under the facilitator's hand.
    if (fresh.innerHTML !== players.innerHTML) players.replaceWith(fresh);
  }
  if (!host.room) return;
  refreshChecklist();
  const ranking = document.querySelector("#one-market-first .pv-scores");
  if (ranking) ranking.closest(".pv-panel").outerHTML = scoresTable();
  const journal = document.querySelector("#one-market-first [data-host-journal]");
  if (journal) journal.innerHTML = journalHtml(host.selected);
}

// Reads the players and, once the game runs, every team from the sheet.
export async function refreshHostData(ui = {}) {
  if (!syncEnabled() || !host.token || host.refresh.loading) {
    refreshHostViews();
    return;
  }
  host.refresh.loading = true;
  const problems = {};
  const before = host.room;
  try {
    applyRoster(await fetchRoster(host.token));
    if (host.room) {
      const data = await fetchRoom(host.token);
      const records = {};
      for (const payload of data.teams) {
        if (!(payload.decisions.length || payload.notes.length || payload.brief)) continue;
        try { records[payload.team] = recordFromPayload(payload, marketForTable(host.room, payload.team)); }
        catch (error) { problems[payload.team] = error.message; }
      }
      host.records = records;
    }
    host.refresh = {at: trueNow(), error: "", loading: false, problems};
  } catch (error) {
    host.refresh = {...host.refresh, error: error.message || "no answer", loading: false, problems};
  }
  // The page gains its clock, checklist and score sheets (or loses them) when a game starts or a new one is prepared.
  if (host.room !== before && ui.render) ui.render();
  else refreshHostViews();
}
