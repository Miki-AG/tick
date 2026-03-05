"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  ISSUES_DIR_NAME,
  LOG_FILE,
  PID_FILE,
  STOP_KILL_WAIT_MS,
  STOP_TERM_WAIT_MS,
} = require("./constants");

function getPidPath(rootDir) {
  return path.join(rootDir, ISSUES_DIR_NAME, PID_FILE);
}

function getLogPath(rootDir) {
  return path.join(rootDir, ISSUES_DIR_NAME, LOG_FILE);
}

function ensureIssuesDir(rootDir, fail) {
  const issuesDir = path.join(rootDir, ISSUES_DIR_NAME);
  if (fs.existsSync(issuesDir)) {
    let stat;
    try {
      stat = fs.statSync(issuesDir);
    } catch (err) {
      fail(`Unable to stat ${ISSUES_DIR_NAME}: ${err.message}`);
    }
    if (!stat.isDirectory()) {
      fail(`${ISSUES_DIR_NAME} exists but is not a directory: ${issuesDir}`);
    }
    return;
  }

  try {
    fs.mkdirSync(issuesDir, { recursive: true });
  } catch (err) {
    fail(`Unable to create ${ISSUES_DIR_NAME}: ${err.message}`);
  }
}

function readPidMeta(rootDir) {
  const pidPath = getPidPath(rootDir);
  if (!fs.existsSync(pidPath)) return null;

  const raw = fs.readFileSync(pidPath, "utf8").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.pid)) {
      return parsed;
    }
  } catch (err) {
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid)) return { pid };
  }

  return null;
}

function writePidMeta(rootDir, meta, fail) {
  try {
    fs.writeFileSync(getPidPath(rootDir), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  } catch (err) {
    fail(`Unable to write pid file: ${err.message}`);
  }
}

function clearPidMeta(rootDir) {
  const pidPath = getPidPath(rootDir);
  try {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch (err) {
    process.stderr.write(`Warning: unable to remove pid file ${pidPath}: ${err.message}\n`);
  }
}

function getListeningPidOnPort(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!output) return null;
    const firstLine = output.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (!firstLine) return null;
    const pid = Number.parseInt(firstLine.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch (err) {
    return null;
  }
}

function getProcessCwdFromLsof(pid) {
  try {
    const output = execFileSync("lsof", ["-p", String(pid), "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = output.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i] === "fcwd" && lines[i + 1] && lines[i + 1].startsWith("n")) {
        return lines[i + 1].slice(1);
      }
    }
  } catch (err) {
    return null;
  }
  return null;
}

function processHasOpenPathFromLsof(pid, targetPath) {
  try {
    const output = execFileSync("lsof", ["-p", String(pid), "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split(/\r?\n/).some((line) => line.startsWith("n") && line.slice(1) === targetPath);
  } catch (err) {
    return false;
  }
}

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

function sleepMs(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Intentional short busy wait; used only during process management checks.
  }
}

function waitForProcessExit(pid, timeoutMs) {
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    if (!isProcessRunning(pid)) return true;
    sleepMs(100);
    elapsed += 100;
  }
  return !isProcessRunning(pid);
}

function stopPidWithEscalation(pid, fail) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    fail(`Unable to stop tick-report (pid ${pid}): ${err.message}`);
  }

  if (!waitForProcessExit(pid, STOP_TERM_WAIT_MS)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (err) {
      fail(`Unable to force-stop tick-report (pid ${pid}) after SIGTERM: ${err.message}`);
    }

    if (!waitForProcessExit(pid, STOP_KILL_WAIT_MS)) {
      fail(`tick-report process ${pid} is still running after SIGKILL.`);
    }
  }
}

function findOrphanedLocalDaemon(rootDir, port) {
  const pid = getListeningPidOnPort(port);
  if (!Number.isFinite(pid)) return null;
  const cwd = getProcessCwdFromLsof(pid);
  if (cwd !== rootDir) return null;
  const expectedLogPath = getLogPath(rootDir);
  if (!processHasOpenPathFromLsof(pid, expectedLogPath)) return null;
  return pid;
}

function clearPidMetaIfSelf(rootDir) {
  const meta = readPidMeta(rootDir);
  if (!meta || !Number.isFinite(meta.pid)) return;
  if (meta.pid === process.pid) clearPidMeta(rootDir);
}

module.exports = {
  getPidPath,
  getLogPath,
  ensureIssuesDir,
  readPidMeta,
  writePidMeta,
  clearPidMeta,
  getListeningPidOnPort,
  getProcessCwdFromLsof,
  isProcessRunning,
  sleepMs,
  stopPidWithEscalation,
  findOrphanedLocalDaemon,
  clearPidMetaIfSelf,
};
