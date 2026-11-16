import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from '../scripts/serve.mjs';
import { hostApi } from '../scripts/game-test-kit.mjs';

// The game as it runs for the course: a page with a Google Sheets address. Here the sheet is the real Code.gs
// running on an in-memory spreadsheet behind the local server, reached over real HTTP.

let chromium = null;
try { ({chromium} = createRequire(import.meta.url)("playwright")); } catch { /* optional */ }
const skip = !chromium && "Playwright is not installed";
const PASSWORD = "a long test password";

async function withGame(run) {
  const server = createServer({fakeSheets: {password: PASSWORD}});
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch();
  const problems = [];
  // Every person is a browser profile of their own, as on separate devices.
  const person = async () => {
    const page = await (await browser.newContext({viewport: {width: 1280, height: 900}})).newPage();
    page.on("console", message => { if (["error", "warning"].includes(message.type()) && !/net::ERR_FAILED/.test(message.text())) problems.push(message.text()); });
    page.on("pageerror", error => problems.push(error.message));
    await page.goto(base);
    return page;
  };
  try {
    await run({person, backend: server.backend, base, api: hostApi(base, PASSWORD)});
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function signUp(page, name, international = false) {
  await page.fill('form[data-form=signup] input[name=name]', name);
  await page.check('form[data-form=signup] input[name=international][value=' + (international ? "yes" : "no") + "]");
  await page.click('form[data-form=signup] button[type=submit]');
  await page.locator(".pv-entry-panel .pv-record").waitFor();
}

async function lockFirstCard(page) {
  await page.locator("label.pv-choice:has(input[name=choice]:not([disabled])) .pv-choice-card").first().click();
  await page.fill("textarea[data-draft=evidence]", "evidence");
  await page.fill("textarea[data-draft=tradeoff]", "trade-off");
  await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
  await page.locator('dialog[open] button:has-text("Lock decision")').click();
  await page.locator('.pv-record:has-text("Decision locked")').waitFor();
}

// Waits for a condition; when it never comes, the failure carries what was seen.
async function until(check, message, timeout = 15_000, diagnose = null) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.fail(message + (diagnose ? " | " + await diagnose().catch(error => "diagnostics failed: " + error.message) : ""));
}

// The facilitator opens the dashboard, enters the password and loads the sheet.
async function openFacilitator(page) {
  await page.click("button[data-action=host]");
  await page.fill('input[data-host="token"]', PASSWORD);
  await page.click('button:has-text("Refresh now")');
  await page.locator("[data-host-players-text]:not(:has-text('Waiting for the first answer'))").waitFor();
}

// A player's page for a person who is the captain of a running game that started `minutesAgo` minutes ago.
async function captainInRunningGame(game, name, minutesAgo = 0, others = 7) {
  const page = await game.person();
  await signUp(page, name);
  await game.api.demo(others);
  await game.api.form();
  const id = game.backend.table("Players").find(row => row.name === name).id;
  await game.api.captain(id);
  assert.equal((await game.api.start(minutesAgo)).ok, true);
  return {page, id};
}

test("A newcomer has one way in: Join your team. No room code, no table number, no logo, no sheet link", {skip}, async () => {
  await withGame(async ({person}) => {
    const page = await person();
    const entry = page.locator(".pv-entry-panel");
    await entry.waitFor();
    assert.match(await page.locator("#omf-entry-title").innerText(), /^Join your team$/);
    assert.equal(await page.locator('button:has-text("Join your team")').count(), 2, "the cover button and the form button say the same thing");
    assert.equal(await entry.locator('input[data-entry="room"]').count(), 0);
    assert.equal(await entry.locator('select[data-entry="team"]').count(), 0);
    assert.equal(await entry.locator("button:has-text('Restore JSON'), button:has-text('Practice')").count(), 0);
    assert.equal(await page.locator(".pv-brand-logo, .pv-brand svg").count(), 0, "the logo is gone");
    assert.equal(await entry.locator('input[name=international]').count(), 2);
    assert.doesNotMatch(await page.content(), /docs\.google\.com|spreadsheets\/d\//, "the page never carries the link of the sheet");
    // The answer is required.
    await page.fill('input[name=name]', "Anna K");
    await page.click('form[data-form=signup] button[type=submit]');
    assert.equal(await page.locator(".pv-entry-panel .pv-record").count(), 0, "the form does not go on without the international answer");
  });
});

test("A player signs up, waits, is drawn into a team, says ready and the game opens by itself", {skip}, async () => {
  await withGame(async ({person, api, backend}) => {
    const player = await person();
    await signUp(player, "Anna K", true);
    assert.match(await player.locator(".pv-entry-panel .pv-record").innerText(), /Anna K[\s\S]*1 player has joined/);
    assert.deepEqual(backend.table("Players").map(row => [row.name, row.international]), [["Anna K", "yes"]]);

    // A reload keeps the player: no second sign-up.
    await player.reload();
    await player.locator(".pv-entry-panel .pv-record:has-text('Anna K')").waitFor();

    const facilitator = await person();
    await openFacilitator(facilitator);
    assert.match(await facilitator.locator("[data-host-players-text]").innerText(), /1 players joined \(1 international\)/);
    await facilitator.click('button:has-text("Add demo players")');
    await facilitator.locator("[data-host-players-text]:has-text('9 players joined')").waitFor();
    await facilitator.click('button:has-text("Form teams")');
    await facilitator.locator(".pv-host-assignments .pv-panel").nth(3).waitFor();
    assert.match(await facilitator.locator("[data-host-players-text]").innerText(), /Teams are formed\. 0 of 9 players are ready/);

    // The player's page changes without a reload: the team number, the teammates, the captain.
    await player.locator('.pv-entry-panel .pv-record h3:has-text("Team")').waitFor({timeout: 15_000});
    assert.match(await player.locator(".pv-entry-panel .pv-record h3").innerText(), /^Team [1-4]$/);
    assert.ok(await player.locator(".pv-team-list li").count() >= 2);
    assert.match(await player.locator(".pv-entry-panel").innerText(), /Anna K/);
    await player.click('button:has-text("I’m ready")');
    await player.locator('button:has-text("Not ready yet")').waitFor();
    await until(async () => /1 of 9 players are ready/.test(await facilitator.locator("[data-host-players-text]").innerText().then(text => text, () => "")) || (await api.roster()).players.filter(item => item.ready).length === 1,
      "the facilitator sees who is ready");
    const team = Number((await api.me(backend.table("Players")[0].id)).team);

    // Start now: the market is revealed with the team and the captain's page opens the game.
    await facilitator.selectOption('[data-host="delay"]', "0");
    await facilitator.click('button:has-text("Start the game")');
    await facilitator.locator('dialog[open] button:has-text("Start the game")').click();
    await facilitator.locator(".pv-checklist").waitFor({timeout: 15_000});
    assert.match(await facilitator.locator(".pv-checklist li[data-state=done]").first().innerText(), /Game started/);
    assert.equal(await facilitator.locator("text=/OMF-/").count(), 0, "the game number is never shown");

    const me = await api.me(backend.table("Players")[0].id);
    if (!me.captain) {
      await player.locator('.pv-entry-panel .pv-record:has-text("The game is running")').waitFor({timeout: 15_000});
      await player.click('button:has-text("Play on this device instead")');
      await player.locator('dialog[open] button:has-text("Play here")').click();
    }
    await player.locator(".pv-sticky").waitFor({timeout: 20_000});
    assert.match(await player.locator(".pv-bar-id").innerText(), new RegExp("Team " + team, "i"));
    assert.doesNotMatch(await player.locator(".pv-bar-id").innerText(), /OMF-/);
  });
});

test("Decisions and notes of the captain reach the team's sheet, the overview and the raw log", {skip}, async () => {
  await withGame(async game => {
    const {backend} = game;
    const {page, id} = await captainInRunningGame(game, "Boris T");
    await page.locator(".pv-sticky").waitFor({timeout: 20_000});
    const team = Number(backend.table("Players").find(row => row.id === id).team);
    assert.equal(await page.locator("button:has-text('Journal TXT'), button:has-text('Save JSON'), button:has-text('Download')").count(), 0, "no local files");

    await lockFirstCard(page);
    await until(() => backend.table("Decisions").length === 1, "the decision reaches the sheet");
    assert.equal(backend.table("Decisions")[0].team, team);
    assert.equal(backend.table("Decisions")[0].evidence, "evidence");
    await until(() => backend.table("Overview").some(row => row.team === team && /^R2 · Evidence \(1 of 7 decided\)$/.test(row.stage)), "the overview row moves");

    await page.locator("textarea[data-note]").first().fill("Frequent travellers in Jakarta");
    const teamSheet = () => backend.spreadsheet.getSheetByName("Team " + team).rows.map(row => row ?? []);
    await until(() => teamSheet().some(row => row[0] === "R1" && /Frequent travellers in Jakarta/.test(row[10] || "")), "the note shows in the team's own sheet", 25_000);
    const r1 = teamSheet().find(row => row[0] === "R1");
    assert.equal(r1[4], "locked by the team");
    assert.equal(r1[8], "evidence");
    assert.match(await page.locator(".pv-sync").first().innerText(), /saved with your notes/);
    // Players have no way to see the sheet; the only data they get back is their own team's.
    assert.equal(backend.spreadsheet.getSheetByName("Team " + (team % 4 + 1)).rows.some(row => (row ?? [])[0] === "R1" && row[3]), false);
  });
});

test("A teammate takes over as captain on another device and finds the team's decisions and notes", {skip}, async () => {
  await withGame(async game => {
    const {backend, api, person} = game;
    const first = await person();
    const second = await person();
    await signUp(first, "Boris T");
    await signUp(second, "Clara M");
    await api.demo(6, false);   // with only non-international players the draw can put two given people together
    const idOf = name => backend.table("Players").find(row => row.name === name).id;
    await api.formUntil(async () => (await api.me(idOf("Boris T"))).team === (await api.me(idOf("Clara M"))).team);
    await api.captain(idOf("Boris T"));
    assert.equal((await api.start(0)).ok, true);

    await first.locator(".pv-sticky").waitFor({timeout: 20_000});
    await lockFirstCard(first);
    await first.locator("textarea[data-note]").first().fill("Written on the first device");
    await until(() => backend.table("Notes").some(row => row.text === "Written on the first device"), "the note is in the sheet", 25_000);
    const credits = await first.locator(".pv-budget strong").innerText();

    // The second device has nothing stored: everything comes from the sheet.
    await second.locator('.pv-entry-panel .pv-record:has-text("The game is running")').waitFor({timeout: 15_000});
    await second.click('button:has-text("Play on this device instead")');
    await second.locator('dialog[open] button:has-text("Play here")').click();
    await second.locator(".pv-sticky").waitFor({timeout: 20_000});
    assert.match(await second.locator("[data-ui=notice]").innerText(), /Continued from Google Sheets: 1 of 7 decisions restored/);
    assert.equal(await second.locator(".pv-budget strong").innerText(), credits);
    assert.equal(await second.locator(".pv-sidebar-card").first().locator(".pv-log li").count(), 1);
    assert.equal(await second.locator("textarea[data-note]").first().inputValue(), "Written on the first device");
  });
});

test("The facilitator sees the teams from the sheet: progress, game result, the right password, and the Scores sheet", {skip}, async () => {
  await withGame(async game => {
    const {backend, person} = game;
    // R1 started 200 minutes ago: the seminar is over and the team's rounds are all settled with their defaults.
    const {page} = await captainInRunningGame(game, "Boris T", 200);
    await page.locator(".pv-game-result").waitFor({timeout: 25_000});
    await until(() => backend.table("Decisions").length === 7, "all seven decisions reach the sheet");
    const row = backend.table("Overview").find(item => item.stage === "Finished");
    assert.equal(Number(row.game_result), 20, "the plain defaults: 18 for the deferral and 2 for holding outreach");

    const facilitator = await person();
    await openFacilitator(facilitator);
    await facilitator.locator("[data-host-connection-text]:has-text('1 of 4 teams have data')").waitFor({timeout: 20_000});
    const files = facilitator.locator(".pv-checklist li", {hasText: "Team data from Google Sheets"});
    assert.match(await files.innerText(), /1 of 4 teams have all 7 decisions\. Missing: team \d, team \d, team \d\./);
    assert.match(await facilitator.locator(".pv-scores tbody").innerText(), /20\.0/);

    // The expert sheets go to the Scores sheet from the interface.
    await facilitator.click('button:has-text("Send scores to Google Sheets") >> nth=0');
    await until(() => backend.spreadsheet.getSheetByName("Scores").rows.some(cells => (cells ?? [])[0] === "Expert score sheets"), "the Scores sheet is filled");
    const scores = backend.spreadsheet.getSheetByName("Scores").rows.map(cells => cells ?? []);
    assert.deepEqual(scores[0].slice(0, 3), ["Rank", "Team", "Market"]);
    assert.equal(scores.filter(cells => /^Expert [123]$/.test(cells[2])).length, 12, "three experts for each of four teams");

    // A wrong password is explained instead of silently loading nothing.
    await facilitator.fill('input[data-host="token"]', "not the password");
    await facilitator.click('button:has-text("Refresh now")');
    await facilitator.locator("[data-host-connection-text]:has-text('Wrong facilitator password')").waitFor({timeout: 20_000});
  });
});

test("A decision made while Google Sheets is unreachable waits, and Send again delivers it", {skip}, async () => {
  await withGame(async game => {
    const {backend} = game;
    const {page} = await captainInRunningGame(game, "Boris T");
    await page.locator(".pv-sticky").waitFor({timeout: 20_000});

    let offline = true;
    await page.route("**/sheets", route => offline ? route.abort("failed") : route.continue());
    await lockFirstCard(page);
    await page.locator('.pv-sync[data-sync-state="retry"]').first().waitFor();
    assert.match(await page.locator(".pv-sync").first().innerText(), /1 decision waiting to be sent/);
    assert.equal(backend.table("Decisions").length, 0);

    offline = false;
    await page.click('.pv-checkpoint .pv-sync button:has-text("Send again")');
    await until(() => backend.table("Decisions").length === 1, "the decision is delivered");
    await page.locator('.pv-sync[data-sync-state="ok"]').first().waitFor();
  });
});

test("A new game removes the players, and their pages ask them to join again", {skip}, async () => {
  await withGame(async ({person, api, backend}) => {
    const player = await person();
    await signUp(player, "Anna K");
    const facilitator = await person();
    await openFacilitator(facilitator);
    await facilitator.click('button:has-text("Start a new game") >> nth=0');
    await facilitator.locator('dialog[open] button:has-text("Start a new game")').click();
    await facilitator.locator("[data-host-players-text]:has-text('No players yet')").waitFor();
    assert.equal(backend.table("Players").length, 0);
    assert.equal(backend.spreadsheet.copies.length, 1, "a copy of the sheet was saved first");
    await player.locator("[data-ui=notice]:has-text('The game was reset')").waitFor({timeout: 15_000});
    assert.equal(await player.locator('form[data-form=signup]').count(), 1);
    assert.equal((await api.get({action: "roster"})).error, "Wrong facilitator password.", "the roster needs the password");
  });
});
