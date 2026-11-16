import test from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC } from '../src/scenario.mjs';
import { CONFIG } from '../src/scenario.mjs';
import { LEGACY, useTuning } from '../src/tuning.mjs';
import { makeRoom, scoreJury, scoreExpert, rankScores, compareScores, standings, gameScore, problemFor } from '../src/rules.mjs';
import { csvCell, scoresCsv, countdown } from '../src/presentation.mjs';

const room = makeRoom(Date.parse("2026-11-14T18:30:00+03:00"), 0, "ABC"); // tables: Indonesia, Philippines, Thailand, Vietnam
const full = () => ({complete: true, checks: RUBRIC.map(() => [true, true, true, true])});
const without = (rows) => { const sheet = full(); for (const row of rows) sheet.checks[row] = [false, false, false, false]; return sheet; };

test("One expert's points follow the rubric weights", () => {
  assert.deepEqual(scoreExpert(full()), {written: 70, oral: 30, uppsala: 16, total: 100});
  assert.deepEqual(scoreExpert(without([2])), {written: 54, oral: 30, uppsala: 0, total: 84});
  assert.deepEqual(scoreExpert(null), {written: 0, oral: 0, uppsala: 0, total: 0});
  assert.equal(scoreExpert({checks: [["x", true, 1, true]]}).total, 20 / 4 * 2, "only a literal true counts");
  assert.doesNotThrow(() => scoreExpert({checks: [{}, "text", null, 7]}));
});

test("Equal scores share a rank and unscored tables have none", () => {
  const a = {total: 90, oral: 20, uppsala: 10};
  const b = {total: 95, oral: 20, uppsala: 10};
  assert.deepEqual(rankScores([a, b, null, {...a}]), [2, 1, null, 2]);
  assert.ok(compareScores(b, a) < 0);
});

test("Cells are quoted only when needed and inner quotes are doubled", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("a,b", ";"), "a,b");
  assert.equal(csvCell("a;b", ";"), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(" padded"), '" padded"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(0), "0");
});

// The pre-v3 format: no game result in the table.
const legacy = run => () => { const restore = useTuning(LEGACY); try { run(); } finally { restore(); } };

const grades = {
  1: [full(), full(), full()],                                       // 100
  2: [full(), full(), full()],                                       // 100: tied with table 1
  3: [without([5]), without([5]), without([5])],                     // row 5 is the 20-point "Board pitch" row: 100 - 20 = 80
  4: [full(), full(), {complete: false, checks: []}]                 // third sheet unfinished
};

test("The CSV has rounded numbers, per-expert totals, ranks and a status for every table", legacy(() => {
  const csv = scoresCsv(room, grades);
  assert.ok(csv.startsWith("﻿"), "BOM for Excel");
  assert.ok(csv.endsWith("\r\n"));
  assert.deepEqual(csv.slice(1).split("\r\n").slice(0, 5), [
    "rank,table,market,written_70,oral_30,uppsala_16,total_100,expert1_total,expert2_total,expert3_total,status",
    "1,1,Indonesia,70.0,30.0,16.0,100.0,100.0,100.0,100.0,tied: the Chair decides",
    "1,2,Philippines,70.0,30.0,16.0,100.0,100.0,100.0,100.0,tied: the Chair decides",
    "3,3,Thailand,70.0,10.0,16.0,80.0,80.0,80.0,80.0,complete",
    ",4,Vietnam,,,,,100.0,100.0,,pending: 2 of 3 expert sheets complete"
  ]);
}));

test("The Russian Excel variant uses semicolons and decimal commas", legacy(() => {
  const lines = scoresCsv(room, grades, {russianExcel: true}).slice(1).split("\r\n");
  assert.equal(lines[0], "rank;table;market;written_70;oral_30;uppsala_16;total_100;expert1_total;expert2_total;expert3_total;status");
  assert.equal(lines[3], "3;3;Thailand;70,0;10,0;16,0;80,0;80,0;80,0;80,0;complete");
}));

test("Averages are rounded to one decimal and a table with no sheets is pending", legacy(() => {
  const uneven = {1: [full(), full(), without([5, 6])]};   // third expert 100 - 30 = 70 -> average 90
  const [, line] = scoresCsv(room, uneven).slice(1).split("\r\n");
  assert.equal(line, "1,1,Indonesia,70.0,20.0,16.0,90.0,100.0,100.0,70.0,complete");
  const none = scoresCsv(room, {}).slice(1).split("\r\n");
  assert.equal(none[1], ",1,Indonesia,,,,,,,,pending: 0 of 3 expert sheets complete");
  assert.equal(scoreJury(uneven[1]).total, 90);
}));

// ---- The approved format: the final grade is 65% experts and 35% game result ----

