import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from '../scripts/serve.mjs';

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
    const page = await (await browser.newContext({viewport: {width: 1280, height: 800}})).newPage();
    // Keep every message the banner ever showed: the next redraw clears it, and a failure would vanish.
    await page.addInitScript(() => {
      window.__notices = [];
      const watch = () => {
        const element = document.querySelector('[data-ui="notice"]');
        if (!element) return requestAnimationFrame(watch);
        new MutationObserver(() => { if (element.textContent) window.__notices.push(element.textContent); }).observe(element, {childList: true, characterData: true, subtree: true, attributes: true});
      };
      watch();
    });
    page.on("console", message => { if (["error", "warning"].includes(message.type()) && !/net::ERR_FAILED/.test(message.text())) problems.push(message.text()); });
    page.on("pageerror", error => problems.push(error.message));
    await page.goto(base);
    return page;
  };
  try {
    await run({person, backend: server.backend, base});
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

// The facilitator opens a room whose R1 started `minutesAgo` minutes ago (the field takes Moscow time).
async function openRoom(facilitator, minutesAgo = 5) {
  const moscow = new Date(Date.now() - minutesAgo * 60_000 + 3 * 3_600_000).toISOString().slice(0, 16);
  await facilitator.click("button[data-action=host]");
  await facilitator.fill('input[data-host="token"]', PASSWORD);
  await facilitator.fill('[data-host="start"]', moscow);
  await facilitator.click('button:has-text("Create a new room")');
  return facilitator.locator(".pv-record h3").first().innerText();
}

async function lockFirstCard(page) {
  await page.locator("label.pv-choice:has(input[name=choice]:not([disabled])) .pv-choice-card").first().click();
  await page.fill("textarea[data-draft=evidence]", "evidence");
  await page.fill("textarea[data-draft=tradeoff]", "trade-off");
  await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
  await page.locator('dialog[open] button:has-text("Lock decision")').click();
}

// Waits for a condition; when it never comes, the failure carries what the page and the sheet looked like.
async function until(check, message, timeout = 12_000, diagnose = null) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.fail(message + (diagnose ? " | " + await diagnose().catch(error => "diagnostics failed: " + error.message) : ""));
}

const describe = (page, backend) => async () => JSON.stringify({
  syncLine: (await page.locator(".pv-sync").first().innerText().catch(() => "(none)")).replace(/\n/g, " "),
  noteInPage: await page.locator("textarea[data-note]").first().inputValue().catch(() => "(gone)"),
  storedSync: await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /:sync:/.test(key)).map(([, value]) => value)),
  storedRecord: await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /:team:\d$/.test(key)).map(([, value]) => { const r = JSON.parse(value); return {history: r.history.length, notes: r.notes, session: r.session.slice(0, 8)}; })),
  notice: await page.locator("[data-ui=notice]").innerText().catch(() => ""),
  noticesSeen: await page.evaluate(() => window.__notices).catch(() => []),
  stage: await page.locator("#omf-stage-title").innerText().catch(() => ""),
  decisions: backend.table("Decisions").length,
  notes: backend.table("Notes").map(row => row.field + "=" + row.text)
});

test("A team only picks its table; there is no room code, no file restore and no practice link", {skip}, async () => {
  await withGame(async ({person}) => {
    const team = await person();
    const entry = team.locator(".pv-entry-panel");
    await entry.waitFor();
    assert.equal(await entry.locator('input[data-entry="room"]').count(), 0);
    assert.equal(await entry.locator('button:has-text("Restore JSON")').count(), 0);
    assert.equal(await entry.locator('button:has-text("Practice")').count(), 0);
    assert.equal(await entry.locator('select[data-entry="team"]').count(), 1);
    await team.locator('[data-assigned]:has-text("has not opened a room yet")').waitFor();
    assert.equal(await entry.locator('button[type=submit]').isDisabled(), true);
  });
});

test("The facilitator opens the room, the teams see their market, and decisions and notes reach the sheet", {skip}, async () => {
  await withGame(async ({person, backend}) => {
    const facilitator = await person();
    const room = await openRoom(facilitator);
    assert.deepEqual(backend.table("Settings").map(row => row.room), [room]);

    const team = await person();
    await team.locator('[data-assigned]:has-text("Your market is")').waitFor();
    assert.match(await team.locator("[data-assigned]").innerText(), /Your market is (Indonesia|Philippines|Thailand|Vietnam)\./);
    await team.selectOption('select[data-entry="team"]', "2");
    await team.click('button:has-text("Open team dashboard")');
    await team.locator(".pv-sticky").waitFor();
    assert.equal(await team.locator("button:has-text('Journal TXT'), button:has-text('Save JSON'), button:has-text('Download')").count(), 0, "no local files");

    await lockFirstCard(team);
    await until(() => backend.table("Decisions").length === 1, "the decision reaches the sheet");
    assert.equal(backend.table("Decisions")[0].team, 2);
    assert.equal(backend.table("Decisions")[0].evidence, "evidence");
    await until(() => backend.table("Progress").length === 1, "the Progress row appears");
    assert.match(backend.table("Progress")[0].stage, /^R2 · Evidence \(1 of 7 decided\)$/);

    // A worksheet note follows a few seconds after the writing pauses.
    await team.locator("textarea[data-note]").first().fill("Frequent travellers in Jakarta");
    await until(() => backend.table("Notes").some(row => row.text === "Frequent travellers in Jakarta"), "the note reaches the sheet", 25_000, describe(team, backend));
    await until(() => backend.table("R1").some(row => row.proposition === "Frequent travellers in Jakarta"), "the note shows in the R1 sheet");
    const [r1] = backend.table("R1");
    assert.equal(r1.team, 2);
    assert.equal(r1.status, "locked by the team");
    assert.match(await team.locator(".pv-sync").first().innerText(), /saved with your notes/);
  });
});

