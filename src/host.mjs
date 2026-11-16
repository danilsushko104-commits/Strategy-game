import { MARKETS, BULLETINS, RUBRIC, QUESTION } from './scenario.mjs';
import { TEAMS, SCHEDULE, makeRoom, roomStart, marketForTable, phaseAt, standings, compareScores, hostChecklist } from './rules.mjs';
import { tuning } from './tuning.mjs';
import { hostKey, getStored, putStored } from './storage.mjs';
import { esc, button, disclosure, facts, stage, saveFile, interval, countdown, textReport, scoresCsv } from './presentation.mjs';
import { trueNow } from './clock.mjs';
import { syncEnabled, fetchRoom, publishRoom, recordFromPayload } from './sync.mjs';

const activeKey = hostKey("active");
const moscowDate = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"});
function freshPanel() {
  return {grades: {}, joined: false};
}

// `records` are the teams' games rebuilt from the sheet; they are read again, never stored here.
const host = {room: "", start: "", selected: 1, panel: freshPanel(), records: {}, token: getStored(hostKey("token")) || "",
  refresh: {at: 0, error: "", loading: false, problems: {}}};
try {
  const room = getStored(activeKey);
  if (roomStart(room) !== null) {
    host.room = room;
    const panel = JSON.parse(getStored(hostKey(room)));
    if (panel) host.panel = {grades: panel.grades && typeof panel.grades === "object" ? panel.grades : {}, joined: !!panel.joined};
  }
} catch {
  host.panel = freshPanel();
}

function storePanel() {
  putStored(activeKey, host.room);
  putStored(hostKey(host.room), JSON.stringify(host.panel));
}

function connectionText() {
  const {at, error, loading} = host.refresh;
  if (!syncEnabled()) return "This page has no Google Sheets address (data-sync-url), so team data cannot be loaded.";
  if (!host.token) return "Enter the facilitator password to load the teams and to open a room.";
  if (error) return "Could not read Google Sheets: " + error;
  if (loading && !at) return "Loading the teams from Google Sheets…";
  if (!host.room) return "Connected. Open a room below.";
  const time = at ? new Date(at).toLocaleTimeString("en-GB", {timeZone: "Europe/Moscow"}) : "";
  const withData = TEAMS.filter(team => host.records[team]).length;
  const problems = Object.entries(host.refresh.problems).map(([team, message]) => " Table " + team + " could not be read (" + message + ").").join("");
  return (at ? "Updated " + time + " Moscow time · " : "") + withData + " of " + TEAMS.length + " tables have data." + problems;
}

function connectionHtml() {
  return `<div class="pv-panel" data-host-connection><h3>Google Sheets</h3>
    <p class="pv-inline-note" data-host-connection-text>${esc(connectionText())}</p>
    <label class="pv-field pv-block-gap">Facilitator password<input class="pv-input" type="password" data-host="token" value="${esc(host.token)}" autocomplete="off"></label>
    <div class="pv-actions pv-file-actions">${button("Refresh now", "host-refresh")}</div></div>`;
}

function startForm() {
  const today = moscowDate.format(new Date());
  const planned = Date.parse(today + "T18:30+03:00");
  const date = moscowDate.format(new Date(planned > trueNow() ? planned : planned + 86_400_000));
  const time = host.start || (host.room ? moscowDate.format(roomStart(host.room)) + "T" + interval(host.room, 0, 1).slice(0, 5) : date + "T18:30");
  return `<div class="pv-panel">
    <label class="pv-field">R1 start · Moscow time
      <input class="pv-input" type="datetime-local" data-host="start" value="${esc(time)}">
    </label><p class="pv-inline-note pv-block-gap">The opening starts 20 minutes before R1. A room sets the timetable and draws four unique markets.</p>
    <div class="pv-actions pv-file-actions">${button("Create a new room", "host-create", "primary")}</div>
  </div>`;
}

