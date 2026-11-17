import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createBackend } from './fake-google.mjs';

// A tiny local web server for trying the game in a browser (no dependencies).
//
//   node scripts/serve.mjs                       http://localhost:8080 with a local stand-in for Google Sheets
//                                                 (it runs the real Code.gs); view the sheets at /sheets/view,
//                                                 facilitator password: facilitator1 (or --password=…)
//   node scripts/serve.mjs --port=3000
//   node scripts/serve.mjs --lan                 also reachable from phones on the same Wi-Fi
//   node scripts/serve.mjs --sync-url=https://script.google.com/macros/s/…/exec     use your real Google Sheet instead
//   node scripts/serve.mjs --no-sheets           practice only, no Google Sheets at all
//
// It serves the built page only (run `node scripts/build.mjs` after changing src/). Served over http the
// game can synchronize its clock with this server's Date header, exactly as it does on Tilda.

const PAGE = new URL("../one-market-first.html", import.meta.url);

const SHEET_ORDER = ["Overview", "Team 1", "Team 2", "Team 3", "Team 4", "Scores", "Players", "Settings", "Decisions", "Notes"];
const html = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function sheetsView(backend) {
  backend.script.ensureSheets();
  // Every sheet as it is laid out: row by row, cell by cell, with the column letters of Google Sheets.
  const letter = index => String.fromCharCode(65 + index);
  const section = name => {
    const sheet = backend.spreadsheet.getSheetByName(name);
    const rows = Array.from(sheet?.rows ?? [], row => row ?? []);
    const width = Math.max(0, ...rows.map(row => row.length));
    const cellText = value => value instanceof Date ? value.toISOString().replace("T", " ").slice(0, 19) : value;
    const used = rows.map((row, index) => [index + 1, row]).filter(([, row]) => row.some(value => value !== ""));
    return `<h2>${name} <small>${used.length} row(s)</small></h2>` + (used.length ?
      `<table><thead><tr><th></th>${Array.from({length: width}, (_, index) => `<th>${letter(index)}</th>`).join("")}</tr></thead><tbody>${used.map(([number, row]) =>
        `<tr><th>${number}</th>` + Array.from({length: width}, (_, index) => `<td>${html(cellText(row[index] ?? ""))}</td>`).join("") + "</tr>").join("")}</tbody></table>` : "<p>No data yet.</p>");
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Local Google Sheets stand-in</title>
<style>body{font:14px/1.4 Arial,sans-serif;margin:20px;background:#f5efe3;color:#1b1829}h1{margin:0 0 4px}h2{margin:24px 0 6px}small{color:#5e5669;font-weight:400}
table{border-collapse:collapse;background:#fffaf0}th,td{border:1px solid #c8c0b4;padding:4px 8px;text-align:left;vertical-align:top;max-width:340px;overflow-wrap:anywhere}th{background:#dcd8ff}</style></head>
<body><h1>Local Google Sheets stand-in</h1><p>The real Code.gs runs on an in-memory spreadsheet. This page refreshes every 5 seconds. Data is lost when the server stops.</p>
${SHEET_ORDER.map(section).join("")}</body></html>`;
}

export function createServer({syncUrl = "", fakeSheets = null} = {}) {
  if (syncUrl && !/^(https:\/\/\S+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S*)$/.test(syncUrl)) throw new Error("--sync-url must be an https address.");
  const backend = fakeSheets ? createBackend({token: fakeSheets.password}) : null;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    if (backend && path === "/sheets/view") {
      response.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"});
      return response.end(sheetsView(backend));
    }
    if (backend && path === "/sheets") {
      const body = request.method === "POST" ? await new Promise(resolve => { let data = ""; request.on("data", chunk => { data += chunk; }); request.on("end", () => resolve(data)); }) : "";
      const answer = backend.handle(request.method, request.url, body);
      response.writeHead(answer.status, answer.headers);
      return response.end(request.method === "HEAD" || answer.status === 204 ? undefined : answer.body);
    }
    if (!["GET", "HEAD"].includes(request.method) || !["/", "/index.html"].includes(path)) {
      response.writeHead(path === "/favicon.ico" ? 204 : 404, {"Content-Type": "text/plain; charset=utf-8"});
      return response.end(path === "/favicon.ico" ? "" : "Not found. Open /\n");
    }
    try {
      let page = await readFile(PAGE, "utf8");
      const address = backend ? "http://" + (request.headers.host || "localhost") + "/sheets" : syncUrl;
      if (address) page = page.replace('data-sync-url=""', `data-sync-url="${address.replaceAll('"', "&quot;")}"`);
      response.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"});
      response.end(request.method === "HEAD" ? undefined : page);
    } catch {
      response.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
      response.end("The built page is missing. Run: node scripts/build.mjs\n");
    }
  });
  server.backend = backend;
  return server;
}

function option(name) {
  const hit = process.argv.slice(2).find(argument => argument === "--" + name || argument.startsWith("--" + name + "="));
  return hit === undefined ? undefined : (hit.split("=")[1] ?? true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(option("port") ?? process.env.PORT ?? 8080);
  const lan = option("lan") === true;
  const syncUrl = String(option("sync-url") ?? process.env.OMF_SYNC_URL ?? "");
  const fake = option("no-sheets") !== true && !syncUrl;
  const password = String(option("password") ?? "facilitator1");
  const server = createServer({syncUrl, fakeSheets: fake ? {password} : null});
  server.on("error", error => {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is busy. Try: node scripts/serve.mjs --port=${port + 1}` : error.message);
    process.exit(1);
  });
  server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`One Market First is running:\n  http://localhost:${port}/`);
    if (lan) {
      for (const list of Object.values(networkInterfaces())) {
        for (const item of list ?? []) if (item.family === "IPv4" && !item.internal) console.log(`  http://${item.address}:${port}/   (same Wi-Fi)`);
      }
    }
    if (syncUrl && !fake) console.log("Google Sheets address: " + syncUrl);
    if (fake) {
      console.log(`\nLocal Google Sheets stand-in (data is lost when you stop the server):
  view the sheets       http://localhost:${port}/sheets/view
  facilitator password  ${password}

Try the whole game alone:
  1. Open http://localhost:${port}/ , press "Join your team", enter a name.
  2. Open http://localhost:${port}/ in a private window → "Facilitator" → enter the password → "Refresh now".
  3. "Add demo players (test)" → "Form teams" → on the first page press "I'm ready"
  4. Choose "right now" and press "Start the game". Your first page opens the game (or press "Play on this device instead").`);
    }
    console.log("Press Ctrl+C to stop.");
  });
}
