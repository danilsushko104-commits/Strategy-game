import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, inlineModules, MODULES, OUTPUT_HTML, OUTPUT_FRAGMENT } from '../scripts/build.mjs';

const file = path => fileURLToPath(new URL("../" + path, import.meta.url));
const scriptOf = fragment => fragment.slice(fragment.indexOf("<script>") + 8, fragment.lastIndexOf("</script>"));

test("The committed T123 and HTML files are exactly what the build produces from src/", async () => {
  const {html, fragment} = await build();
  assert.equal(await readFile(file(OUTPUT_HTML), "utf8"), html, "run: node scripts/build.mjs");
  assert.equal(await readFile(file(OUTPUT_FRAGMENT), "utf8"), fragment, "run: node scripts/build.mjs");
});

test("The inlined script is valid JavaScript with no module syntax left", async () => {
  const {fragment} = await build();
  const code = scriptOf(fragment);
  assert.doesNotThrow(() => new vm.Script(code), "the bundle must compile");
  assert.doesNotMatch(code, /^\s*(import\s*\{|export\s+(const|function|async|let|class|default|\{))/m);
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
