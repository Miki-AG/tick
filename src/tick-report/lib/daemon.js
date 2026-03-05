"use strict";

const fs = require("fs");
const { spawn } = require("child_process");
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  STARTUP_STABILITY_MS,
} = require("./constants");
const {
  ensureIssuesDir,
  getListeningPidOnPort,
  getProcessCwdFromLsof,
  isProcessRunning,
  sleepMs,
  stopPidWithEscalation,
} = require("./process-control");
const {
  attachProject,
  canonicalizeRepoPath,
  clearDaemonMeta,
  ensureGlobalStateDir,
  getGlobalLogPath,
  listProjects,
  readDaemonMeta,
  writeDaemonMeta,
} = require("./global-state");

function startDaemon(options, entryScriptPath, fail, failProminent) {
  const currentRepoDir = process.cwd();
  ensureIssuesDir(currentRepoDir, fail);

  let canonicalRepoPath;
  try {
    canonicalRepoPath = canonicalizeRepoPath(currentRepoDir);
  } catch (err) {
    fail(`Unable to resolve repository path: ${err.message}`);
  }

  const current = readDaemonMeta();
  if (current && Number.isFinite(current.pid) && isProcessRunning(current.pid)) {
    const attach = attachProject(canonicalRepoPath);
    const currentHost =
      typeof current.host === "string" && current.host.trim() ? current.host.trim() : DEFAULT_HOST;
    const currentPort = Number.isFinite(current.port) ? current.port : DEFAULT_PORT;

    process.stdout.write(
      `tick-report already running (pid ${current.pid}). Reused existing instance.\n`
    );
    process.stdout.write(
      `Attached project: ${attach.project.path} (${attach.project.id})${attach.added ? "" : " [already attached]"}\n`
    );
    process.stdout.write(`URL: http://${currentHost}:${currentPort}\n`);
    return;
  }

  if (current) {
    clearDaemonMeta();
  }

  const occupiedPid = getListeningPidOnPort(options.port);
  if (Number.isFinite(occupiedPid) && isProcessRunning(occupiedPid)) {
    const occupiedCwd = getProcessCwdFromLsof(occupiedPid) || "unknown";
    failProminent("ANOTHER PROCESS IS ALREADY LISTENING ON THE REQUESTED PORT", [
      `Port: ${options.port}`,
      `PID: ${occupiedPid}`,
      `Directory: ${occupiedCwd}`,
      "",
      "Action:",
      `  1) Stop that process, or`,
      `  2) Start tick-report on another port: tick-report start --port ${options.port + 1}`,
    ]);
  }

  const globalStateDir = ensureGlobalStateDir();
  const logPath = getGlobalLogPath();

  let outFd;
  try {
    outFd = fs.openSync(logPath, "a");
  } catch (err) {
    fail(`Unable to open log file ${logPath}: ${err.message}`);
  }

  const child = spawn(
    process.execPath,
    [
      entryScriptPath,
      "serve",
      "--port",
      String(options.port),
      "--host",
      String(options.host),
      "--interval",
      String(options.intervalMs),
    ],
    {
      cwd: globalStateDir,
      detached: true,
      stdio: ["ignore", outFd, outFd],
    }
  );
  child.unref();

  try {
    fs.closeSync(outFd);
  } catch (err) {
    process.stderr.write(`Warning: unable to close log fd for ${logPath}: ${err.message}\n`);
  }

  writeDaemonMeta({
    pid: child.pid,
    host: options.host,
    port: options.port,
    intervalMs: options.intervalMs,
    startedAt: new Date().toISOString(),
  });

  let elapsed = 0;
  while (elapsed < STARTUP_STABILITY_MS) {
    sleepMs(100);
    elapsed += 100;
    if (!isProcessRunning(child.pid)) {
      clearDaemonMeta();
      fail(`tick-report failed to start. Check log: ${logPath}`);
    }
  }

  let attach;
  try {
    attach = attachProject(canonicalRepoPath);
  } catch (err) {
    try {
      stopPidWithEscalation(child.pid, fail);
    } catch (stopErr) {
      // no-op: fail message below is the primary signal
    }
    clearDaemonMeta();
    fail(`tick-report started but failed to attach project: ${err.message}`);
  }

  process.stdout.write(`tick-report launch requested (pid ${child.pid})\n`);
  process.stdout.write(`URL: http://${options.host}:${options.port}\n`);
  process.stdout.write(`Log: ${logPath}\n`);
  process.stdout.write(`Attached project: ${attach.project.path} (${attach.project.id})\n`);
  process.stdout.write("Run `tick-report status` to confirm it is running.\n");
}

function stopDaemon(fail) {
  const current = readDaemonMeta();
  if (!current || !Number.isFinite(current.pid)) {
    process.stdout.write("tick-report is not running.\n");
    return;
  }

  if (!isProcessRunning(current.pid)) {
    clearDaemonMeta();
    process.stdout.write(`Removed stale daemon metadata (pid ${current.pid} not running).\n`);
    return;
  }

  stopPidWithEscalation(current.pid, fail);
  clearDaemonMeta();
  process.stdout.write(`Stopped tick-report (pid ${current.pid}).\n`);
}

function showStatus() {
  const current = readDaemonMeta();
  const projects = listProjects();

  let currentRepoPath = null;
  try {
    currentRepoPath = canonicalizeRepoPath(process.cwd());
  } catch (err) {
    currentRepoPath = null;
  }

  if (!current || !Number.isFinite(current.pid)) {
    process.stdout.write(`tick-report status: stopped (attached projects: ${projects.length})\n`);
    return;
  }

  if (!isProcessRunning(current.pid)) {
    clearDaemonMeta();
    process.stdout.write(
      `tick-report status: stopped (stale daemon metadata removed, attached projects: ${projects.length})\n`
    );
    return;
  }

  const host = typeof current.host === "string" && current.host.trim() ? current.host.trim() : DEFAULT_HOST;
  const port = Number.isFinite(current.port) ? current.port : DEFAULT_PORT;
  const attachedToCurrentRepo =
    currentRepoPath && projects.some((project) => project.path === currentRepoPath);

  if (currentRepoPath) {
    process.stdout.write(
      `tick-report status: running (pid ${current.pid}) http://${host}:${port} | attached projects: ${projects.length} | current repo: ${attachedToCurrentRepo ? "attached" : "detached"}\n`
    );
    return;
  }

  process.stdout.write(
    `tick-report status: running (pid ${current.pid}) http://${host}:${port} | attached projects: ${projects.length}\n`
  );
}

module.exports = {
  startDaemon,
  stopDaemon,
  showStatus,
};
