import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';

// A tiny local web server for trying the game in a browser (no dependencies).
//
//   node scripts/serve.mjs                       http://localhost:8080
//   node scripts/serve.mjs --port=3000
//   node scripts/serve.mjs --lan                 also reachable from phones on the same Wi-Fi
//   node scripts/serve.mjs --sync-url=https://script.google.com/macros/s/…/exec
//
// It serves the built page only (run `node scripts/build.mjs` after changing src/). Served over http the
// game can synchronize its clock with this server's Date header, exactly as it does on Tilda.

const PAGE = new URL("../one-market-first.html", import.meta.url);

export function createServer({syncUrl = ""} = {}) {
  if (syncUrl && !/^https:\/\/\S+$/.test(syncUrl)) throw new Error("--sync-url must be an https address.");
  return http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (!["GET", "HEAD"].includes(request.method) || !["/", "/index.html"].includes(path)) {
      response.writeHead(path === "/favicon.ico" ? 204 : 404, {"Content-Type": "text/plain; charset=utf-8"});
      return response.end(path === "/favicon.ico" ? "" : "Not found. Open /\n");
    }
    try {
      let html = await readFile(PAGE, "utf8");
      if (syncUrl) html = html.replace('data-sync-url=""', `data-sync-url="${syncUrl.replaceAll('"', "&quot;")}"`);
      response.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"});
      response.end(request.method === "HEAD" ? undefined : html);
    } catch {
      response.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
      response.end("The built page is missing. Run: node scripts/build.mjs\n");
    }
  });
}

function option(name) {
  const hit = process.argv.slice(2).find(argument => argument === "--" + name || argument.startsWith("--" + name + "="));
  return hit === undefined ? undefined : (hit.split("=")[1] ?? true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(option("port") ?? process.env.PORT ?? 8080);
  const lan = option("lan") === true;
  const syncUrl = String(option("sync-url") ?? process.env.OMF_SYNC_URL ?? "");
  const server = createServer({syncUrl});
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
    if (syncUrl) console.log("Google Sheets address: " + syncUrl);
    console.log("Press Ctrl+C to stop.");
  });
}
