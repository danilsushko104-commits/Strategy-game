import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/scenario.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Browser tests of the generated page. They need Playwright and are skipped where it is not installed.
let chromium = null;
try { ({chromium} = createRequire(import.meta.url)("playwright")); } catch { /* optional */ }
const skip = !chromium && "Playwright is not installed";
const pageUrl = "file://" + fileURLToPath(new URL("../one-market-first.html", import.meta.url));

async function withPage(run, url = pageUrl, allowed = []) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: true});
    const page = await context.newPage();
    const problems = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type()) && !allowed.some(pattern => pattern.test(message.text()))) problems.push(message.text()); });
    page.on("pageerror", error => problems.push(error.message));
    await page.goto(url);
    await run(page);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
}

// A live room asks before a decision is locked early; `confirm` answers that question.
async function lockCurrentRound(page, {confirm = false} = {}) {
  if (/emergency/i.test(await page.locator("#omf-stage-title").innerText())) await page.click('button:has-text("Reveal bulletin B")');
  await page.locator("label.pv-choice:has(input[name=choice]:not([disabled])) .pv-choice-card").first().click();
  await page.fill("textarea[data-draft=evidence]", "evidence");
  await page.fill("textarea[data-draft=tradeoff]", "trade-off");
  await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
  if (confirm) await page.locator('dialog[open] button:has-text("Lock decision")').click();
}

test("A damaged save opens a recovery screen after a reload and the newest readable copy restores the game", {skip}, async () => {
  await withPage(async page => {
    await page.click("text=Practice without a room");
    await page.click('button:has-text("Open practice dashboard")');
    for (let round = 0; round < 3; round++) {
      await lockCurrentRound(page);
      await page.locator("button[data-action=next-practice]").click();
    }
    // Corrupt the main record the way a half-finished write or a manual edit would.
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find(name => /:team:1$/.test(name));
      localStorage.setItem(key, '{"game": "revolut-one-m');
    });
    await page.reload();
    assert.match(await page.locator("#omf-stage-title").innerText(), /could not be opened/);
    // The IndexedDB copy holds the latest state (3 decisions); the ring offers the two earlier ones.
    const offered = await page.locator(".pv-recovery li").allInnerTexts();
    assert.match(offered[0], /browser copy.*through R3/);
    assert.ok(offered.some(text => /snapshot bak1.*through R2/.test(text)), offered.join("|"));
    await page.locator('button:has-text("Restore this copy")').first().click();
    await page.locator(".pv-log li").first().waitFor();
    assert.equal(await page.locator(".pv-sidebar-card").first().locator(".pv-log li").count(), 3);
  });
});

test("A live table mirrors its save into IndexedDB and tracks the downloaded backup", {skip}, async () => {
  await withPage(async page => {
    // The facilitator opens a room whose R1 started five minutes ago (the field takes Moscow time).
    const moscow = new Date(Date.now() - 5 * 60_000 + 3 * 3_600_000).toISOString().slice(0, 16);
    await page.click("button[data-action=host]");
    await page.fill('[data-host="start"]', moscow);
    await page.click('button:has-text("Create a new room")');
    const room = await page.locator(".pv-record h3").first().innerText();
    await page.click("button[data-action=home]");
    await page.fill('input[data-entry="room"]', room);
    await page.click('button:has-text("Open team dashboard")');
    await lockCurrentRound(page, {confirm: true});
    await page.locator(".pv-checkpoint .pv-backup").waitFor();
    assert.match(await page.locator(".pv-checkpoint .pv-backup").innerText(), /No backup file yet/);
    assert.equal(await page.locator(".pv-checkpoint .pv-backup").getAttribute("data-backup-state"), "warn");

    const mirrored = await page.evaluate(name => new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        try {
          const get = open.result.transaction("kv").objectStore("kv").getAll();
          get.onsuccess = () => resolve(get.result.map(value => JSON.parse(value).history.length));
          get.onerror = () => reject(get.error);
        } catch (error) { reject(error); }
      };
    }), CONFIG.game + ":" + CONFIG.version);
    assert.ok(mirrored.includes(1), "the IndexedDB copy holds the locked decision: " + mirrored);

    const [download] = await Promise.all([page.waitForEvent("download"), page.click('.pv-checkpoint button:has-text("Download backup JSON")')]);
    assert.match(download.suggestedFilename(), /^revolut-omf-.*-table-1-.*-save\.json$/);
    assert.match(await page.locator(".pv-checkpoint .pv-backup").innerText(), /The backup is current \(after R1/);
    assert.equal(await page.locator(".pv-checkpoint .pv-backup").getAttribute("data-backup-state"), "ok");
  });
});

const SHEET = "https://script.google.com/macros/s/TEST/exec";

// The built page with a sheet address filled in, the way the facilitator edits the Tilda block.
function pageWithSheet() {
  const copy = join(mkdtempSync(join(tmpdir(), "omf-")), "game.html");
  const html = readFileSync(fileURLToPath(new URL("../one-market-first.html", import.meta.url)), "utf8");
  assert.ok(html.includes('data-sync-url=""'));
  writeFileSync(copy, html.replace('data-sync-url=""', 'data-sync-url="' + SHEET + '"'));
  return "file://" + copy;
}

