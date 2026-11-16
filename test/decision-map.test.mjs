import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMap, OUTPUT } from '../scripts/decision-map.mjs';

test("docs/decision-map.md is exactly what the game produces (run: node scripts/decision-map.mjs)", async () => {
  assert.equal(await readFile(OUTPUT, "utf8"), buildMap());
});

test("The decision map covers every market, profile and round it should", () => {
  const map = buildMap();
  for (const market of ["Indonesia", "Philippines", "Thailand", "Vietnam"]) assert.match(map, new RegExp("### " + market));
  assert.equal((map.match(/#### Профиль [AB]:/g) || []).length, 8);
  for (const round of ["R2 сигнал клиентов", "R5 ход конкурента", "R6 кризис"]) assert.match(map, new RegExp("### " + round));
  assert.match(map, /R6 какую проблему нужно назвать/);
});
