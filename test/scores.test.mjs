import test from 'node:test';
import assert from 'node:assert/strict';
import { RUBRIC } from '../src/scenario.mjs';
import { makeRoom, scoreJury, scoreExpert, rankScores, compareScores } from '../src/rules.mjs';
import { csvCell, scoresCsv } from '../src/presentation.mjs';

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

const grades = {
  1: [full(), full(), full()],                                       // 100
  2: [full(), full(), full()],                                       // 100: tied with table 1
  3: [without([5]), without([5]), without([5])],                     // row 5 is the 20-point "Board pitch" row: 100 - 20 = 80
  4: [full(), full(), {complete: false, checks: []}]                 // third sheet unfinished
};

test("The CSV has rounded numbers, per-expert totals, ranks and a status for every table", () => {
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
});

test("The Russian Excel variant uses semicolons and decimal commas", () => {
  const lines = scoresCsv(room, grades, {russianExcel: true}).slice(1).split("\r\n");
  assert.equal(lines[0], "rank;table;market;written_70;oral_30;uppsala_16;total_100;expert1_total;expert2_total;expert3_total;status");
  assert.equal(lines[3], "3;3;Thailand;70,0;10,0;16,0;80,0;80,0;80,0;80,0;complete");
});

test("Averages are rounded to one decimal and a table with no sheets is pending", () => {
  const uneven = {1: [full(), full(), without([5, 6])]};   // third expert 100 - 30 = 70 -> average 90
  const [, line] = scoresCsv(room, uneven).slice(1).split("\r\n");
  assert.equal(line, "1,1,Indonesia,70.0,20.0,16.0,90.0,100.0,100.0,70.0,complete");
  const none = scoresCsv(room, {}).slice(1).split("\r\n");
  assert.equal(none[1], ",1,Indonesia,,,,,,,,pending: 0 of 3 expert sheets complete");
  assert.equal(scoreJury(uneven[1]).total, 90);
});
