import { CONFIG, SOURCES, SINGAPORE, MARKETS, BRIEF, ROUNDS, BULLETINS, WORKSHEET, RUBRIC, QUESTION, PROBLEMS } from './scenario.mjs';
import { TEAMS, SCHEDULE, OUTCOMES, makeRoom, marketForTable, roomStart, phaseAt, replay, optionsFor, pendingFact,
  settleDeadlines, lockRound, updateDraft, updateNote, updateBrief, canReadBulletinB, isDraftComplete, validateRecord, contentMismatch, gameScore } from './rules.mjs';
import { storageAvailable, getStored, teamKey, readSlot, storeRecord, clearSlot, activeTeam, newId, newRecord, withSaveLock,
  knownTable, SaveError, recoveryOptions, requestPersistence, readPlayer, writePlayer } from './storage.mjs';
import { esc, button, disclosure, facts, stage, interval, countdown } from './presentation.mjs';
import { renderHost, handleHostAction, updateHostField, hostClock, refreshHostData } from './host.mjs';
import { trueNow, clockStatus, syncClock } from './clock.mjs';
import { gameProgress } from './progress.mjs';
import { tuning } from './tuning.mjs';
import { configureSync, flushSync, syncSummary, syncEnabled, setParticipant, joinGame, fetchMe, setReady, claimCaptain, fetchTeam, recordFromPayload } from './sync.mjs';

const root = document.querySelector("#one-market-first");
const ui = Object.fromEntries([...root.querySelectorAll("[data-ui]")].map(element => [element.dataset.ui, element]));
const view = {
  page: "home", entryMode: "live", team: 1, market: "indonesia", record: null,
  pageKey: "", recovery: null, practiceReview: null, notice: "", readingFor: "team", busy: false, writes: Promise.resolve(),
  // The person at this device (hosted game): who they are and what the sheet last said about their team.
  player: null, me: null, meKey: "", pendingId: "", stayHome: false
};
configureSync(root.dataset.syncUrl);
const marketList = Object.entries(MARKETS);
view.player = hosted() ? readPlayer() : null;
if (view.player) setParticipant(view.player.id);
if (!hosted()) view.entryMode = "practice";
const scheduledRoom = makeRoom(Date.UTC(2026, 0, 1, 15, 30), 0, "000");

function announce(message, tone = "info") {
  view.notice = message;
  ui.notice.dataset.tone = tone;
  renderNotice();
}

function clockNote() {
  const status = clockStatus();
  if (status.synced) {
    const seconds = Math.round(Math.abs(status.offset) / 1000);
    return seconds < 2 ? "" : " This device’s clock is " + seconds + " s " + (status.offset > 0 ? "slow" : "fast") + ". The game follows the server time.";
  }
  const live = view.page === "host" || view.record?.mode === "live";
  return live ? " Server time is unavailable, so this device’s clock sets the rounds. Compare it with the facilitator’s clock." : "";
}

function renderNotice() {
  const warning = storageAvailable() ? "" : " Browser storage is unavailable. Your decisions are still sent to Google Sheets; do not close this page while they are waiting.";
  ui.notice.textContent = (view.notice + warning + clockNote()).trim();
  ui.notice.hidden = !ui.notice.textContent;
}

