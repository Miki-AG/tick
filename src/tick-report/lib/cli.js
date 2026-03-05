"use strict";

const os = require("os");
const {
  DEFAULT_INTERVAL_MS,
  DEFAULT_PORT,
  ISSUES_DIR_NAME,
  STATUS_FILE_NAME,
} = require("./constants");

function isLikelyTailscaleIpv4(address) {
  const text = String(address || "").trim();
  const parts = text.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function detectDefaultHost() {
  const networkInterfaces = os.networkInterfaces();
  const matches = [];

  for (const [name, addresses] of Object.entries(networkInterfaces)) {
    for (const entry of addresses || []) {
      if (!entry || entry.internal) continue;
      if (entry.family !== "IPv4") continue;
      if (!isLikelyTailscaleIpv4(entry.address)) continue;
      matches.push({
        name,
        address: entry.address,
      });
    }
  }

  matches.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.address.localeCompare(b.address);
  });

  return matches.length > 0 ? matches[0].address : "127.0.0.1";
}

function printHelp() {
  const detectedHost = detectDefaultHost();
  process.stdout.write(`Usage:
  tick-report -h
  tick-report start [--host <ip-or-name>] [--port <number>] [--interval <milliseconds>]
  tick-report stop
  tick-report status
  tick-report serve [--host <ip-or-name>] [--port <number>] [--interval <milliseconds>]

Commands:
  start   Start tick-report in background (daemon mode) and store PID.
  stop    Stop background tick-report from PID file.
  status  Show if tick-report is running in current directory.
  serve   Run HTTP server in foreground (mainly internal/debug).

Behavior:
  - Reads ./${ISSUES_DIR_NAME}/*.md tickets.
  - Reads ./${ISSUES_DIR_NAME}/${STATUS_FILE_NAME} for per-ticket "updates".
  - Supports popup notifications from status.json:
      {
        "popup": { "level": "info|warn|error", "message": "..." },
        "0001": { "updates": "..." }
      }
  - Default bind host: ${detectedHost} (auto-detected from Tailscale, fallback 127.0.0.1).
`);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function failProminent(header, details, code = 1) {
  const lines = [];
  lines.push("");
  lines.push("==============================================================");
  lines.push(`ERROR: ${header}`);
  lines.push("==============================================================");
  for (const line of details) {
    lines.push(line);
  }
  lines.push("==============================================================");
  lines.push("");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(code);
}

function parseServeOptions(argv) {
  const args = {
    host: detectDefaultHost(),
    port: DEFAULT_PORT,
    intervalMs: DEFAULT_INTERVAL_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      const value = argv[i + 1];
      if (value === undefined) fail("Missing value for --port");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        fail(`Invalid --port value: ${value}`);
      }
      args.port = parsed;
      i += 1;
      continue;
    }

    if (arg === "--host") {
      const value = argv[i + 1];
      if (value === undefined) fail("Missing value for --host");
      const parsedHost = String(value).trim();
      if (!parsedHost) fail(`Invalid --host value: ${value}`);
      args.host = parsedHost === "auto" ? detectDefaultHost() : parsedHost;
      i += 1;
      continue;
    }

    if (arg === "--interval") {
      const value = argv[i + 1];
      if (value === undefined) fail("Missing value for --interval");
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 250) {
        fail(`Invalid --interval value: ${value} (min 250ms)`);
      }
      args.intervalMs = parsed;
      i += 1;
      continue;
    }

    fail(`Unknown option: ${arg}`);
  }

  return args;
}

module.exports = {
  printHelp,
  fail,
  failProminent,
  parseServeOptions,
};
