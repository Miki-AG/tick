"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TICK_REPORT_BIN = path.join(REPO_ROOT, "tick-report");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCommand(cwd, args) {
  const result = spawnSync(TICK_REPORT_BIN, args, {
    cwd,
    encoding: "utf8",
    timeout: 20000,
  });

  if (result.error) {
    throw new Error(`Command failed to execute: ${result.error.message}`);
  }

  return {
    command: `${TICK_REPORT_BIN} ${args.join(" ")}`.trim(),
    exitCode: result.status === null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function printResult(name, result) {
  process.stdout.write(`Scenario: ${name}\n`);
  process.stdout.write(`Command: ${result.command}\n`);
  process.stdout.write(`Exit: ${result.exitCode}\n`);
  process.stdout.write("Stdout:\n");
  process.stdout.write(result.stdout.trim().length ? result.stdout : "<empty>\n");
  process.stdout.write("Stderr:\n");
  process.stdout.write(result.stderr.trim().length ? result.stderr : "<empty>\n");
  process.stdout.write("\n");
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!Number.isFinite(port)) {
          reject(new Error("Unable to determine free port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

function ensureRepoArtifacts() {
  if (!fs.existsSync(TICK_REPORT_BIN)) {
    fail(`Missing root wrapper: ${TICK_REPORT_BIN}`);
  }
  const sourceEntry = path.join(REPO_ROOT, "src", "tick-report", "tick-report");
  if (!fs.existsSync(sourceEntry)) {
    fail(`Missing source entrypoint: ${sourceEntry}`);
  }
}

async function runScenarios() {
  const scenarios = [];
  let failed = 0;
  let passed = 0;

  const helpResult = runCommand(REPO_ROOT, ["-h"]);
  printResult("001-help", helpResult);
  try {
    assert(helpResult.exitCode === 0, "Help command must exit 0.");
    assert(helpResult.stdout.includes("tick-report start"), "Help output missing start command.");
    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`Error: ${err.message}\n\n`);
  }
  scenarios.push("001-help");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tick-report-test-"));

  const statusResult = runCommand(tempRoot, ["status"]);
  printResult("002-status", statusResult);
  try {
    assert(statusResult.exitCode === 0, "Status command must exit 0.");
    assert(
      statusResult.stdout.includes("tick-report status:"),
      "Status output missing expected prefix."
    );
    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`Error: ${err.message}\n\n`);
  }
  scenarios.push("002-status");

  const port = await getFreePort();
  let startResult;
  let runningResult;
  let stopResult;
  let stoppedResult;

  try {
    startResult = runCommand(tempRoot, [
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--interval",
      "500",
    ]);
    printResult("003-start", startResult);
    runningResult = runCommand(tempRoot, ["status"]);
    printResult("004-status-running", runningResult);
    stopResult = runCommand(tempRoot, ["stop"]);
    printResult("005-stop", stopResult);
    stoppedResult = runCommand(tempRoot, ["status"]);
    printResult("006-status-stopped", stoppedResult);

    assert(startResult.exitCode === 0, "start must exit 0.");
    assert(
      startResult.stdout.includes("tick-report launch requested"),
      "start output missing launch confirmation."
    );
    assert(runningResult.exitCode === 0, "running status must exit 0.");
    assert(runningResult.stdout.includes("running"), "status should indicate running.");
    assert(
      runningResult.stdout.includes(`:${port}`),
      "running status should include configured port."
    );
    assert(stopResult.exitCode === 0, "stop must exit 0.");
    assert(stopResult.stdout.includes("Stopped tick-report"), "stop output missing confirmation.");
    assert(stoppedResult.exitCode === 0, "stopped status must exit 0.");
    assert(stoppedResult.stdout.includes("stopped"), "status should indicate stopped.");
    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`Error: ${err.message}\n\n`);
  } finally {
    try {
      runCommand(tempRoot, ["stop"]);
    } catch (err) {
      // no-op cleanup best effort
    }
  }
  scenarios.push("003-start-stop-flow");

  process.stdout.write(`Total scenarios: ${scenarios.length}\n`);
  process.stdout.write(`Total passed: ${passed}\n`);
  process.stdout.write(`Total failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function main() {
  ensureRepoArtifacts();
  await runScenarios();
}

main().catch((err) => {
  fail(err.message);
});