function sourceLinks(ids) {
  return "<ul>" + ids.map(id => SOURCES[id]).map(([label, url]) =>
    '<li><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a></li>").join("") + "</ul>";
}

function teamSelector() {
  return '<label class="pv-field">Team<select class="pv-input" data-entry="team">' +
    TEAMS.map(team => '<option value="' + team + '"' + (view.team === team ? " selected" : "") + ">Team " + team + "</option>").join("") +
    "</select></label>";
}

// The game runs against a Google Sheet when the page carries its address. Then players sign up, the facilitator forms
// the teams and starts the game, and nobody types a room code. Without an address the page only offers practice.
function hosted() {
  return syncEnabled();
}

function playerList(members) {
  return '<ul class="pv-team-list">' + members.map(member => "<li>" + esc(member.name) + (member.captain ? ' <span class="pv-mono">captain</span>' : "") +
    (member.ready ? ' <span class="pv-mono">ready</span>' : "") + "</li>").join("") + "</ul>";
}

function signUpForm() {
  return `<form data-form="signup">
      <div class="pv-entry-fields">
        <label class="pv-field">Your name<input class="pv-input" name="name" autocomplete="given-name" maxlength="40" required placeholder="Name and first letter of surname"></label>
        <fieldset class="pv-field pv-radios"><legend>Are you an international student?</legend>
          <label><input type="radio" name="international" value="yes" required> Yes, international</label>
          <label><input type="radio" name="international" value="no"> No, not international</label></fieldset>
      </div>
      <p class="pv-inline-note pv-block-gap">The facilitator will form the teams at random and keep a balanced mix. You will see your team number here.</p>
      <div class="pv-entry-foot"><div class="pv-actions"><button type="submit" class="pv-button pv-button--primary">Join your team</button></div></div>
    </form>`;
}

// What the player sees while the teams are not playing yet, and after: always the same card, driven by the sheet.
function playerPanel() {
  const me = view.me;
  if (!view.player) return signUpForm();
  if (!me) return '<p class="pv-inline-note" data-assigned>Connecting to the game…</p>';
  if (!me.team) {
    return `<div class="pv-record pv-checkpoint"><p class="pv-mono">You are in</p><h3>${esc(view.player.name)}</h3>
      <p>${me.players} ${me.players === 1 ? "player has" : "players have"} joined. The facilitator will form the teams shortly: stay on this page.</p></div>`;
  }
  const market = me.state === "started" && roomStart(me.room) !== null ? MARKETS[marketForTable(me.room, me.team)] : null;
  const running = me.state === "started";
  const captain = me.members.find(member => member.captain);
  const lines = me.captain ?
    "You are the captain: the team plays on this device. Sit together and decide together." :
    "Your captain " + (captain ? captain.name : "") + " plays for the team on their device. Sit together and decide together.";
  const actions = running ?
    (me.captain ? button(view.stayHome ? "Back to the game" : "Open the game", "enter-game", "primary") : "") :
    button(me.ready ? "Not ready yet" : "I’m ready", "ready", me.ready ? "text" : "primary");
  return `<div class="pv-record pv-checkpoint"><p class="pv-mono">Your team</p><h3>Team ${me.team}${market ? " · " + esc(market.name) : ""}</h3>
      <p>${esc(lines)}</p>
      <p>${running ? (me.captain ? "The game is running." : "The game is running. Your captain has the screen.") : me.ready ? "You are ready. The facilitator starts the game when everyone is." : "Press the button when you are ready. The facilitator starts the game when everyone is."}</p></div>
    <div class="pv-panel"><h3>Your teammates</h3>${playerList(me.members)}</div>
    <div class="pv-entry-foot"><div class="pv-actions">${actions}
      ${me.captain ? "" : button("Play on this device instead", "captain", "text")}</div></div>`;
}

function entryPanel() {
  if (hosted() && view.entryMode === "live") return `<div class="pv-entry-body" data-assigned>${playerPanel()}${location.hash === "#practice" ? '<div class="pv-actions pv-file-actions">' + button("Practice", "entry-mode", "text") + "</div>" : ""}</div>`;
  return `<form data-form="join">
        <div class="pv-entry-fields">
          <label class="pv-field">Practice market<select class="pv-input" data-entry="market">${marketList.map(([id, market]) =>
            `<option value="${id}"${view.market === id ? " selected" : ""}>${market.name}</option>`).join("")}</select></label>${teamSelector()}
        </div>
        <p class="pv-inline-note pv-block-gap">Practice alone: nothing is sent anywhere.</p>
        <div class="pv-entry-foot"><div class="pv-actions">
          <button type="submit" class="pv-button pv-button--primary">Open practice dashboard</button>
          ${hosted() ? button("Back to the game", "entry-mode", "text") : ""}
        </div></div>
      </form>`;
}

function entryTitle() {
  return hosted() && view.entryMode === "live" ? (view.player ? "Your team" : "Join your team") : "Practice";
}

function homeScreen() {
  return `<section class="pv-hero" aria-labelledby="omf-title">
    <div class="pv-hero-grid"><div class="pv-hero-text">
      <span class="pv-kicker pv-mono">Revolut APAC case</span>
      <h1 id="omf-title" tabindex="-1"><span>One Market</span><span>First</span></h1>
      <p>Four consulting teams. One expansion mandate. Make the case for funding your market first.</p>
      ${button("Join your team", "jump-entry", "primary")}
    </div><div class="pv-hero-art" aria-hidden="true">
      <span class="pv-art-code pv-art-code--top pv-mono">APAC · Market entry</span>
      <!-- COVER -->
    </div></div>
    <div class="pv-tape pv-mono"><span><b>04</b><small>Markets</small></span><span><b>${String(CONFIG.budget).padStart(2, "0")}</b><small>Credits per team</small></span><span><b>01</b><small>Funding mandate</small></span></div>
  </section>
  <section class="pv-entry" aria-labelledby="omf-entry-title">
    <div class="pv-section-head"><h2 id="omf-entry-title" tabindex="-1">${entryTitle()}</h2></div>
    <div class="pv-entry-panel">${entryPanel()}</div>
  </section>`;
}

function renderMaterials() {
  ui["materials-body"].innerHTML = `
    <div class="pv-wording"><h3>Board brief</h3>${BRIEF.map(line => "<p>" + esc(line) + "</p>").join("")}</div>
    ${disclosure("How to play", '<ol class="pv-guidance">' + [
      "Sit at the assigned table. Make decisions together in English. Everyone can speak and there are no fixed positions.",
      "Read the new card. Compare the options and prices against your remaining credits.",
      "Select an action and write a short evidence note and trade-off. A complete, eligible draft saved before the deadline locks at the deadline if you have not locked it already. Otherwise the free default applies.",
      "You may edit worksheet notes during the active round, even after locking the choice. New rounds open on the classroom clock. The credits spent stay in the ledger.",
      "The three experts score the strategy and hearing. Your simulated outcome and remaining credits do not award automatic points."
    ].map(item => "<li>" + esc(item) + "</li>").join("") + "</ol>", true)}
    ${disclosure("Round deadlines and defaults", '<ul>' + [
      "A complete draft has an affordable selected option, an evidence or assumption note and a trade-off note.",
      "At the deadline the browser locks that draft. The free default applies if the draft is incomplete or unavailable.",
      "Defaults in order: Profile A, base dossier, mock preparation without an entry route, keep a reserve, keep the offer, hold outreach, defer.",
      "The market is assigned and the profile is fixed after R1. R5 can narrow the segment, use case or corridor within that profile."
    ].map(line => '<li>' + esc(line) + '</li>').join("") + "</ul>")}
    ${disclosure("Singapore comparison base", facts(SINGAPORE) + sourceLinks(["revolut", "transfers", "paynow", "mexico", "argentina", "indicators"]))}
    ${disclosure("CAGE and Uppsala", "<p>For each CAGE dimension, compare one Singapore fact with one market fact and identify the effect on your plan. Rank two differences. For Uppsala, link a first local relationship and learning activity to a larger commitment only when evidence justifies it.</p>" + sourceLinks(["cage", "uppsala"]))}
    ${disclosure("Published assessment · 70 written / 30 oral", facts(RUBRIC.map(([,name,weight,checks]) => [name + " · " + weight, checks.join(" · ")])) + "<p>" + esc(QUESTION) + "</p>")}
    ${disclosure("Seminar programme · Moscow time", '<ul class="pv-schedule">' + SCHEDULE.map(item =>
      "<li><strong>" + interval(scheduledRoom, item.from, item.to) +
      "</strong><span>" + esc(item.label) + "</span></li>").join("") + "</ul>")}`;
  ui.materials.showModal();
}

function recordPhase(now) {
  const record = view.record;
  if (record.mode === "live") return phaseAt(record.room, now);
  if (view.practiceReview) return {id: view.practiceReview, to: null, bulletinB: record.bulletinB};
  return {id: ROUNDS[record.history.length]?.id || "PREP", to: null, bulletinB: record.bulletinB};
}

function progressBar(phase, path) {
  return '<ol class="pv-progress" aria-label="Round progress">' +
    ROUNDS.map((round, index) => `<li${phase.id === round.id ? ' aria-current="step"' : ""} class="${index < path.length ? "pv-step-done" : ""}">
      <strong class="pv-mono">${round.id}</strong><span class="pv-step-name">${esc(round.short)}</span></li>`).join("") + "</ol>";
}

function marketDossier(market, selected) {
  const profiles = selected ? [[selected, market.profiles[selected]]] : Object.entries(market.profiles);
  return `<div class="pv-wording">
    ${facts(market.facts)}
    ${profiles.map(([id, profile]) => `<article class="pv-dossier"><p class="pv-mono">Profile ${id}</p>
      <h3>${esc(profile.name)}</h3><p>${esc(profile.journey)}</p><p><strong>Suggested channel</strong> · ${esc(profile.channel)}</p>
      <ul>${profile.alternatives.map(([name, detail, link]) => `<li><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a> · ${esc(detail)}</li>`).join("")}</ul></article>`).join("")}
    ${sourceLinks(market.sources)}
  </div>`;
}

function worksheet(round, record, locked = false) {
  return '<div class="pv-fields">' + WORKSHEET[round.id].map(([field, label]) =>
    '<label class="pv-field">' + esc(label) + '<textarea maxlength="' + CONFIG.maxNote + '" ' +
    (locked ? 'readonly' : 'data-note data-round="' + round.id + '" data-field="' + field + '"') + '>' +
    esc(record.notes[round.id + "." + field]) + '</textarea></label>').join("") + "</div>";
}

function optionCard(option, selected, round) {
  return `<label class="pv-choice">
    <input type="radio" name="choice" value="${option.id}" data-draft="choice" data-round="${round.id}"
      ${option.blocked ? "disabled" : ""}${selected === option.id ? " checked" : ""}>
    <span class="pv-choice-card"><span class="pv-choice-top">
      <span class="pv-cost pv-mono">${option.cost} ${option.cost === 1 ? "credit" : "credits"}</span><span class="pv-radio-mark" aria-hidden="true"></span>
    </span><span class="pv-choice-title">${esc(option.label)}</span>
    <span class="pv-choice-text">${esc(option.description)}</span>
    ${option.blocked ? '<span class="pv-lock">' + esc(option.blocked) + "</span>" : ""}
    </span>
  </label>`;
}

function stageLabel(phase) {
  const round = ROUNDS.find(item => item.id === phase.id);
  if (round) return round.id + " · " + round.short;
  return SCHEDULE.find(item => item.id === phase.id)?.label ?? "Board Brief";
}

// The hidden game result, shown as progress: what is earned so far and the most that is still possible.
function meterHtml(record) {
  const progress = gameProgress(record);
  const earned = Math.round(progress.earned);
  const possible = Math.round(progress.possible);
  const summary = progress.final !== null ? "<strong>" + earned + "</strong> · final" : "<strong>" + earned + "</strong> earned · up to <strong>" + possible + "</strong>";
  return `<div class="pv-meter" data-meter><p class="pv-mono">Board confidence</p>
    <div class="pv-meter-bar" role="img" aria-label="${earned} points earned, up to ${possible} still possible">
      <span class="pv-meter-possible" style="width:${possible}%"></span><span class="pv-meter-earned" style="width:${earned}%"></span></div>
    <p class="pv-meter-text">${summary}</p></div>`;
}

// The bar that stays on screen while the page scrolls: table and market, stage and its timer, progress and credits.
function stickyBar(record, state, phase, path) {
  const market = MARKETS[record.market];
  return `<div class="pv-sticky" data-sticky><div class="pv-bar">
      <div class="pv-bar-id"><p class="pv-mono">Team ${record.team}${record.mode === "practice" ? " · Practice" : ""}</p>
        <h1 class="pv-board-title">${esc(market.name)}</h1><p class="pv-board-context">${esc(market.city)} · ${market.currency}</p></div>
      <div class="pv-bar-stage"><p class="pv-mono" data-stage-name>${esc(stageLabel(phase))}</p>
        <div class="pv-clock" data-clock hidden><span data-clock-label></span><strong data-clock-time></strong></div></div>
      ${meterHtml(record)}
      <div class="pv-budget" aria-label="${state.credits} of ${CONFIG.budget} credits left"><strong>${state.credits}</strong><span class="pv-mono">Credits<br>left</span>
        <small class="pv-credits-preview" data-credits-preview hidden></small></div>
    </div>${progressBar(phase, path)}</div>`;
}

function roundCard(round, state, record, phase) {
  const market = MARKETS[record.market];
  const dossier = round.id === "R1" ? disclosure("Singapore and assigned market facts", facts(SINGAPORE) + marketDossier(market, null), false) : "";
  const candidates = round.id === "R3" ? disclosure("Local candidate files · simulation", facts(Object.values(market.candidates)), false) : "";
  const incoming = pendingFact(round.id, state, record.market);
  const update = incoming ? '<div class="pv-event"><p class="pv-mono">New information</p><p>' + esc(incoming) + "</p></div>" : "";
  const emergency = round.id === "R6" ? `<div class="pv-event"><p class="pv-mono">Bulletin A · alert</p><p>${esc(BULLETINS.A)}</p></div>
    ${phase.bulletinB ? '<div class="pv-event"><p class="pv-mono">Bulletin B · verified facts</p><p>' + esc(BULLETINS.B) + '</p><p class="pv-block-gap">' + esc(market.profiles[state.profile].incident) + "</p></div>" :
      '<p class="pv-task">Bulletin B opens eight minutes into R6. The response choices unlock then.</p>'}` : "";
  return dossier + candidates + update + emergency + '<div class="pv-task"><strong>Team task</strong>' + esc(round.task) + '</div>';
}

function decisionForm(round, state, record) {
  const draft = record.drafts[round.id] || {};
  const options = optionsFor(round.id, state, record.market);
  const available = options.some(option => option.id === draft.choice && !option.blocked);
  const output = available ? "You have " + (state.credits - options.find(option => option.id === draft.choice).cost) + " credits after this choice." :
    "Select an action. Add evidence and a trade-off before you lock it.";
  return `<form data-form="lock" data-round="${round.id}">
    <fieldset class="pv-choices"><legend>Choose one action</legend>
      ${options.map(option => optionCard(option, draft.choice, round)).join("")}
    </fieldset>
    ${round.id === "R6" ? `<label class="pv-field pv-problem" data-problem${draft.choice === "targeted" ? "" : " hidden"}>Which problem does this correction address?
      <select class="pv-input" data-draft="problem" data-round="R6"><option value="">Select a problem…</option>${PROBLEMS.map(item =>
        `<option value="${item.id}"${draft.problem === item.id ? " selected" : ""}>${esc(item.label)}</option>`).join("")}</select></label>` : ""}
    <div class="pv-fields">
      <label class="pv-field">Evidence or assumption<textarea data-draft="evidence" data-round="${round.id}" maxlength="${CONFIG.maxNote}" required>${esc(draft.evidence)}</textarea></label>
      <label class="pv-field">Benefit and trade-off<textarea data-draft="tradeoff" data-round="${round.id}" maxlength="${CONFIG.maxNote}" required>${esc(draft.tradeoff)}</textarea></label>
    </div>
    <div class="pv-commit pv-commit--decision"><p data-choice-hint>${esc(output)}</p>
      <button type="submit" class="pv-button pv-button--primary"${available && isDraftComplete(draft, round.id) ? "" : " disabled"}>Lock this choice</button>
    </div></form>`;
}

function roundScreen(round, state, record, phase, lastEvent) {
  const title = round.title;
  const time = record.mode === "practice" ? "Practice" : interval(record.room, phase.from, phase.to);
  const label = round.id + " · " + time;
  if (lastEvent?.round === round.id) {
    const next = record.mode === "practice" ?
      button(round.id === "R7" ? "Prepare the Board Brief" : "Next round", "next-practice", "primary") :
      '<p>Continue preparing your worksheet. The next stage opens on the classroom clock.</p>';
    const note = lastEvent.method === "default" ? "Default recorded" : "Decision locked";
    return stage(title, label, `<div class="pv-record"><p class="pv-mono">${note}</p><h3>${esc(lastEvent.label)}</h3>
        <p>${esc(lastEvent.result)}</p><p>${lastEvent.cost} spent · ${lastEvent.credits} remaining</p></div>
      ${record.mode === "live" && syncLine(record) ? '<div class="pv-panel pv-checkpoint"><strong>Saved to Google Sheets.</strong>' + syncLine(record) + "</div>" : ""}
      ${disclosure("Team worksheet", worksheet(round, record), true)}
      <div class="pv-commit">${next}</div>`, "review");
  }

  const beforeBulletin = round.id === "R6" && !phase.bulletinB;
  return stage(title, label, roundCard(round, state, record, phase) +
    (beforeBulletin ? disclosure("Team worksheet", worksheet(round, record), true) +
      (record.mode === "practice" ? '<div class="pv-commit">' + button("Reveal bulletin B", "practice-b", "primary") + "</div>" : "") :
      decisionForm(round, state, record) + disclosure("Team worksheet", worksheet(round, record), true) +
      (record.mode === "practice" ? '<div class="pv-file-actions">' + button("Try this round’s default", "practice-default", "text") + "</div>" : "")),
    round.id === "R6" ? "event" : "");
}

function logList(path, detailed = false, record = null) {
  if (!path.length) return '<p class="pv-inline-note">Decisions appear after they are locked.</p>';
  return '<ol class="pv-log">' + path.map(event =>
    '<li><span class="pv-mono">' + event.round + '</span> <strong>' + esc(event.label) + '</strong><p>' +
    event.cost + " spent · " + event.credits + " left" + (event.method === "default" ? " · default" : "") + "</p>" +
    (detailed ? "<p>" + esc(event.result) + "</p>" +
      (event.evidence ? '<p class="pv-journal-notes"><strong>Evidence</strong> · ' + esc(event.evidence) + "</p>" : "") +
      (event.tradeoff ? '<p class="pv-journal-notes"><strong>Trade-off</strong> · ' + esc(event.tradeoff) + "</p>" : "") +
      (record ? disclosure("Worksheet for " + event.round, worksheet(ROUNDS.find(round => round.id === event.round), record, true)) : "") : "") + "</li>").join("") + "</ol>";
}

function gameResult(record) {
  const result = gameScore(record);
  const share = Math.round(tuning().gameShare * 100);
  return '<div class="pv-record pv-game-result"><p class="pv-mono">Your game result</p><h3>' + Math.round(result.total) + " / 100</h3>" +
    '<table class="pv-breakdown"><tbody>' + result.parts.map(part => "<tr><td>" + esc(part.label) + "</td><td>" + Math.round(part.points) + "</td></tr>").join("") + "</tbody></table>" +
    "<p>The game result counts for " + share + "% of your final grade; the expert panel decides the other " + (100 - share) + "%. The Chair announces the final decision.</p></div>";
}

function resultScreen(phase, state, path, record) {
  const last = path.at(-1);
  const outcome = OUTCOMES[last.choice];
  const editing = phase.id === "PREP";
  return stage("Board Brief", record.mode === "practice" ? "Practice outcome" : "Investment hearing", `
    <div class="pv-record pv-checkpoint"><p class="pv-mono">Your recommendation</p><h3>${esc(outcome[0])}</h3><p>${esc(outcome[1])}</p></div>
    ${gameResult(record)}
    <div class="pv-task"><strong>At the hearing</strong>Three minutes to pitch and one minute for the common question. Show the first customer, two CAGE findings, the Uppsala pathway, what the budget changed and how you handled the emergency.</div>
    <p><strong>Common question</strong> · ${esc(QUESTION)}</p>
    <label class="pv-field pv-block-gap">One-page Board Brief
      <textarea rows="10" maxlength="${CONFIG.maxNote * 3}"${editing ? ' data-brief' : ' readonly'}
      placeholder="Market and funding ask · Customer and competing offer · CAGE and entry milestones · Budget trade-off · Emergency and launch condition">${esc(record.brief)}</textarea>
    </label>
    ${disclosure("Review the full decision journal", logList(path, true, record))}
    <p class="pv-inline-note pv-block-gap">${CONFIG.budget - state.credits} spent · ${state.credits} left. The expert panel evaluates the strategy and the pitch.</p>`, "final");
}

function waitingScreen(phase, record) {
  const pauses = {
    SETUP: ["The Board is opening the session", "R1 opens with the classroom clock. Read the rules and the Chair’s brief while you wait."],
    BREAK: ["Seminar break", "R5 opens when the second seminar begins. Your decisions and notes are saved in Google Sheets."]
  };
  const [title, info] = pauses[phase.id] || ["Waiting for the next stage", "Follow the facilitator’s instructions."];
  return stage(title, MARKETS[record.market].name, '<p>' + esc(info) + "</p>" +
    "", "review");
}

function renderTeam(now) {
  const record = view.record;
  const market = MARKETS[record.market];
  const {state, path} = replay(record);
  const phase = recordPhase(now);
  const round = ROUNDS.find(item => item.id === phase.id);
  const body = round ? roundScreen(round, state, record, phase, path.at(-1)) :
    path.length === ROUNDS.length ? resultScreen(phase, state, path, record) : waitingScreen(phase, record);
  return `${stickyBar(record, state, phase, path)}
    <div class="pv-layout"><div>${body}</div><aside class="pv-sidebar">
      <section class="pv-sidebar-card"><h3>Decision journal</h3>${logList(path)}
        ${syncLine(record)}
      </section>
      <section class="pv-sidebar-card"><h3>Team materials</h3>
        ${disclosure("Market dossier", marketDossier(market, state.profile))}
        ${disclosure("Singapore comparison base", facts(SINGAPORE) + sourceLinks(["paynow", "revolut", "transfers"]))}
        ${path.length ? disclosure("Earlier evidence and notes", logList(path, true, record)) : ""}
        ${record.mode === "practice" ? '<div class="pv-file-actions">' + button("Reset practice", "reset", "text") + "</div>" : ""}
      </section>
    </aside></div>`;
}

function updateClock(now = trueNow()) {
  if (view.page === "host") {
    hostClock(root, now);
    return;
  }
  const clock = root.querySelector("[data-clock]");
  if (!clock || view.record?.mode !== "live") return;
  const phase = recordPhase(now);
  if (phase.to === null) return;
  const limit = (phase.id === "R6" && !phase.bulletinB ? 92 : phase.to);
  const delta = roomStart(view.record.room) + limit * 60_000 - now;
  clock.hidden = false;
  clock.dataset.near = delta <= 120_000;
  clock.querySelector("[data-clock-label]").textContent = phase.id === "R6" && !phase.bulletinB ? "Bulletin B in" : phase.id === "SETUP" || phase.id === "BREAK" ? "Next round in" : "Time left";
  clock.querySelector("[data-clock-time]").textContent = countdown(delta);
}

function render(focus = "") {
  const now = trueNow();
  const element = document.activeElement;
  const field = element?.dataset;
  const selection = [element?.selectionStart, element?.selectionEnd];
  ui.home.hidden = view.page === "home";
  ui.screen.innerHTML = view.page === "team" ? renderTeam(now) : view.page === "host" ? renderHost(now) : view.page === "recover" ? recoveryScreen() : homeScreen();
  view.pageKey = view.page === "team" ? teamKeyForView(now) : "";
  renderNotice();
  updateClock(now);
  if (focus) {
    const target = root.querySelector(focus);
    target?.focus({preventScroll: true});
    target?.scrollIntoView({block: "start", behavior: "instant"});
  } else if (field?.note !== undefined && selection[0] != null) {
    const target = [...root.querySelectorAll("textarea[data-note]")].find(item => item.dataset.round === field.round && item.dataset.field === field.field);
    target?.focus({preventScroll: true});
    target?.setSelectionRange(...selection);
  }
}

function recoveryScreen() {
  const {message, options, room, team} = view.recovery;
  const list = options.length ? '<ul class="pv-recovery">' + options.map((option, index) =>
    "<li><strong>" + esc(option.source) + "</strong> · " + MARKETS[option.record.market].name + " · " +
    (option.rounds ? "decisions locked through " + ROUNDS[option.rounds - 1].id : "no decisions locked yet") + " " +
    button("Restore this copy", "recover-pick", "", 'data-index="' + index + '"') + "</li>").join("") + "</ul>" :
    "<p>No readable copy was found in this browser.</p>";
  return stage("This saved game could not be opened", "Team " + team + (room === "PRACTICE" ? " · Practice" : ""),
    "<p>" + esc(message) + "</p><p>Restore the newest readable copy below" + (hosted() && room !== "PRACTICE" ? " or load the team from Google Sheets" : "") +
    ". The damaged save stays untouched until you choose.</p>" + list +
    '<div class="pv-file-actions pv-actions">' + (hosted() && room !== "PRACTICE" ? button("Load from Google Sheets", "recover-sheet", "primary") : "") + button("Back to home", "home") + "</div>", "event");
}

async function showRecovery(error) {
  const options = await recoveryOptions(error.room, error.team);
  view.page = "recover";
  view.record = null;
  view.practiceReview = null;
  view.recovery = {message: error.message, options, room: error.room, team: error.team};
  announce("");
  render("#omf-stage-title");
}

function fail(error) {
  if (error instanceof SaveError) void showRecovery(error);
  else announce(error.message || "The action could not be completed.", "warning");
}

function syncLine(record) {
  const summary = record.mode === "live" ? syncSummary() : null;
  if (!summary) return "";
  return '<p class="pv-backup pv-sync" data-sync-state="' + summary.state + '"><span data-sync-text>' + esc(summary.text) + "</span> " +
    button("Send again", "sync-now", "text") + "</p>";
}

function refreshSync() {
  const summary = syncSummary();
  if (!summary) return;
  for (const element of root.querySelectorAll("[data-sync-state]")) {
    element.dataset.syncState = summary.state;
    element.querySelector("[data-sync-text]").textContent = summary.text;
  }
}

// Notes change with every keystroke: send them a few seconds after the writing pauses.
let notesTimer = null;
function scheduleNotesSync() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => void triggerSync(), 4000);
}

