import { CONFIG, MARKETS, BULLETINS, RUBRIC, QUESTION } from './scenario.mjs';
import { TEAMS, SCHEDULE, makeRoom, roomStart, marketForTable, phaseAt, validateRecord, scoreJury, compareScores } from './rules.mjs';
import { hostKey, getStored, putStored } from './storage.mjs';
import { esc, button, disclosure, facts, stage, saveFile, interval, countdown, textReport, scoresCsv } from './presentation.mjs';
import { trueNow } from './clock.mjs';

const activeKey = hostKey("active");
const moscowDate = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit"});
function freshPanel() {
  return {records: {}, grades: {}};
}

const host = {room: "", start: "", selected: 1, panel: freshPanel()};
try {
  const room = getStored(activeKey);
  if (roomStart(room) !== null) {
    host.room = room;
    const panel = JSON.parse(getStored(hostKey(room)));
    if (panel) host.panel = panel;
  }
} catch {
  host.panel = freshPanel();
}

function storePanel() {
  putStored(activeKey, host.room);
  putStored(hostKey(host.room), JSON.stringify(host.panel));
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

function scoresFor(team) {
  const data = host.panel.grades[team];
  return scoreJury(data);
}

function scoresTable() {
  const scored = TEAMS.map(team => ({team, score: scoresFor(team)}));
  const ranked = scored.filter(item => item.score).sort((a, b) => compareScores(a.score, b.score));
  const complete = ranked.length === TEAMS.length;
  const tied = complete ? ranked.filter(item => compareScores(item.score, ranked[0].score) === 0) : [];
  const heading = !complete ? "Complete all three expert sheets for every table to rank the proposals." :
    tied.length > 1 ? "The Chair decides between tables " + tied.map(item => item.team).join(", ") + " and gives a rubric-based reason." :
      "First launch priority · Table " + ranked[0].team + " · " + MARKETS[marketForTable(host.room, ranked[0].team)].name;
  const rows = (complete ? ranked : scored).map(({team, score}) =>
    "<tr><td>" + esc(MARKETS[marketForTable(host.room, team)].name) + "</td>" +
    (score ? [score.written, score.oral, score.total].map(value => "<td>" + value.toFixed(1) + "</td>").join("") :
      '<td colspan="3">Pending</td>') + "</tr>").join("");
  return `<div class="pv-panel">
    <h3>Board ranking</h3><p>${esc(heading)}</p>
    <table class="pv-scores"><thead><tr><th scope="col">Market</th><th scope="col">Written</th><th scope="col">Oral</th><th scope="col">Total</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="pv-actions pv-file-actions">${button("Export scores CSV", "host-scores")}${button("CSV for Russian Excel (;)", "host-scores-ru")}</div></div>`;
}

function judgeTable(team) {
  const imported = host.panel.records[team];
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
    <p>Collect the team JSON after R7. Review written checks during the game and preparation. Score the pitch and common answer separately. Three experts submit their four independent checks for each criterion.</p>
    <label class="pv-field pv-block-gap">Review table<select class="pv-input" data-host="selected">${teamOptions}</select></label>
    <div class="pv-actions pv-file-actions">${button("Import team JSON", "import", "", 'data-purpose="host"')}</div>
    ${imported ? disclosure("Imported team journal · " + imported.history.length + "/7 decisions", '<p class="pv-worksheet-note">' + esc(textReport(imported)) + "</p>") : ""}
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

export function renderHost() {
  return stage("Facilitator dashboard", "Seminar operations",
    (host.room ? activeRoom() + guide(host.room) + '<div class="pv-block-gap">' + scoresTable() + judgeTable(host.selected) + "</div>" : "") +
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
    R4: "Explain what the scoped review buys. Save a JSON checkpoint before the break.",
    R5: "Each profile receives a different rival move. Ask how the team now competes.",
    R7: "Each team chooses what to fund and states the condition for its next commitment.",
    BREAK: "Export the checkpoint, then reopen the same room and table at the next seminar.",
    R6: bulletin ? BULLETINS.A : BULLETINS.B + " Each team sees its customer-specific note.",
    PREP: "Collect team JSON or written logs, finish the written checks and give teams the pitch order.",
    PITCH: "One four-minute slot per team. " + QUESTION,
    DEBRIEF: "Reconcile all scores. Announce the selected next investment and its live-launch condition.",
    END: "Session complete. Export the ranking and keep the team journals."
  }[phase.id] || phase.label;
  clock.dataset.near = delta !== null && delta <= 120_000;
  clock.querySelector("[data-host-phase]").textContent = phase.label || phase.id;
  clock.querySelector("[data-host-time]").textContent = delta === null ? "—" : countdown(delta);
  root.querySelector("[data-host-cue]").textContent = cue;
}

function exportScores(russianExcel = false) {
  saveFile("revolut-" + host.room.toLowerCase() + "-scores" + (russianExcel ? "-excel-ru" : "") + ".csv",
    scoresCsv(host.room, host.panel.grades, {russianExcel}), "text/csv;charset=utf-8");
}

export async function handleHostAction(id, target, ui) {
  if (id === "host-create") {
    const start = target.closest(".pv-panel").querySelector('[data-host="start"]').value;
    const instant = Date.parse(start + "+03:00");
    if (!start || !Number.isFinite(instant)) throw new Error("Set a valid R1 start in Moscow time.");
    const random = crypto.getRandomValues(new Uint32Array(2));
    const next = makeRoom(instant, random[0] % 24, (random[1] % 46656).toString(36).padStart(3, "0"));
    if (roomStart(next) === null) throw new Error("Select a date between 2025 and 2099.");
    if (host.room && !await ui.ask("Switch to a new room?", "The current room’s exports can still be kept. The dashboard will open the new room.", "Create room")) return;
    host.room = next;
    host.start = start;
    host.selected = 1;
    host.panel = freshPanel();
    storePanel();
    ui.announce("Room created. Show the room code and table numbers to participants.");
    ui.render("#omf-stage-title");
  } else if (id === "host-scores") exportScores();
  else if (id === "host-scores-ru") exportScores(true);
}

export function updateHostField(input, render) {
  const {host: field} = input.dataset;
  if (field === "start") {
    host.start = input.value;
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
}

export async function importTeamFile(file, ui) {
  if (!host.room) throw new Error("Create a room first.");
  if (file.size > CONFIG.maxImportBytes) throw new Error("The JSON file is too large.");
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error("Choose a JSON file exported by the game."); }
  const record = validateRecord(parsed);
  if (record.room !== host.room) throw new Error("This team file belongs to another room.");
  const current = host.panel.records[record.team];
  if (current && !await ui.ask("Replace the imported journal?", "Import the selected file for table " + record.team + "?", "Import")) return;
  host.panel.records[record.team] = record;
  host.selected = record.team;
  storePanel();
  ui.announce("Imported table " + record.team + " with " + record.history.length + "/7 locked decisions.");
  ui.render();
}
