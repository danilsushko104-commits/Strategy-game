import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from '../scripts/serve.mjs';

let chromium = null;
try { ({chromium} = createRequire(import.meta.url)("playwright")); } catch { /* optional */ }

function listen(options) {
  const server = createServer(options);
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({server, base: "http://127.0.0.1:" + server.address().port})));
}
const close = server => new Promise(resolve => server.close(resolve));

test("The local server serves the game page and answers HEAD with a Date header, as the clock sync needs", async () => {
  const {server, base} = await listen();
  try {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const html = await page.text();
    assert.match(html, /One Market First/);
    assert.match(html, /data-sync-url=""/);

    const head = await fetch(base + "/", {method: "HEAD"});
    assert.equal(head.status, 200);
    assert.ok(Number.isFinite(Date.parse(head.headers.get("date"))));
    assert.equal((await fetch(base + "/index.html")).status, 200);
  } finally {
    await close(server);
  }
});

test("Nothing but the game page is served", async () => {
  const {server, base} = await listen();
  try {
    for (const path of ["/src/rules.mjs", "/../package.json", "/%2e%2e/package.json", "/README.md", "/.git/config"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + "/", {method: "POST"})).status, 404);
    assert.equal((await fetch(base + "/favicon.ico")).status, 204);
  } finally {
    await close(server);
  }
});

test("A sheet address is put into the page, and only an https address is accepted", async () => {
  const address = "https://script.google.com/macros/s/TEST/exec";
  const {server, base} = await listen({syncUrl: address});
  try {
    assert.match(await (await fetch(base + "/")).text(), new RegExp('data-sync-url="' + address.replaceAll("/", "\\/") + '"'));
  } finally {
    await close(server);
  }
  assert.throws(() => createServer({syncUrl: "http://insecure.example/exec"}), /https/);
  assert.throws(() => createServer({syncUrl: 'https://x" onload="alert(1)'}), /https/);
});

test("Over http the game synchronizes its clock with the local server", {skip: !chromium && "Playwright is not installed"}, async () => {
  const {server, base} = await listen();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Pretend the device clock is a minute slow: the page must notice and follow the server.
    await page.addInitScript(() => { const real = Date.now.bind(Date); Date.now = () => real() - 60_000; });
    await page.goto(base + "/");
    await page.click("button[data-action=host]");
    const notice = page.locator("[data-ui=notice]");
    await notice.waitFor({state: "visible"});
    assert.match(await notice.innerText(), /clock is 6\d s slow\. The game follows the server time/);
  } finally {
    await browser.close();
    await close(server);
  }
});

test("The local spreadsheet survives a restart of the server and every sheet can be downloaded as CSV", async () => {
  const {mkdtempSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const folder = mkdtempSync(join(tmpdir(), "omf-"));
  const file = join(folder, "sheets.json");
  try {
    const first = await listen({fakeSheets: {password: "a long test password", file}});
    const post = body => fetch(first.base + "/sheets", {method: "POST", body: JSON.stringify({v: 1, ...body})}).then(reply => reply.json());
    assert.equal((await post({type: "join", id: "player-id-000001", name: "Anna K", international: true})).ok, true);
    assert.equal((await post({type: "scores", token: "a long test password", table: [["Rank", "Team"], [1, "Ünï, \"quoted\""]]})).ok, true);
    const csv = await fetch(first.base + "/sheets/export?sheet=Scores");
    assert.match(csv.headers.get("content-disposition"), /Scores\.csv/);
    const bytes = new Uint8Array(await csv.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "a BOM, so that Excel reads UTF-8");
    const text = new TextDecoder().decode(bytes);
    assert.ok(text.startsWith("Rank,Team"));
    assert.match(text, /1,"Ünï, ""quoted"""/);
    const missing = await fetch(first.base + "/sheets/export?sheet=Nope");
    assert.equal(missing.status, 404);
    await missing.text();
    await first.server.flush();
    await close(first.server);

    const second = await listen({fakeSheets: {password: "a long test password", file}});
    const me = await (await fetch(second.base + "/sheets?action=me&id=player-id-000001")).json();
    assert.equal(me.found, true);
    assert.equal(me.name, "Anna K");
    assert.equal(second.server.backend.table("Players")[0].joined_at instanceof Date, true, "dates come back as dates");
    await close(second.server);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
});