function triggerSync(force = false) {
  if (view.page !== "team" || !view.record) return Promise.resolve();
  const job = flushSync(view.record, {force});
  refreshSync();
  return job.then(refreshSync, refreshSync);
}

function teamKeyForView(now) {
  const phase = recordPhase(now);
  return phase.id + ":" + Number(phase.bulletinB) + ":" + view.record.history.length;
}

function ask(title, message, action) {
  ui["confirm-title"].textContent = title;
  ui["confirm-text"].textContent = message;
  ui["confirm-yes"].textContent = action;
  ui.confirm.returnValue = "cancel";
  return new Promise(resolve => {
    ui.confirm.addEventListener("close", () => resolve(ui.confirm.returnValue === "confirm"), {once: true});
    ui.confirm.showModal();
  });
}

function showTeam(record, message = "") {
  view.page = "team";
  view.record = record;
  view.practiceReview = null;
  view.team = record.team;
  activeTeam({room: record.room, team: record.team});
  const stale = contentMismatch(record) ? " This save was made with a different version of the game content, so the text and results shown here may differ from what the team saw." : "";
  announce((message + stale).trim(), stale ? "warning" : "info");
  render("#omf-stage-title");
  void requestPersistence();
  void triggerSync();
}

// Opens the team's dashboard. In the hosted game the room, team and market come from the sheet; in practice and in
// the older classroom entry they come from the form. `auto` means no one pressed a button: a problem is reported, not asked about.
async function openTable({room, team, market, mode, auto = false}) {
  view.team = team;
  const live = mode === "live";
  let record;
  let resumed = null;
  try {
    // A practice team keeps its saved game. Choosing another market means starting over, so ask first.
    let saved = readSlot(room, team);
    if (saved && saved.market !== market) {
      const replace = await ask("Start a new practice game?", "Team " + team + " already has a saved practice game for " + MARKETS[saved.market].name +
        " (" + saved.history.length + " of " + ROUNDS.length + " decisions). Replace it with a new game for " + MARKETS[market].name + "?", "Replace it");
      if (!replace) return;
      await view.writes;
      clearSlot(room, team);
      saved = null;
    }
    // On a new device (or after the browser data was cleared) the sheet holds the team's earlier game.
    if (!saved && live && hosted() && view.player) {
      try {
        const payload = await fetchTeam(view.player.id);
        if (payload.decisions.length || payload.notes.length || payload.brief) resumed = recordFromPayload(payload, market);
      } catch (error) {
        if (auto) throw new Error("Google Sheets cannot be reached (" + (error.message || "no connection") + "). Press “Open the game” to try again.");
        if (!await ask("Google Sheets cannot be reached", "The page could not check Google Sheets for an earlier game of team " + team + " (" + (error.message || "no connection") +
            "). If this team has already played, starting again may conflict with its recorded decisions. Start anyway?", "Start anyway")) return;
      }
    }
    record = await withSaveLock(teamKey(room, team), () => {
      let record = readSlot(room, team);
      if (record && record.market !== market) throw new Error("This team has a saved game for another market. Reopen the page and try again.");
      record = record || resumed || newRecord(mode, room, team, market);
      record = settleDeadlines(record, trueNow());
      storeRecord(record);
      return record;
    });
  } catch (error) {
    if (error instanceof SaveError) return showRecovery(error);
    throw error;
  }
  view.stayHome = false;
  showTeam(record, resumed && record.session === resumed.session ? "Continued from Google Sheets: " + record.history.length + " of " + ROUNDS.length + " decisions restored." : "");
}

