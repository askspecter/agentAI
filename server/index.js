// Zero-dependency HTTP server: REST API + Server-Sent Events + static UI.
//
// Run:  npm start   (or: node server/index.js)
// Open: http://localhost:3000

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { Flywheel } from "./flywheel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = process.env.PORT || 3000;

// ---- Config: prefer config.json, fall back to the example ----------------
function loadConfig() {
  const local = join(ROOT, "config.json");
  const example = join(ROOT, "config.example.json");
  const path = existsSync(local) ? local : example;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  // Strip comment keys.
  const clean = JSON.parse(JSON.stringify(raw), (k, v) => (k.startsWith("//") ? undefined : v));
  return clean;
}

const config = loadConfig();
const flywheel = new Flywheel(config);

// Heartbeat: advance prices + accrue yield a few times a second.
setInterval(() => flywheel.tick(), 1000);

// Autopilot state (server-driven simulated spending).
let autopilot = null;

// ---- SSE clients ---------------------------------------------------------
const sseClients = new Set();
flywheel.on("update", (snap) => {
  const data = `data: ${JSON.stringify(snap)}\n\n`;
  for (const res of sseClients) res.write(data);
});

// ---- helpers -------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = join(ROOT, "public", rel);
  if (!file.startsWith(join(ROOT, "public"))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// ---- router --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // API ---------------------------------------------------------------
  if (path === "/api/state") return json(res, 200, flywheel.snapshot());

  if (path === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(flywheel.snapshot())}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (path === "/api/spend" && req.method === "POST") {
    await flywheel.simulateSpend();
    return json(res, 200, { ok: true });
  }

  if (path === "/api/repay" && req.method === "POST") {
    const r = await flywheel.runRepayment();
    return json(res, 200, r);
  }

  if (path === "/api/approve" && req.method === "POST") {
    const { id, approve } = await readBody(req);
    const r = await flywheel.resolveApproval(id, approve);
    return json(res, r.ok ? 200 : 404, r);
  }

  if (path === "/api/autopilot" && req.method === "POST") {
    const { on, intervalMs } = await readBody(req);
    if (autopilot) {
      clearInterval(autopilot);
      autopilot = null;
    }
    if (on) {
      const ms = Math.max(800, Number(intervalMs) || 2500);
      autopilot = setInterval(() => flywheel.simulateSpend(), ms);
    }
    return json(res, 200, { ok: true, autopilot: Boolean(autopilot) });
  }

  // Live card webhook seam (real integration entry point).
  if (path === "/api/card/webhook" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const { parseWebhook } = await import("./robinhood/cardFeed.js");
      const txn = parseWebhook(body, config.robinhood.cardWebhookSecret);
      await flywheel.onPurchase(txn);
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message || e) });
    }
  }

  // Static UI ---------------------------------------------------------
  return serveStatic(res, path);
});

server.listen(PORT, () => {
  console.log(`\n  🛞  Spend-to-Invest Flywheel  [${flywheel.snapshot().mode} mode]`);
  console.log(`  →  http://localhost:${PORT}\n`);
});
