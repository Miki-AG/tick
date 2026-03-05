"use strict";

const fs = require("fs");
const { spawn } = require("child_process");
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  LOG_FILE,
  STARTUP_STABILITY_MS,
} = require("./constants");
const {
  clearPidMeta,
  ensureIssuesDir,
  findOrphanedLocalDaemon,
  getListeningPidOnPort,
  getLogPath,
  getProcessCwdFromLsof,
  isProcessRunning,
  readPidMeta,
  sleepMs,
  stopPidWithEscalation,
  writePidMeta,
} = require("./process-control");

function startDaemon(options, entryScriptPath, fail, failProminent) {
  const rootDir = process.cwd();
  ensureIssuesDir(rootDir, fail);
  const current = readPidMeta(rootDir);
  const orphanPid = findOrphanedLocalDaemon(rootDir, options.port);

  if (Number.isFinite(orphanPid) && isProcessRunning(orphanPid)) {
    writePidMeta(
      rootDir,
      {
        pid: orphanPid,
        host: options.host,
        port: options.port,
        intervalMs: options.intervalMs,
        startedAt: new Date().toISOString(),
        logFile: LOG_FILE,
        recovered: true,
      },
      fail
    );
    process.stdout.write(
      `tick-report already running (recovered orphan pid ${orphanPid}) in ${rootDir}\n`
    );
    return;
  }

  if (current && Number.isFinite(current.pid) && isProcessRunning(current.pid)) {
    process.stdout.write(`tick-report already running (pid ${current.pid}) in ${rootDir}\n`);
    return;
  }

  if (current) {
    clearPidMeta(rootDir);
  }

  const occupiedPid = getListeningPidOnPort(options.port);
  if (Number.isFinite(occupiedPid) && isProcessRunning(occupiedPid)) {
    const occupiedCwd = getProcessCwdFromLsof(occupiedPid) || "unknown";
    if (occupiedCwd === rootDir) {
      failProminent("ANOTHER tick-report INSTANCE IS ALREADY RUNNING", [
        `Port: ${options.port}`,
        `PID: ${occupiedPid}`,
        `Directory: ${occupiedCwd}`,
        "",
        "Action:",
        "  Run `tick-report stop` in this directory, then run `tick-report start` again.",
      ]);
    }
    failProminent("ANOTHER tick-report INSTANCE IS ALREADY RUNNING", [
      `Port: ${options.port}`,
      `PID: ${occupiedPid}`,
      `Directory: ${occupiedCwd}`,
      "",
      "Action:",
      "  1) Stop it from that directory, or",
      `  2) Start here with a different port: tick-report start --port ${options.port + 1}`,
    ]);
  }

  const logPath = getLogPath(rootDir);
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
      cwd: rootDir,
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

  writePidMeta(
    rootDir,
    {
      pid: child.pid,
      host: options.host,
      port: options.port,
      intervalMs: options.intervalMs,
      startedAt: new Date().toISOString(),
      logFile: LOG_FILE,
    },
    fail
  );

  let elapsed = 0;
  while (elapsed < STARTUP_STABILITY_MS) {
    sleepMs(100);
    elapsed += 100;
    if (!isProcessRunning(child.pid)) {
      clearPidMeta(rootDir);
      fail(`tick-report failed to start. Check log: ${logPath}`);
    }
  }

  process.stdout.write(`tick-report launch requested (pid ${child.pid})\n`);
  process.stdout.write(`URL: http://${options.host}:${options.port}\n`);
  process.stdout.write(`Log: ${logPath}\n`);
  process.stdout.write("Run `tick-report status` to confirm it is running.\n");
}

function stopDaemon(fail) {
  const rootDir = process.cwd();
  const meta = readPidMeta(rootDir);
  if (!meta || !Number.isFinite(meta.pid)) {
    const orphanPid = findOrphanedLocalDaemon(rootDir, DEFAULT_PORT);
    if (Number.isFinite(orphanPid) && isProcessRunning(orphanPid)) {
      stopPidWithEscalation(orphanPid, fail);
      process.stdout.write(`Stopped tick-report (orphan pid ${orphanPid}, recovered without pid file).\n`);
      return;
    }
    process.stdout.write("tick-report is not running (no pid file).\n");
    return;
  }

  if (!isProcessRunning(meta.pid)) {
    clearPidMeta(rootDir);
    process.stdout.write(`Removed stale pid file (pid ${meta.pid} not running).\n`);
    return;
  }

  stopPidWithEscalation(meta.pid, fail);
  clearPidMeta(rootDir);
  process.stdout.write(`Stopped tick-report (pid ${meta.pid}).\n`);
}

function showStatus() {
  const rootDir = process.cwd();
  const meta = readPidMeta(rootDir);

  if (!meta || !Number.isFinite(meta.pid)) {
    const orphanPid = findOrphanedLocalDaemon(rootDir, DEFAULT_PORT);
    if (Number.isFinite(orphanPid) && isProcessRunning(orphanPid)) {
      process.stdout.write(
        `tick-report status: running (orphan pid ${orphanPid}) http://${DEFAULT_HOST}:${DEFAULT_PORT}\n`
      );
      process.stdout.write("Hint: run `tick-report stop` once to recover and stop it.\n");
      return;
    }

    const occupiedPid = getListeningPidOnPort(DEFAULT_PORT);
    if (Number.isFinite(occupiedPid) && isProcessRunning(occupiedPid)) {
      const occupiedCwd = getProcessCwdFromLsof(occupiedPid) || "unknown";
      process.stdout.write(
        `tick-report status: stopped in this directory (port ${DEFAULT_PORT} is used by pid ${occupiedPid}, cwd: ${occupiedCwd})\n`
      );
      return;
    }

    process.stdout.write("tick-report status: stopped\n");
    return;
  }

  if (!isProcessRunning(meta.pid)) {
    clearPidMeta(rootDir);
    process.stdout.write("tick-report status: stopped (stale pid removed)\n");
    return;
  }

  const port = Number.isFinite(meta.port) ? meta.port : DEFAULT_PORT;
  const host = typeof meta.host === "string" && meta.host.trim() ? meta.host.trim() : DEFAULT_HOST;
  process.stdout.write(`tick-report status: running (pid ${meta.pid}) http://${host}:${port}\n`);
}

module.exports = {
  startDaemon,
  stopDaemon,
  showStatus,
};