test("A team continues on another device: its decisions and notes come back from the sheet", {skip}, async () => {
  await withGame(async ({person, backend}) => {
    const facilitator = await person();
    await openRoom(facilitator);
    const first = await person();
    await first.locator('[data-assigned]:has-text("Your market is")').waitFor();
    await first.click('button:has-text("Open team dashboard")');
    await lockFirstCard(first);
    await first.locator("textarea[data-note]").first().fill("Written on the first device");
    await until(() => backend.table("Notes").some(row => row.text === "Written on the first device"), "the note is in the sheet", 25_000, describe(first, backend));
    const credits = await first.locator(".pv-budget strong").innerText();

    // A fresh browser has nothing stored: everything must come from the sheet.
    const second = await person();
    await second.locator('[data-assigned]:has-text("Your market is")').waitFor();
    await second.click('button:has-text("Open team dashboard")');
    await second.locator(".pv-sticky").waitFor();
    assert.match(await second.locator("[data-ui=notice]").innerText(), /Continued from Google Sheets: 1 of 7 decisions restored/);
    assert.equal(await second.locator(".pv-budget strong").innerText(), credits);
    assert.equal(await second.locator(".pv-sidebar-card").first().locator(".pv-log li").count(), 1);
    assert.equal(await second.locator("textarea[data-note]").first().inputValue(), "Written on the first device");
  });
});

test("The facilitator sees the teams from the sheet: progress, game result and the right password", {skip}, async () => {
  await withGame(async ({person, backend}) => {
    const facilitator = await person();
    // R1 started 200 minutes ago: the seminar is over and the team's rounds are all settled with their defaults.
    await openRoom(facilitator, 200);
    const team = await person();
    await team.locator('[data-assigned]:has-text("Your market is")').waitFor();
    await team.click('button:has-text("Open team dashboard")');
    await team.locator(".pv-game-result").waitFor();
    await until(() => backend.table("Decisions").length === 7, "all seven decisions reach the sheet");
    assert.equal(backend.table("Progress")[0].stage, "Finished");
    assert.equal(Number(backend.table("Progress")[0].game_result), 20, "the plain defaults: 18 for the deferral and 2 for holding outreach");

    await facilitator.click('button[data-action=host]').catch(() => {});
    await facilitator.click('button:has-text("Refresh now")').catch(() => {});
    await facilitator.locator("[data-host-connection-text]:has-text('1 of 4 tables have data')").waitFor({timeout: 20_000});
    await facilitator.locator(".pv-checklist li", {hasText: "Team data from Google Sheets"}).waitFor();
    assert.match(await facilitator.locator(".pv-checklist li", {hasText: "Team data from Google Sheets"}).innerText(), /1 of 4 tables have all 7 decisions\. Missing: table 2, table 3, table 4\./);
    assert.match(await facilitator.locator(".pv-scores tbody").innerText(), /20\.0/);
    assert.equal(await facilitator.locator("button:has-text('Import team JSON')").count(), 0);

    // A wrong password is explained instead of silently loading nothing.
    await facilitator.fill('input[data-host="token"]', "not the password");
    await facilitator.locator("[data-host-connection-text]:has-text('Wrong facilitator password')").waitFor({timeout: 20_000});
  });
});

test("A decision made while Google Sheets is unreachable waits, and Send again delivers it", {skip}, async () => {
  await withGame(async ({person, backend}) => {
    const facilitator = await person();
    await openRoom(facilitator);
    const team = await person();
    await team.locator('[data-assigned]:has-text("Your market is")').waitFor();
    await team.click('button:has-text("Open team dashboard")');
    await team.locator(".pv-sticky").waitFor();

    let offline = true;
    await team.route("**/sheets", route => offline ? route.abort("failed") : route.continue());
    await lockFirstCard(team);
    await team.locator('.pv-sync[data-sync-state="retry"]').first().waitFor();
    assert.match(await team.locator(".pv-sync").first().innerText(), /1 decision waiting to be sent/);
    assert.equal(backend.table("Decisions").length, 0);

    offline = false;
    await team.click('.pv-checkpoint .pv-sync button:has-text("Send again")');
    await until(() => backend.table("Decisions").length === 1, "the decision is delivered");
    await team.locator('.pv-sync[data-sync-state="ok"]').first().waitFor();
  });
});
