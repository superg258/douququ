#!/usr/bin/env node

import http from "node:http";
import { createRequire } from "node:module";

const requireFromFrontend = createRequire(new URL("../frontend/package.json", import.meta.url));
const { chromium } = requireFromFrontend("playwright");

const HOST = "127.0.0.1";
const PORT = Number(process.env.RMUC_EXPORT_WORKER_PORT || "3010");
const FRONTEND_ORIGIN = process.env.RMUC_EXPORT_FRONTEND_ORIGIN || "http://127.0.0.1:3005";
const BACKEND_ORIGIN = process.env.RMUC_EXPORT_BACKEND_ORIGIN || "http://127.0.0.1:8001";
const TOKEN = process.env.RMUC_EXPORT_WORKER_TOKEN || "";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_ACTIVE = 2;
const MAX_PENDING = 8;
const RENDER_TIMEOUT_MS = 30_000;
const ALLOWED_COMPETITIONS = new Set([
  "south_region",
  "east_region",
  "north_region",
  "repechage",
  "nationals",
]);
const ALLOWED_STAGES = new Set([
  "slots",
  "swiss-a",
  "swiss-b",
  "qualification",
  "playoff",
  "final-rankings",
  "round-of-16",
  "quarterfinal",
  "final-four",
]);

let browserPromise;
let browserInstance;
let shuttingDown = false;
let active = 0;
const queue = [];

function jsonResponse(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": payload.length,
  });
  response.end(payload);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("invalid payload");
  if (!ALLOWED_COMPETITIONS.has(payload.competition)) throw new Error("invalid competition");
  if (!ALLOWED_STAGES.has(payload.stage)) throw new Error("invalid stage");
  if (!["live", "sim"].includes(payload.mode)) throw new Error("invalid mode");
  if (payload.mode === "sim" && (!Number.isSafeInteger(payload.seed) || payload.seed < 1)) {
    throw new Error("invalid seed");
  }
  if (typeof payload.revision !== "string" || !payload.revision.startsWith("sha256:")) {
    throw new Error("invalid revision");
  }
}

async function browser() {
  browserPromise ||= chromium.launch({ headless: true }).then(
    (instance) => {
      browserInstance = instance;
      instance.once("disconnected", () => {
        browserInstance = undefined;
        browserPromise = undefined;
        if (!shuttingDown) {
          process.stderr.write("canvas export Chromium disconnected; exiting for systemd restart\n");
          process.exit(1);
        }
      });
      return instance;
    },
    (error) => {
      browserInstance = undefined;
      browserPromise = undefined;
      throw error;
    },
  );
  const instance = await browserPromise;
  if (!instance.isConnected()) throw new Error("canvas export Chromium is disconnected");
  return instance;
}

async function render(payload) {
  validatePayload(payload);
  const target = new URL("/export/canvas", FRONTEND_ORIGIN);
  for (const key of ["competition", "stage", "mode", "revision"]) {
    target.searchParams.set(key, String(payload[key]));
  }
  if (payload.seed) target.searchParams.set("seed", String(payload.seed));
  if (payload.highlight) target.searchParams.set("highlight", String(payload.highlight));

  const instance = await browser();
  const context = await instance.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      const allowedOrigins = new Set([
        new URL(FRONTEND_ORIGIN).origin,
        new URL(BACKEND_ORIGIN).origin,
      ]);
      if (allowedOrigins.has(requestUrl.origin) || requestUrl.protocol === "data:") {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });
    await page.waitForFunction(() => {
      const root = document.querySelector("#canvas-export-root");
      const status = root?.getAttribute("data-export-status");
      if (status === "error") throw new Error(root?.getAttribute("data-export-error") || "export failed");
      return status === "ready";
    }, undefined, { timeout: RENDER_TIMEOUT_MS });
    const root = page.locator("#canvas-export-root");
    const box = await root.boundingBox();
    if (!box || box.width * box.height > MAX_PIXELS) throw new Error("export exceeds pixel limit");
    return await root.screenshot({ type: "png", animations: "disabled" });
  } finally {
    await context.close();
  }
}

function drain() {
  while (active < MAX_ACTIVE && queue.length > 0) {
    const job = queue.shift();
    active += 1;
    render(job.payload).then(
      (png) => {
        job.response.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": png.length,
          "Cache-Control": "no-store",
        });
        job.response.end(png);
      },
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes("revision conflict") ? 409
          : message.includes("Timeout") || message.includes("timeout") ? 504
            : 500;
        jsonResponse(job.response, status, { detail: message });
      },
    ).finally(() => {
      active -= 1;
      drain();
    });
  }
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health/ready") {
    const ready = Boolean(browserInstance?.isConnected());
    jsonResponse(response, ready ? 200 : 503, {
      ready,
      status: ready ? "ready" : "not-ready",
      browser: ready ? "connected" : "disconnected",
    });
    return;
  }
  if (request.method !== "POST" || request.url !== "/render") {
    jsonResponse(response, 404, { detail: "not found" });
    return;
  }
  if (TOKEN && request.headers["x-export-token"] !== TOKEN) {
    jsonResponse(response, 403, { detail: "forbidden" });
    return;
  }
  if (queue.length >= MAX_PENDING) {
    jsonResponse(response, 429, { detail: "export queue full" });
    return;
  }
  let size = 0;
  const chunks = [];
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      validatePayload(payload);
      queue.push({ payload, response });
      drain();
    } catch (error) {
      jsonResponse(response, 400, {
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

async function start() {
  // Do not expose a healthy TCP listener until Chromium has actually launched.
  await browser();
  server.listen(PORT, HOST, () => {
    process.stdout.write(`canvas export worker listening on http://${HOST}:${PORT}\n`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (server.listening) server.close();
    if (browserInstance?.isConnected()) await browserInstance.close();
    process.exit(0);
  });
}

start().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`canvas export worker startup failed: ${message}\n`);
  process.exit(1);
});