// The practice form: one team on this device, nothing is sent anywhere.
async function join() {
  await openTable({room: "PRACTICE", team: view.team, market: view.market, mode: "practice"});
}

// The captain's device opens the game as soon as the facilitator starts it.
async function enterGame(auto = false) {
  const me = view.me;
  if (!view.player || !me || me.state !== "started" || !me.captain || roomStart(me.room) === null) return;
  await openTable({room: me.room, team: me.team, market: marketForTable(me.room, me.team), mode: "live", auto});
}

async function signUp(form) {
  const data = new FormData(form);
  const international = data.get("international");
  if (!international) throw new Error("Say whether you are an international student.");
  view.pendingId ||= newId();
  const me = await joinGame(view.pendingId, String(data.get("name") || ""), international === "yes");
  view.player = {id: view.pendingId, name: me.name};
  view.pendingId = "";
  writePlayer(view.player);
  setParticipant(view.player.id);
  view.me = me;
  view.meKey = JSON.stringify(me);
  announce("");
  render("#omf-entry-title");
}

// Asks the sheet where this player stands; the page changes when the facilitator forms the teams or starts the game.
async function pollMe() {
  if (!hosted() || !view.player || view.page !== "home" || view.entryMode !== "live" || document.visibilityState === "hidden") return;
  let me;
  try { me = await fetchMe(view.player.id); }
  catch { return; }
  if (view.page !== "home") return;
  if (!me.found) {
    view.player = null;
    view.me = null;
    view.meKey = "";
    writePlayer(null);
    setParticipant("");
    announce("The game was reset. Join your team again.", "warning");
    render("#omf-entry-title");
    return;
  }
  const key = JSON.stringify(me);
  view.me = me;
  if (key !== view.meKey) {
    view.meKey = key;
    render();
  }
  if (me.state === "started" && me.captain && !view.stayHome && !view.busy) await run(() => enterGame(true));
}

