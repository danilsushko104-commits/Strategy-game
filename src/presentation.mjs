import { MARKETS, ROUNDS, WORKSHEET, CONFIG, QUESTION } from './scenario.mjs';
import { OUTCOMES, TEAMS, replay, roomStart, marketForTable, scoreJury, scoreExpert, rankScores, compareScores } from './rules.mjs';

export function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function button(label, action, kind = "", attributes = "") {
  return '<button type="button" class="pv-button' + (kind ? ' pv-button--' + kind : '') +
    '" data-action="' + action + '" ' + attributes + '>' + esc(label) + '</button>';
}

export function disclosure(label, body, open = false) {
  return '<details class="pv-summary"' + (open ? " open" : "") + '><summary>' + esc(label) +
    '</summary><div class="pv-detail-body">' + body + '</div></details>';
}

export function facts(pairs, className = "pv-facts") {
  return '<dl class="' + className + '">' + pairs.map(([label, value]) =>
    '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join("") + '</dl>';
}

export function stage(title, label, body, tone = "") {
  return '<section class="pv-stage" aria-labelledby="omf-stage-title"><header class="pv-stage-head' +
    (tone ? ' pv-stage-head--' + tone : '') + '"><p class="pv-mono">' + esc(label) +
    '</p><h2 id="omf-stage-title" tabindex="-1">' + esc(title) +
    '</h2></header><div class="pv-stage-body">' + body + '</div></section>';
}

export function saveFile(filename, data, mime) {
  const url = URL.createObjectURL(new Blob([data], {type: mime}));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const moscowClock = new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit", hourCycle: "h23"});

export function interval(room, start, end) {
  const base = roomStart(room);
  return moscowClock.format(base + start * 60_000) + "–" + moscowClock.format(base + end * 60_000);
}

export function countdown(delta) {
  const seconds = Math.max(0, Math.ceil(delta / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

export function textReport(record, boardOnly = false) {
  const {state, path} = replay(record);
  const market = MARKETS[record.market];
  const profile = market.profiles[state.profile];
  const lines = [
    boardOnly ? "REVOLUT · BOARD BRIEF" : "REVOLUT · TEAM DECISION JOURNAL",
    "Table " + record.team + " · " + market.name + " · " + record.room,
    "Customer: " + (profile?.name || "Pending"),
    "Credits spent: " + (CONFIG.budget - state.credits) + " · remaining: " + state.credits
  ];
  if (path.length === ROUNDS.length) lines.push("Funding request: " + OUTCOMES[path.at(-1).choice][0]);
  if (record.brief) lines.push("", record.brief);
  if (!boardOnly) {
    for (const event of path) {
      lines.push("", event.round + " " + event.label + " · cost " + event.cost + " · balance " + event.credits + " · " + event.method);
      if (event.evidence) lines.push("Evidence: " + event.evidence);
      if (event.tradeoff) lines.push("Trade-off: " + event.tradeoff);
      if (event.result) lines.push("Result: " + event.result);
      for (const [field, label] of WORKSHEET[event.round]) {
        const value = record.notes[event.round + "." + field];
        if (value) lines.push(label + ": " + value);
      }
    }
  } else {
    if (!record.brief) lines.push("", "Team worksheet highlights:");
    const fields = [["R1.cage", "CAGE"], ["R3.later", "Next commitment"], ["R6.approval", "Reopening condition"], ["R7.board", "Board request"]];
    for (const [key, label] of fields) {
      if (!record.brief && record.notes[key]) lines.push(label + ": " + record.notes[key]);
    }
    lines.push("", "For the hearing: " + QUESTION);
  }
  return lines.join("\n");
}

export function teamFilename(record, extension, name = "journal") {
  return "revolut-" + record.room.toLowerCase() + "-table-" + record.team + "-" + record.market + "-" + name + "." + extension;
}

// RFC 4180: quote a cell that contains the separator, a quote or a line break, and double inner quotes.
export function csvCell(value, separator = ",") {
  const text = String(value ?? "");
  const quote = text.includes('"') || text.includes(separator) || /[\r\n]/.test(text) || text !== text.trim();
  return quote ? '"' + text.replaceAll('"', '""') + '"' : text;
}

// The score table as CSV. `russianExcel` writes ";" separators and decimal commas, which is what
// Excel with Russian regional settings expects. A BOM makes Excel read the file as UTF-8.
export function scoresCsv(room, gradesByTeam, {russianExcel = false} = {}) {
  const separator = russianExcel ? ";" : ",";
  const number = value => (russianExcel ? value.toFixed(1).replace(".", ",") : value.toFixed(1));
  const scores = TEAMS.map(team => scoreJury(gradesByTeam[team]));
  const ranks = rankScores(scores);
  const header = ["rank", "table", "market", "written_70", "oral_30", "uppsala_16", "total_100", "expert1_total", "expert2_total", "expert3_total", "status"];
  const lines = [header].concat(TEAMS.map((team, index) => {
    const grades = Array.isArray(gradesByTeam[team]) ? gradesByTeam[team] : [];
    const score = scores[index];
    const experts = [0, 1, 2].map(expert => grades[expert]?.complete ? number(scoreExpert(grades[expert]).total) : "");
    const done = [0, 1, 2].filter(expert => grades[expert]?.complete).length;
    const tied = score && scores.some((other, rival) => rival !== index && other && compareScores(other, score) === 0);
    const status = !score ? "pending: " + done + " of 3 expert sheets complete" : tied ? "tied: the Chair decides" : "complete";
    return [ranks[index] ?? "", team, MARKETS[marketForTable(room, team)].name]
      .concat(score ? [score.written, score.oral, score.uppsala, score.total].map(number) : ["", "", "", ""], experts, [status]);
  }));
  return "\ufeff" + lines.map(line => line.map(cell => csvCell(cell, separator)).join(separator)).join("\r\n") + "\r\n";
}