async function openLiveTable(page) {
  const moscow = new Date(Date.now() - 5 * 60_000 + 3 * 3_600_000).toISOString().slice(0, 16);
  await page.click("button[data-action=host]");
  await page.fill('[data-host="start"]', moscow);
  await page.click('button:has-text("Create a new room")');
  const room = await page.locator(".pv-record h3").first().innerText();
  await page.click("button[data-action=home]");
  await page.fill('input[data-entry="room"]', room);
  await page.click('button:has-text("Open team dashboard")');
  return room;
}

test("Locked decisions reach the sheet, survive an outage and are sent again on request", {skip}, async () => {
  const received = [];
  let online = false;
  await withPage(async page => {
    await page.route(SHEET, async route => {
      if (!online) return route.abort("failed");
      const payload = JSON.parse(route.request().postData());
      received.push(...payload.events);
      await route.fulfill({
        status: 200, contentType: "application/json", headers: {"access-control-allow-origin": "*"},
        body: JSON.stringify({ok: true, saved: payload.events.map(event => event.id), duplicates: []})
      });
    });
    const room = await openLiveTable(page);
    await page.locator(".pv-sync").first().waitFor();

    // 1) Offline: the decision locks locally and waits.
    await lockCurrentRound(page, {confirm: true});
    await page.locator('.pv-checkpoint .pv-sync[data-sync-state="retry"]').waitFor();
    assert.match(await page.locator(".pv-checkpoint .pv-sync").innerText(), /1 decision is waiting to be sent/);
    assert.equal(received.length, 0);

    // 2) Back online: "Send again" delivers it.
    online = true;
    await page.click('.pv-checkpoint .pv-sync button:has-text("Send again")');
    await page.locator('.pv-checkpoint .pv-sync[data-sync-state="ok"]').waitFor();
    assert.match(await page.locator(".pv-checkpoint .pv-sync").innerText(), /all 1 decision is saved/);
    assert.equal(received.length, 1);
    assert.equal(received[0].room, room);
    assert.equal(received[0].team, 1);
    assert.equal(received[0].round, "R1");
    assert.equal(received[0].evidence, "evidence");
    assert.match(received[0].id, new RegExp("^" + room + ":1:0:"));
  }, pageWithSheet(), [/net::ERR_FAILED/]); // the outage is simulated by aborting the request
});

test("After the session the team sees its game result, and the facilitator panel shows it from the imported file", {skip}, async () => {
  await withPage(async page => {
    // R1 started 200 minutes ago: the whole seminar is over, so every round was settled with its default.
    const moscow = new Date(Date.now() - 200 * 60_000 + 3 * 3_600_000).toISOString().slice(0, 16);
    await page.click("button[data-action=host]");
    await page.fill('[data-host="start"]', moscow);
    await page.click('button:has-text("Create a new room")');
    const room = await page.locator(".pv-record h3").first().innerText();
    await page.click("button[data-action=home]");
    await page.fill('input[data-entry="room"]', room);
    await page.click('button:has-text("Open team dashboard")');
    await page.locator(".pv-record", {hasText: "Game result"}).waitFor();
    assert.match(await page.locator(".pv-record", {hasText: "Game result"}).innerText(), /10 \/ 100/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.click('button:has-text("Download team JSON")')]);
    const file = join(mkdtempSync(join(tmpdir(), "omf-team-")), "team.json");
    await download.saveAs(file);

    await page.click("button[data-action=home]");
    await page.click("button[data-action=host]");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('button:has-text("Import team JSON")')]);
    await chooser.setFiles(file);
    // The table is on the page before the file has been read, so wait for the import to finish.
    await page.locator("[data-ui=notice]", {hasText: "Imported table"}).waitFor();
    const table = page.locator(".pv-scores");
    assert.match(await table.innerText(), /Game/);
    assert.match(await table.locator("tbody").innerText(), /10\.0/);
    assert.match(await page.locator(".pv-panel", {hasText: "Board ranking"}).innerText(), /35% game result/);
    // The checklist follows the import.
    const files = page.locator(".pv-checklist li", {hasText: "Team files collected"});
    assert.match(await files.innerText(), /1 of 4 tables imported with all 7 decisions/);
    assert.equal(await page.locator('.pv-checklist li[data-state="now"]').getAttribute("data-state"), "now");
    assert.match(await page.locator(".pv-checklist li[data-state=now]").innerText(), /Team files collected/);
  });
});

test("The facilitator checklist guides from the empty room and remembers the tick", {skip}, async () => {
  await withPage(async page => {
    await page.click("button[data-action=host]");
    await page.click('button:has-text("Create a new room")');
    const now = page.locator(".pv-checklist li[data-state=now]");
    assert.match(await now.innerText(), /Every table has joined/);
    assert.match(await page.locator(".pv-next").innerText(), /Ask every team to open the page/);
    assert.match(await page.locator("[data-host-progress]").innerText(), /R1 opens at \d\d:\d\d Moscow time, in \d+:\d\d/);

    await page.check('input[data-host="joined"]');
    assert.match(await page.locator(".pv-checklist li[data-state=now]").innerText(), /The game is played/);
    assert.match(await page.locator(".pv-next").innerText(), /Wait for R1/);

    await page.reload();
    await page.click("button[data-action=host]");
    assert.equal(await page.locator('input[data-host="joined"]').isChecked(), true, "the tick survives a reload");
    assert.match(await page.locator(".pv-checklist li[data-state=now]").innerText(), /The game is played/);
    await page.uncheck('input[data-host="joined"]');
    assert.match(await page.locator(".pv-checklist li[data-state=now]").innerText(), /Every table has joined/);
  });
});
