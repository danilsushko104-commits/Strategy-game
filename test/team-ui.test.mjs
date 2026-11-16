import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let chromium = null;
try { ({chromium} = createRequire(import.meta.url)("playwright")); } catch { /* optional */ }
const skip = !chromium && "Playwright is not installed";
const pageUrl = "file://" + fileURLToPath(new URL("../one-market-first.html", import.meta.url));

async function withPage(run) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 700}});
    const problems = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type())) problems.push(message.text()); });
    page.on("pageerror", error => problems.push(error.message));
    await page.goto(pageUrl);
    await run(page);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
}

async function openPractice(page, market = "indonesia") {
  await page.click("text=Practice without a room");
  await page.selectOption("select[data-entry=market]", market);
  await page.click('button:has-text("Open practice dashboard")');
}

// Pick the card whose title contains `title`, fill the two notes and lock (practice has no confirmation).
async function lockCard(page, title, {before} = {}) {
  await page.locator("label.pv-choice", {hasText: title}).locator(".pv-choice-card").click();
  if (before) await before();
  await page.fill("textarea[data-draft=evidence]", "evidence");
  await page.fill("textarea[data-draft=tradeoff]", "trade-off");
  await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
  await page.locator("button[data-action=next-practice]").waitFor();
}
const next = page => page.click("button[data-action=next-practice]");

test("The bar with table, stage, progress and credits stays on screen while the page scrolls", {skip}, async () => {
  await withPage(async page => {
    await openPractice(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const bar = page.locator(".pv-sticky");
    const box = await bar.boundingBox();
    assert.ok(box.y >= -1 && box.y < 12, "the bar is at the top of the window: " + box.y);
    const text = await bar.innerText();
    assert.match(text, /Indonesia/);
    assert.match(text, /R1 · Customer/i);
    assert.match(text, /Credits/i);
    assert.equal(await bar.locator(".pv-progress li").count(), 7);
  });
});

test("Choosing a paid card previews the spend in the bar; locking applies it", {skip}, async () => {
  await withPage(async page => {
    await openPractice(page);
    await lockCard(page, "Freelancers");
    await next(page);
    const preview = page.locator("[data-credits-preview]");
    assert.equal(await preview.isHidden(), true);
    await page.locator("label.pv-choice", {hasText: "interview"}).locator(".pv-choice-card").click();
    await preview.waitFor({state: "visible"});
    assert.equal(await preview.innerText(), "9 → 7");
    await page.locator("label.pv-choice", {hasText: "Keep the base dossier"}).locator(".pv-choice-card").click();
    await preview.waitFor({state: "hidden"});
    await lockCard(page, "interview");
    assert.equal(await page.locator(".pv-budget strong").innerText(), "7");
  });
});

test("The board-confidence meter shows what is earned and what is still possible, then the final result", {skip}, async () => {
  await withPage(async page => {
    await openPractice(page);
    const text = () => page.locator(".pv-meter-text").innerText();
    assert.match(await text(), /^0 earned · up to \d+$/);
    const ceiling = Number((await text()).match(/up to (\d+)/)[1]);
    assert.ok(ceiling > 60);
    await lockCard(page, "Freelancers"); await next(page);
    await lockCard(page, "mock journey"); await next(page);
    const later = Number((await text()).match(/up to (\d+)/)[1]);
    assert.ok(later <= ceiling, "the ceiling never rises: " + later + " vs " + ceiling);
    assert.match(await text(), /^6 earned/, "the prototype is worth 6 points");
  });
});

test("Correcting one channel asks which problem; naming the right one proves it, another one misses", {skip}, async () => {
  const toEmergency = async page => {
    await openPractice(page, "indonesia");
    for (const title of ["Travellers", "Keep the base dossier", "Pilot with local provider", "Verify readiness", "Narrow and test"]) { await lockCard(page, title); await next(page); }
    await page.click('button:has-text("Reveal bulletin B")');
  };
  await withPage(async page => {
    await toEmergency(page);
    const field = page.locator("[data-problem]");
    assert.equal(await field.isHidden(), true, "no question until the one-channel correction is chosen");
    await page.locator("label.pv-choice", {hasText: "Correct one channel"}).locator(".pv-choice-card").click();
    await field.waitFor({state: "visible"});
    await page.fill("textarea[data-draft=evidence]", "evidence");
    await page.fill("textarea[data-draft=tradeoff]", "trade-off");
    assert.equal(await page.locator('button:has-text("Lock this choice")').isDisabled(), true, "a problem must be named first");
    const options = await field.locator("option").allInnerTexts();
    assert.equal(options.length, 6);
    assert.match(options[3], /^Coverage/);
    await field.locator("select").selectOption("coverage");
    await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
    await page.locator("button[data-action=next-practice]").waitFor();
    assert.match(await page.locator(".pv-record").first().innerText(), /Four of five mock users/);
  });
  await withPage(async page => {
    await toEmergency(page);
    await page.locator("label.pv-choice", {hasText: "Correct one channel"}).locator(".pv-choice-card").click();
    await page.fill("textarea[data-draft=evidence]", "evidence");
    await page.fill("textarea[data-draft=tradeoff]", "trade-off");
    await page.locator("[data-problem] select").selectOption("fees");
    await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
    await page.locator("button[data-action=next-practice]").waitFor();
    assert.match(await page.locator(".pv-record").first().innerText(), /confused about something else/);
  });
});

test("A live room shows the stage timer in the bar and asks before an early lock", {skip}, async () => {
  await withPage(async page => {
    const moscow = new Date(Date.now() - 5 * 60_000 + 3 * 3_600_000).toISOString().slice(0, 16);
    await page.click("button[data-action=host]");
    await page.fill('[data-host="start"]', moscow);
    await page.click('button:has-text("Create a new room")');
    const room = await page.locator(".pv-record h3").first().innerText();
    await page.click("button[data-action=home]");
    await page.fill('input[data-entry="room"]', room);
    await page.click('button:has-text("Open team dashboard")');

    const clock = page.locator(".pv-sticky [data-clock]");
    await clock.waitFor({state: "visible"});
    assert.match(await clock.innerText(), /Time left\s*\d{2}:\d{2}/);
    assert.match(await page.locator(".pv-sticky [data-stage-name]").innerText(), /R1 · Customer/i);

    await page.locator("label.pv-choice:has(input:not([disabled])) .pv-choice-card").first().click();
    await page.fill("textarea[data-draft=evidence]", "evidence");
    await page.fill("textarea[data-draft=tradeoff]", "trade-off");
    await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /final: you cannot change it afterwards/);
    assert.match(await dialog.innerText(), /\d{2}:\d{2} is still left in this stage/);
    await dialog.locator('button[value="cancel"]').click();
    const journal = page.locator(".pv-sidebar-card").first().locator(".pv-log li");
    assert.equal(await journal.count(), 0, "cancelling locks nothing");
    assert.equal(await page.locator('button:has-text("Lock this choice")').isVisible(), true);

    await page.locator('button:has-text("Lock this choice")').click();
    await page.locator('dialog[open] button:has-text("Lock decision")').click();
    await journal.first().waitFor();
    assert.equal(await journal.count(), 1);
  });
});
