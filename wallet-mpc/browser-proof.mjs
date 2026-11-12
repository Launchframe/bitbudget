import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";

assert.equal(process.versions.node.split(".")[0], "22", "run browser-proof.mjs with Node 22");
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const routes = new Map([
  ["/pkg/wallet_mpc.js", "text/javascript"],
  ["/pkg/wallet_mpc_bg.wasm", "application/wasm"],
  ["/wasm-protocol.mjs", "text/javascript"],
  ["/browser-case.mjs", "text/javascript"],
]);
for (const path of routes.keys()) await readFile(new URL(`.${path}`, import.meta.url));
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  response.setHeader("Cache-Control", "no-store");
  if (path === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><meta charset="utf-8"><title>Wallet WASM proof</title><script type="module" src="/browser-case.mjs"></script>');
    return;
  }
  if (!routes.has(path)) { response.writeHead(404).end(); return; }
  try {
    response.setHeader("Content-Type", routes.get(path));
    response.end(await readFile(new URL(`.${path}`, import.meta.url)));
  } catch { response.writeHead(500).end(); }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.WALLET_PLAYWRIGHT_CHROMIUM, args: ["--disable-background-networking", "--disable-component-update"] });
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "load", timeout: 30000 });
  const result = await page.evaluate(async () => {
    if (!window.walletProof) throw new Error("browser WASM proof was not initialized");
    return Promise.race([
      window.walletProof,
      new Promise((_, reject) => setTimeout(() => reject(new Error("browser proof timed out")), 60000)),
    ]);
  });
  assert.equal(result.result, "passed");
  assert.equal(result.cases.length, 6);
  assert.ok(result.webcrypto_calls > 0);
  console.log(JSON.stringify({ ...result, browser: browser.version(), playwright: require("@playwright/test/package.json").version }));
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
