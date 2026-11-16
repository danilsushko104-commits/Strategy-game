import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, inlineModules, MODULES, ENGINE_MODULES, INTERFACE_MODULES, OUTPUT_HTML, OUTPUT_BLOCKS } from '../scripts/build.mjs';

const file = path => fileURLToPath(new URL("../" + path, import.meta.url));
const scriptOf = fragment => fragment.slice(fragment.indexOf("<script>") + 8, fragment.lastIndexOf("</script>"));

test("The committed Tilda blocks and the HTML page are exactly what the build produces from src/", async () => {
  const {html, blocks} = await build();
  assert.equal(await readFile(file(OUTPUT_HTML), "utf8"), html, "run: node scripts/build.mjs");
  for (const [key, path] of Object.entries(OUTPUT_BLOCKS)) {
    assert.equal(await readFile(file(path), "utf8"), blocks[key], path + " is stale. Run: node scripts/build.mjs");
  }
});

test("The modules are split into an engine and an interface block, in dependency order", () => {
  assert.deepEqual([...ENGINE_MODULES, ...INTERFACE_MODULES], MODULES);
  assert.equal(INTERFACE_MODULES.at(-1), "app");
});

test("Every Tilda block stays small enough to paste, and the scripts compile with no module syntax left", async () => {
  const {blocks} = await build();
  for (const [key, text] of Object.entries(blocks)) {
    assert.ok(Buffer.byteLength(text) < 80 * 1024, key + " block is " + Math.round(Buffer.byteLength(text) / 1024) + " KB");
    if (key === "css") { assert.doesNotMatch(text, /<script/); continue; }
    const code = text.slice(text.indexOf("<script>") + 8, text.lastIndexOf("</script>"));
    assert.doesNotThrow(() => new vm.Script(code), key + " must compile");
    assert.doesNotMatch(code, /^\s*(import\s*\{|export\s+(const|function|async|let|class|default|\{))/m);
  }
});

function fakeSources(overrides = {}) {
  return Object.fromEntries(MODULES.map(name => [name, overrides[name] ?? ""]));
}

test("Each module gets its own scope, so equal top-level names in different modules cannot collide", () => {
  const code = inlineModules(fakeSources({
    scenario: "export const shared = 1;\nconst helper = 'scenario';\n",
    rules: "import { shared } from './scenario.mjs';\nconst helper = 'rules';\nexport const value = shared + 1;\n"
  }));
  assert.doesNotThrow(() => new vm.Script("(async () => {\n" + code + "\n})();"));
});

test("The build rejects an import of a name the other module does not export", () => {
  assert.throws(() => inlineModules(fakeSources({
    scenario: "export const present = 1;\n",
    rules: "import { absent } from './scenario.mjs';\n"
  })), /does not export/);
});

test("The build rejects imports from a module that comes later and unsupported export forms", () => {
  assert.throws(() => inlineModules(fakeSources({
    scenario: "import { later } from './rules.mjs';\n",
    rules: "export const later = 1;\n"
  })), /unknown or comes later/);
  assert.throws(() => inlineModules(fakeSources({scenario: "const a = 1;\nexport { a };\n"})), /not support/);
  assert.throws(() => inlineModules(fakeSources({scenario: "export default 1;\n"})), /not support/);
  assert.throws(() => inlineModules(fakeSources({
    scenario: "export const a = 1;\n",
    rules: "import { a as b } from './scenario.mjs';\n"
  })), /aliases/);
});

// End-to-end: the generated page, not the ES modules. Needs Playwright; skipped where it is not installed.
let chromium = null;
try { ({chromium} = createRequire(import.meta.url)("playwright")); } catch { /* optional */ }

test("The generated page runs a full practice game in a browser without console errors", {skip: !chromium && "Playwright is not installed"}, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const problems = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type())) problems.push(message.text()); });
    page.on("pageerror", error => problems.push(error.message));
    await page.goto("file://" + file(OUTPUT_HTML));
    await page.click("text=Practice without a room");
    await page.click('button:has-text("Open practice dashboard")');
    for (let round = 0; round < 7; round++) {
      if (/emergency/i.test(await page.locator("#omf-stage-title").innerText())) await page.click('button:has-text("Reveal bulletin B")');
      await page.locator("label.pv-choice:has(input[name=choice]:not([disabled])) .pv-choice-card").first().click();
      await page.fill("textarea[data-draft=evidence]", "evidence");
      await page.fill("textarea[data-draft=tradeoff]", "trade-off");
      await page.locator('button:has-text("Lock this choice"):not([disabled])').click();
      await page.locator("button[data-action=next-practice]").click();
    }
    assert.equal(await page.locator("#omf-stage-title").innerText(), "Board Brief");
    await page.click("button[data-action=home]");
    await page.click("button[data-action=host]");
    await page.click('button:has-text("Create a new room")');
    assert.match(await page.locator(".pv-record h3").first().innerText(), /^OMF-/);
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});

test("Pasting the interface block without the engine block explains what is missing", {skip: !chromium && "Playwright is not installed"}, async () => {
  const {blocks} = await build();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent("<!doctype html><html><body>" + blocks.css + blocks.interface + "</body></html>");
    const notice = page.locator("[data-ui=notice]");
    await notice.waitFor({state: "visible"});
    assert.match(await notice.innerText(), /game engine block is missing/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