function saveChange(change, now = trueNow()) {
  const expected = view.record;
  if (!expected) return Promise.resolve();
  const job = view.writes.then(() => withSaveLock(teamKey(expected.room, expected.team), () => {
    const current = readSlot(expected.room, expected.team);
    if (!current || current.session !== expected.session) throw new Error("The saved team session has changed. Reopen it from Home.");
    const settled = settleDeadlines(current, now);
    if (settled !== current) storeRecord(settled);
    const next = change(settled, now);
    if (next !== settled) storeRecord(next);
    if (view.record?.session === expected.session) view.record = next;
    if (next.history.length !== current.history.length) setTimeout(() => void triggerSync(), 0);
    return next;
  }));
  view.writes = job.catch(() => {});
  return job;
}

function updateChoiceHint() {
  const form = root.querySelector('form[data-form="lock"]');
  if (!form || !view.record) return;
  const id = form.dataset.round;
  const draft = view.record.drafts[id];
  const {state} = replay(view.record);
  const item = optionsFor(id, state, view.record.market).find(item => item.id === draft?.choice && !item.blocked);
  form.querySelector('button[type="submit"]').disabled = !item || !isDraftComplete(draft, id);
  form.querySelector("[data-choice-hint]").textContent = item ? "You have " + (state.credits - item.cost) + " credits after this choice." :
    "Select an action. Add evidence and a trade-off before you lock it.";
  const problem = form.querySelector("[data-problem]");
  if (problem) problem.hidden = draft?.choice !== "targeted";
  // Preview the spend in the bar that stays on screen.
  const preview = root.querySelector("[data-credits-preview]");
  if (preview) {
    preview.hidden = !item || item.cost === 0;
    if (item) preview.textContent = state.credits + " → " + (state.credits - item.cost);
  }
}

