import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS, SOURCES, PROBLEMS } from '../src/scenario.mjs';
import { audit } from '../scripts/content-audit.mjs';

test("No market's text, links or sources mention another market's country, currency or institutions", () => {
  const findings = audit();
  assert.deepEqual(findings, [], findings.map(item => `${item.market} · ${item.where} mentions ${item.mentions} (${item.word})`).join("\n"));
});

test("Every market lists only sources that exist, and each profile is complete", () => {
  for (const [id, market] of Object.entries(MARKETS)) {
    for (const source of market.sources) assert.ok(SOURCES[source], id + " lists an unknown source " + source);
    assert.equal(new Set(market.sources).size, market.sources.length, id + " repeats a source");
    assert.deepEqual(Object.keys(market.profiles), ["A", "B"]);
    for (const [key, profile] of Object.entries(market.profiles)) {
      for (const field of ["name", "journey", "channel", "signal", "interview", "prototype", "competitor", "narrow", "incident", "review"]) {
        assert.ok(profile[field]?.trim(), `${id} ${key} lacks ${field}`);
      }
      assert.equal(profile.alternatives.length, 2, `${id} ${key} should compare two real alternatives`);
      for (const [name, detail, link] of profile.alternatives) assert.ok(name && detail && /^https:\/\//.test(link), `${id} ${key} has a broken alternative`);
      for (const problem of profile.problems) assert.ok(PROBLEMS.some(item => item.id === problem), `${id} ${key} names an unknown problem ${problem}`);
    }
  }
});

test("Each emergency note is about the problem that the market profile names", () => {
  // The profile text says what customers ask; the matching keyword proves the list of problems is not out of step.
  const words = {fees: /fee|charge|cost/i, speed: /instant|quick|fast/i, coverage: /QR|accept|work|supported|route/i, amount: /amount|PHP|receive|credited/i, status: /sent|received|arrived|status/i};
  for (const [id, market] of Object.entries(MARKETS)) {
    for (const [key, profile] of Object.entries(market.profiles)) {
      assert.ok(profile.problems.some(problem => words[problem].test(profile.incident)), `${id} ${key}: "${profile.incident.slice(0, 80)}" does not look like ${profile.problems}`);
    }
  }
});
