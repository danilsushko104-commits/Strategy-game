import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/scenario.mjs';

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

test("A live table mirrors its save into IndexedDB", {skip}, async () => {
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
    await page.locator(".pv-sidebar-card .pv-log li").first().waitFor();

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