function capture(element) {
  if (view.page !== "team") return;
  const {draft, note, round, field, brief} = element.dataset;
  const value = element.value;
  let change;
  if (draft) change = (record, now) => updateDraft(record, round, draft, value, now);
  else if (note !== undefined) change = (record, now) => updateNote(record, round, field, value, now);
  else if (brief !== undefined) change = (record, now) => updateBrief(record, value, now);
  if (change) void saveChange(change).then(updateChoiceHint).catch(fail);
  if (note !== undefined || brief !== undefined) scheduleNotesSync();
}

async function submitRound(round, useDefault = false) {
  const open = view.record;
  if (open?.mode === "live" && !useDefault) {
    const phase = phaseAt(open.room, trueNow());
    const left = phase.to === null ? 0 : roomStart(open.room) + phase.to * 60_000 - trueNow();
    if (left > 10_000 && !await ask("Lock this decision?", "A locked decision is final: you cannot change it afterwards. " + countdown(left) +
        " is still left in this stage. Your worksheet notes stay editable until the stage closes.", "Lock decision")) return;
  }
  const record = await saveChange((current, now) => lockRound(current, round, now, useDefault));
  if (!record) return;
  if (record.mode === "practice") view.practiceReview = round;
  announce("");
  render("#omf-stage-title");
}