function activeRoom() {
  const assignments = TEAMS.map(team => {
    const market = MARKETS[marketForTable(host.room, team)];
    return "<div class=\"pv-panel\"><span class=\"pv-mono\">Table " + team + "</span><strong>" + esc(market.name) +
      "</strong><small>" + esc(market.city) + "</small></div>";
  }).join("");
  return `<div class="pv-record pv-checkpoint"><p class="pv-mono">Room code</p><h3>${esc(host.room)}</h3>
    <p>Show this code and the table assignment. Each team joins with one device and its own table number.</p></div>
    <div class="pv-host-assignments">${assignments}</div>
    <div class="pv-panel pv-block-gap">
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
  const {phase, steps, next} = hostChecklist({room: host.room, now, grades: host.panel.grades, records: host.records, joined: host.panel.joined});
  checklistPhase = phase.id;
  const marks = {done: "✔", now: "●", later: "○"};
  const extras = {
    joined: '<label class="pv-check-line"><input type="checkbox" data-host="joined"' + (host.panel.joined ? " checked" : "") + "> All four tables are in</label>",
    game: '<p class="pv-inline-note" data-host-progress>' + esc(progressText(phase, now)) + "</p>",
    files: button("Refresh now", "host-refresh"),
    ranking: button("Export scores CSV", "host-scores")
  };
  const items = steps.map((step, index) => `<li data-state="${step.state}"><span class="pv-step-mark" aria-hidden="true">${marks[step.state]}</span>
    <div><strong>${index + 1}. ${esc(step.title)}</strong>${step.state === "now" ? ' <span class="pv-mono">now</span>' : ""}<p>${esc(step.detail)}</p>${step.state === "done" && !["game", "joined"].includes(step.id) ? "" : extras[step.id] ?? ""}</div></li>`).join("");
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
      "Complete all three expert sheets for every table to rank the proposals.") :
    tied.length > 1 ? "The Chair decides between tables " + tied.map(row => row.team).join(", ") + " and gives a rubric-based reason." :
      "First launch priority · Table " + ranked[0].team + " · " + MARKETS[marketForTable(host.room, ranked[0].team)].name;
  const number = value => (value === null || value === undefined ? "Pending" : value.toFixed(1));
  const body = (complete ? ranked : rows).map(row => "<tr><td>" + esc(MARKETS[marketForTable(host.room, row.team)].name) + "</td>" +
    [row.jury?.written, row.jury?.oral].map(value => "<td>" + number(value) + "</td>").join("") +
    (counted ? "<td>" + number(row.game) + "</td><td>" + number(row.final) + "</td>" : "<td>" + number(row.jury?.total) + "</td>") + "</tr>").join("");
  return `<div class="pv-panel">
    <h3>Board ranking</h3><p>${esc(heading)}</p>
    ${counted ? '<p class="pv-inline-note">Final = ' + Math.round((1 - tuning().gameShare) * 100) + "% experts + " + Math.round(tuning().gameShare * 100) + "% game result. The game result comes from the team data in Google Sheets.</p>" : ""}
    <table class="pv-scores"><thead><tr><th scope="col">Market</th><th scope="col">Written</th><th scope="col">Oral</th>${counted ? '<th scope="col">Game</th><th scope="col">Final</th>' : '<th scope="col">Total</th>'}</tr></thead>
    <tbody>${body}</tbody></table>
    <div class="pv-actions pv-file-actions">${button("Export scores CSV", "host-scores")}${button("Export for Excel", "host-scores-ru")}</div></div>`;
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
  const teamOptions = TEAMS.map(value => '<option value="' + value + '"' + (team === value ? " selected" : "") + ">Table " + value +
    " · " + esc(MARKETS[marketForTable(host.room, value)].name) + "</option>").join("");
  return `<div class="pv-panel">
    <h3>Strategy and hearing score sheets</h3>
    <p>Team data arrives from Google Sheets on its own. Review written checks during the game and preparation. Score the pitch and common answer separately. Three experts submit their four independent checks for each criterion.</p>
    <label class="pv-field pv-block-gap">Review table<select class="pv-input" data-host="selected">${teamOptions}</select></label>
    <div data-host-journal>${journalHtml(team)}</div>
    ${sheets}
  </div>`;
}

function guide(room) {
  const schedule = SCHEDULE.map(item =>
    ["<li><strong>", esc(interval(room, item.from, item.to)), "</strong><span>", esc(item.label), "</span></li>"].join("")).join("");
  return disclosure("Facilitator script and timetable", `
    <div class="pv-wording">
      <h3>20 minutes before R1</h3>
      <p>Make four mixed tables. If the roster includes exchange students, privately distribute them as evenly as possible. Keep the tables balanced and run the case in English. Give the group its table number and read the Board brief without assigning student positions.</p>
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
  return stage("Facilitator dashboard", "Seminar operations",
    connectionHtml() + (host.room ? activeRoom() + checklistHtml(now) + guide(host.room) + '<div class="pv-block-gap">' + scoresTable() + judgeTable(host.selected) + "</div>" : "") +
    '<div class="pv-block-gap">' + (host.room ? disclosure("Set up another room", startForm()) : startForm()) + "</div>", "review");
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
    PREP: "Read the Board Briefs in the Brief sheet, finish the written checks and give teams the pitch order.",
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

export async function handleHostAction(id, target, ui) {
  if (id === "host-create") {
    const start = target.closest(".pv-panel").querySelector('[data-host="start"]').value;
    const instant = Date.parse(start + "+03:00");
    if (!start || !Number.isFinite(instant)) throw new Error("Set a valid R1 start in Moscow time.");
    const random = crypto.getRandomValues(new Uint32Array(2));
    const next = makeRoom(instant, random[0] % 24, (random[1] % 46656).toString(36).padStart(3, "0"));
    if (roomStart(next) === null) throw new Error("Select a date between 2025 and 2099.");
    if (host.room && !await ui.ask("Switch to a new room?", "The teams will join the new room. The data of the current room stays in the sheet.", "Create room")) return;
    // With a sheet, the room is published there so that teams only pick their table.
    if (syncEnabled()) {
      if (!host.token) throw new Error("Enter the facilitator password first.");
      await publishRoom(next, instant, host.token);
    }
    host.room = next;
    host.records = {};
    host.start = start;
    host.selected = 1;
    host.panel = freshPanel();
    storePanel();
    ui.announce("Room created. Show the room code and table numbers to participants.");
    ui.render("#omf-stage-title");
    void refreshHostData(ui);
  } else if (id === "host-refresh") await refreshHostData(ui);
  else if (id === "host-scores") exportScores();
  else if (id === "host-scores-ru") exportScores(true);
}

export function updateHostField(input, render) {
  const {host: field} = input.dataset;
  if (field === "start") {
    host.start = input.value;
    return;
  }
  if (field === "token") {
    host.token = input.value.trim();
    putStored(hostKey("token"), host.token);
    if (render) void refreshHostData({});
    return;
  }
  if (!host.room || !render) return;
  if (field === "selected") {
    host.selected = Number(input.value);
    render();
    return;
  }
  if (field === "joined") {
    host.panel.joined = input.checked;
    storePanel();
    refreshChecklist();
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
}

function replaceIn(selector, html) {
  const element = document.querySelector("#one-market-first " + selector);
  if (element) element.outerHTML = html;
}

// What changed in the sheet shows without redrawing the page (the experts' open sheets stay open).
function refreshHostViews() {
  const text = document.querySelector("#one-market-first [data-host-connection-text]");
  if (text) text.textContent = connectionText();
  if (!host.room) return;
  refreshChecklist();
  const ranking = document.querySelector("#one-market-first .pv-scores");
  if (ranking) ranking.closest(".pv-panel").outerHTML = scoresTable();
  const journal = document.querySelector("#one-market-first [data-host-journal]");
  if (journal) journal.innerHTML = journalHtml(host.selected);
}

// Reads every team of the open room from the sheet.
export async function refreshHostData() {
  if (!syncEnabled() || !host.room || !host.token || host.refresh.loading) {
    refreshHostViews();
    return;
  }
  host.refresh.loading = true;
  const problems = {};
  try {
    const data = await fetchRoom(host.room, host.token);
    const records = {};
    for (const payload of data.teams) {
      if (!(payload.decisions.length || payload.notes.length || payload.brief)) continue;
      try { records[payload.team] = recordFromPayload(payload, marketForTable(host.room, payload.team)); }
      catch (error) { problems[payload.team] = error.message; }
    }
    host.records = records;
    host.refresh = {at: trueNow(), error: "", loading: false, problems};
  } catch (error) {
    host.refresh = {...host.refresh, error: error.message || "no answer", loading: false, problems};
  }
  refreshHostViews();
}