const when = "2026-01-01T00:00:00.000Z";
function team(tableNo, choices) {
  return {game: CONFIG.game, version: CONFIG.version, mode: "live", team: tableNo, market: ["indonesia", "philippines", "thailand", "vietnam"][tableNo - 1], room, session: "s", drafts: {}, notes: {}, brief: "", bulletinB: true,
    history: choices.map((choice, index) => ({round: "R" + (index + 1), choice, method: "submitted", at: when, evidence: "e", tradeoff: "t",
      ...(index === 5 && choice === "targeted" ? {problem: problemFor(["indonesia", "philippines", "thailand", "vietnam"][tableNo - 1], choices[0])} : {})}))};
}
const cheapPilot = ["A", "desk", "pilot", "verify", "narrow", "targeted", "pilot"];     // 70 in Indonesia and in the Philippines
const deferral = ["A", "desk", "pilot", "reserve", "keep", "hold", "defer"];            // 10
const records = {1: team(1, cheapPilot), 2: team(2, cheapPilot), 3: team(3, deferral)};
const mixed = {...grades, 3: [without([5]), without([5]), without([5])]};

test("The game result comes from the imported team files and the final grade follows the 65/35 rule", () => {
  assert.equal(gameScore(records[1]).total, 70);
  assert.equal(gameScore(records[3]).total, 10);
  const rows = standings(mixed, records);
  assert.equal(rows[0].final, 0.65 * 100 + 0.35 * 70);
  assert.equal(rows[2].final, 0.65 * 80 + 0.35 * 10);
  assert.equal(rows[3].final, null, "table 4 still lacks an expert sheet and a team file");
  assert.deepEqual(rows.map(row => row.rank), [1, 1, 3, null]);
  assert.deepEqual(rows.map(row => row.tied), [true, true, false, false]);
});

test("At a 35% share a strong game result can outweigh a clearly better argument", () => {
  // Argument A is 20 expert points better; B has a 60-point better game result.
  const strong = [full(), full(), full()];                                                  // 100 from the experts
  const weak = [without([0]), without([0]), without([0])];                                  // 80 from the experts
  const grades = {1: weak, 2: strong};
  const results = {1: team(1, cheapPilot), 2: team(2, deferral)};                           // 70 in the game, against 10
  const [a, b] = standings(grades, results);
  assert.equal(a.final, 0.65 * 80 + 0.35 * 70);                                             // 76.5
  assert.equal(b.final, 0.65 * 100 + 0.35 * 10);                                            // 68.5
  assert.ok(a.final > b.final, "20 expert points are worth 13 final points; 60 game points are worth 21");
  // The expert gap that would still win against a 60-point game gap: 60 * 0.35 / 0.65 = 32.3 points.
  assert.ok(Math.abs(60 * 0.35 / 0.65 - 32.3) < 0.05);
});

test("The CSV adds the game result and the final grade, or says what is missing", () => {
  const lines = scoresCsv(room, mixed, {records}).slice(1).split("\r\n");
  assert.deepEqual(lines.slice(0, 5), [
    "rank,table,market,written_70,oral_30,uppsala_16,expert_total_100,game_100,final_100,expert1_total,expert2_total,expert3_total,status",
    "1,1,Indonesia,70.0,30.0,16.0,100.0,70.0,89.5,100.0,100.0,100.0,tied: the Chair decides",
    "1,2,Philippines,70.0,30.0,16.0,100.0,70.0,89.5,100.0,100.0,100.0,tied: the Chair decides",
    "3,3,Thailand,70.0,10.0,16.0,80.0,10.0,55.5,80.0,80.0,80.0,complete",
    ",4,Vietnam,,,,,,,100.0,100.0,,pending: 2 of 3 expert sheets complete"
  ]);
  const ru = scoresCsv(room, mixed, {records, russianExcel: true}).slice(1).split("\r\n");
  assert.equal(ru[3], "3;3;Thailand;70,0;10,0;16,0;80,0;10,0;55,5;80,0;80,0;80,0;complete");
  const withoutFile = scoresCsv(room, mixed, {records: {1: records[1], 2: records[2]}}).slice(1).split("\r\n");
  assert.match(withoutFile[3], /^,3,Thailand,70\.0,10\.0,16\.0,80\.0,,,80\.0,80\.0,80\.0,pending: import the team JSON for the game result$/);
});

test("A countdown shows minutes and seconds, and adds hours only when there are any", () => {
  assert.equal(countdown(0), "00:00");
  assert.equal(countdown(-5000), "00:00");
  assert.equal(countdown(65_000), "01:05");
  assert.equal(countdown(59 * 60_000 + 59_000), "59:59");
  assert.equal(countdown(3_600_000), "1:00:00");
  assert.equal(countdown((19 * 3600 + 18 * 60 + 18) * 1000), "19:18:18");
});