async function restoreRecord(record, message, confirm = true) {
  const key = teamKey(record.room, record.team);
  await view.writes;
  const before = getStored(key);
  if (confirm && before !== null && !await ask("Replace a saved game?", "Replace the saved game of team " + record.team + " (" + MARKETS[record.market].name + ") with this copy?", "Replace")) return;
  const next = await withSaveLock(key, () => {
    if (getStored(key) !== before) throw new Error("The save changed. Pick the file again.");
    const restored = settleDeadlines({...record, session: newId()}, trueNow());
    storeRecord(restored);
    return restored;
  });
  showTeam(next, message);
}

function home() {
  if (view.record) {
    view.entryMode = view.record.mode;
    view.stayHome = view.record.mode === "live";
    if (view.record.mode !== "live") view.market = view.record.market;
  }
  view.page = "home";
  view.record = null;
  view.recovery = null;
  view.practiceReview = null;
  activeTeam(null);
  announce("");
  render("#omf-entry-title");
}

async function run(action) {
  if (view.busy) return;
  view.busy = true;
  try { await action(); }
  catch (error) { fail(error); }
  finally { view.busy = false; }
}

const controls = {
  home: async () => { await view.writes; home(); },
  host: async () => {
    await view.writes; view.page = "host"; view.record = null; activeTeam(null); announce(""); render("#omf-stage-title");
    void refreshHostData({render, announce});
  },
  materials: renderMaterials,
  "close-materials": () => ui.materials.close(),
  "jump-entry": () => {
    const heading = root.querySelector("#omf-entry-title");
    heading.focus({preventScroll: true});
    heading.scrollIntoView({block: "start", behavior: "instant"});
  },
  "recover-sheet": async () => {
    const {room, team} = view.recovery;
    const payload = await fetchTeam(view.player?.id ?? "");
    await restoreRecord(recordFromPayload(payload, marketForTable(room, team)), "Loaded from Google Sheets.", false);
  },
  "enter-game": () => { view.stayHome = false; return enterGame(false); },
  ready: async () => {
    view.me = await setReady(view.player.id, !view.me.ready);
    view.meKey = JSON.stringify(view.me);
    render();
  },
  captain: async () => {
    if (!await ask("Play on this device?", "Your team plays on one device, the captain’s. If you take over, the other device should stop playing.", "Play here")) return;
    view.me = await claimCaptain(view.player.id);
    view.meKey = JSON.stringify(view.me);
    view.stayHome = false;
    render();
    await enterGame(false);
  },
  "entry-mode": () => { view.entryMode = view.entryMode === "live" ? "practice" : "live"; render("#omf-entry-title"); },
  "practice-b": async () => {
    await saveChange(record => ({...record, bulletinB: true}));
    render("#omf-stage-title");
  },
  "practice-default": () => submitRound(ROUNDS[view.record.history.length].id, true),
  "sync-now": () => triggerSync(true),
  "recover-pick": target => {
    const option = view.recovery?.options[Number(target.dataset.index)];
    if (option) return restoreRecord(option.record, "Restored the " + option.source + ".", false);
  },
  "next-practice": () => { view.practiceReview = null; render("#omf-stage-title"); },
  reset: async () => {
    const record = view.record;
    if (record?.mode !== "practice" || !await ask("Reset the practice team?", "Its locally saved choices and notes will be removed.", "Reset practice")) return;
    await view.writes;
    await withSaveLock(teamKey(record.room, record.team), () => {
      if (readSlot(record.room, record.team)?.session !== record.session) throw new Error("The practice save has changed.");
      clearSlot(record.room, record.team);
    });
    home();
  }
};

root.addEventListener("click", event => {
  const target = event.target.closest("button[data-action]");
  if (!target || target.disabled) return;
  const id = target.dataset.action;
  if (Object.hasOwn(controls, id)) void run(() => controls[id](target));
  else if (view.page === "host" && id.startsWith("host-")) void run(() => handleHostAction(id, target, {render, announce, ask}));
});

root.addEventListener("submit", event => {
  const form = event.target;
  if (form.dataset.form === "join") { event.preventDefault(); void run(join); }
  else if (form.dataset.form === "signup") { event.preventDefault(); void run(() => signUp(form)); }
  else if (form.dataset.form === "lock") {
    event.preventDefault();
    void run(() => submitRound(form.dataset.round));
  }
});

root.addEventListener("input", event => {
  const input = event.target;
  if (input.matches("textarea")) capture(input);
  if (input.dataset.host) updateHostField(input);
});

root.addEventListener("change", event => {
  const input = event.target;
  if (input.dataset.entry === "team") view.team = Number(input.value);
  else if (input.dataset.entry === "market") view.market = input.value;
  else if (input.dataset.draft === "choice" || input.dataset.draft === "problem") capture(input);
  else if (input.dataset.host) updateHostField(input, render);
});

async function syncTeam() {
  if (view.page !== "team" || !view.record || view.busy) return;
  const now = trueNow();
  if (view.record.mode === "live" && teamKeyForView(now) !== view.pageKey) {
    await run(async () => { await saveChange(record => record, now); render(); });
  }
  updateClock(now);
}

window.addEventListener("storage", event => {
  if (view.page !== "team" || view.busy || event.key !== teamKey(view.record.room, view.record.team)) return;
  void run(async () => {
    const current = readSlot(view.record.room, view.record.team);
    if (!current) { home(); return; }
    if (current.history.length !== view.record.history.length || current.session !== view.record.session) {
      view.record = current;
      view.practiceReview = null;
      announce("The team save was updated in another tab.");
      render();
    }
  });
});

let previousHostTick = 0;
setInterval(() => void triggerSync(), 30_000);
setInterval(() => void pollMe(), 5000);
window.addEventListener("online", () => void triggerSync());

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void triggerSync(); });

// The facilitator's page follows the sheet.
setInterval(() => { if (view.page === "host") void refreshHostData({render, announce}); }, 8_000);

setInterval(() => {
  if (view.page === "team") void syncTeam();
  if (view.page === "host") {
    const now = trueNow();
    if (now - previousHostTick > 350) { updateClock(now); previousHostTick = now; }
  }
}, 300);

// Settle deadlines only after the shared clock is known: an early default is written permanently.
const syncing = syncClock().catch(() => {});
await Promise.race([syncing, new Promise(resolve => setTimeout(resolve, 3000))]);
void syncing.then(() => renderNotice());
setInterval(() => void syncClock().then(() => renderNotice(), () => {}), 10 * 60_000);

const last = activeTeam();
if (knownTable(last)) {
  view.entryMode = last.room === "PRACTICE" ? "practice" : "live";
  view.team = last.team;
  try {
    const record = readSlot(last.room, last.team);
    if (record) {
      view.page = "team";
      view.record = record;
      await saveChange(current => current);
    }
  } catch (error) {
    view.page = "home";
    view.record = null;
    if (error instanceof SaveError) await showRecovery(error);
    else announce(error.message, "warning");
  }
}
render();
void triggerSync();
void pollMe();
