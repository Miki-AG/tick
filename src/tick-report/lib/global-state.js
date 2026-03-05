"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  GLOBAL_DAEMON_FILE,
  GLOBAL_LOG_FILE,
  GLOBAL_PROJECTS_FILE,
  GLOBAL_STATE_DIR_NAME,
  GLOBAL_STATE_ENV,
  ISSUES_DIR_NAME,
} = require("./constants");

function getGlobalStateDir() {
  const overrideDir = String(process.env[GLOBAL_STATE_ENV] || "").trim();
  if (overrideDir.length > 0) {
    return path.resolve(overrideDir);
  }
  return path.join(os.homedir(), GLOBAL_STATE_DIR_NAME);
}

function ensureGlobalStateDir() {
  const dir = getGlobalStateDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDaemonMetaPath() {
  return path.join(getGlobalStateDir(), GLOBAL_DAEMON_FILE);
}

function getProjectsPath() {
  return path.join(getGlobalStateDir(), GLOBAL_PROJECTS_FILE);
}

function getGlobalLogPath() {
  return path.join(getGlobalStateDir(), GLOBAL_LOG_FILE);
}

function readJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallbackValue;
  }
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readDaemonMeta() {
  const parsed = readJsonFile(getDaemonMetaPath(), null);
  if (!parsed || !Number.isFinite(parsed.pid)) return null;
  return parsed;
}

function writeDaemonMeta(meta) {
  writeJsonAtomic(getDaemonMetaPath(), meta);
}

function clearDaemonMeta() {
  const daemonPath = getDaemonMetaPath();
  if (!fs.existsSync(daemonPath)) return;
  try {
    fs.unlinkSync(daemonPath);
  } catch (err) {
    // no-op
  }
}

function clearDaemonMetaIfSelf() {
  const meta = readDaemonMeta();
  if (!meta || !Number.isFinite(meta.pid)) return;
  if (meta.pid === process.pid) {
    clearDaemonMeta();
  }
}

function canonicalizeRepoPath(repoPath) {
  const resolved = path.resolve(String(repoPath || "").trim() || ".");
  return fs.realpathSync(resolved);
}

function normalizeProjectEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const projectPath = String(entry.path || "").trim();
  if (!id || !projectPath) return null;

  let exists = false;
  let available = false;
  try {
    const stat = fs.statSync(projectPath);
    exists = true;
    available = stat.isDirectory();
  } catch (err) {
    exists = false;
    available = false;
  }

  const issuesDir = path.join(projectPath, ISSUES_DIR_NAME);
  let tickEnabled = false;
  if (available) {
    try {
      tickEnabled = fs.existsSync(issuesDir) && fs.statSync(issuesDir).isDirectory();
    } catch (err) {
      tickEnabled = false;
    }
  }

  return {
    id,
    path: projectPath,
    attachedAt: String(entry.attachedAt || "").trim(),
    lastAttachedAt: String(entry.lastAttachedAt || "").trim(),
    available,
    exists,
    tickEnabled,
    name: path.basename(projectPath) || projectPath,
  };
}

function normalizeProjectsData(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { projects: [] };
  }

  const source = Array.isArray(parsed.projects) ? parsed.projects : [];
  const normalized = [];
  const usedIds = new Set();
  const usedPaths = new Set();

  for (const item of source) {
    const project = normalizeProjectEntry(item);
    if (!project) continue;
    if (usedIds.has(project.id)) continue;
    if (usedPaths.has(project.path)) continue;
    usedIds.add(project.id);
    usedPaths.add(project.path);
    normalized.push(project);
  }

  normalized.sort((a, b) => {
    const aTime = Date.parse(a.lastAttachedAt || a.attachedAt || "") || 0;
    const bTime = Date.parse(b.lastAttachedAt || b.attachedAt || "") || 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.path.localeCompare(b.path);
  });

  return { projects: normalized };
}

function readProjectsData() {
  const parsed = readJsonFile(getProjectsPath(), { projects: [] });
  return normalizeProjectsData(parsed);
}

function writeProjectsData(data) {
  writeJsonAtomic(getProjectsPath(), {
    projects: (data.projects || []).map((project) => ({
      id: project.id,
      path: project.path,
      attachedAt: project.attachedAt,
      lastAttachedAt: project.lastAttachedAt,
    })),
  });
}

function buildProjectId(projectPath, salt = "") {
  const digest = crypto
    .createHash("sha1")
    .update(`${projectPath}|${salt}`)
    .digest("hex");
  return digest.slice(0, 12);
}

function attachProject(repoPath) {
  const canonicalPath = canonicalizeRepoPath(repoPath);
  const now = new Date().toISOString();
  const data = readProjectsData();
  const existing = data.projects.find((project) => project.path === canonicalPath);

  if (existing) {
    existing.lastAttachedAt = now;
    writeProjectsData(data);
    return {
      project: normalizeProjectEntry(existing),
      added: false,
    };
  }

  const usedIds = new Set(data.projects.map((project) => project.id));
  let id = buildProjectId(canonicalPath);
  let salt = 1;
  while (usedIds.has(id)) {
    id = buildProjectId(canonicalPath, String(salt));
    salt += 1;
  }

  const entry = {
    id,
    path: canonicalPath,
    attachedAt: now,
    lastAttachedAt: now,
  };
  data.projects.push(entry);
  writeProjectsData(data);

  return {
    project: normalizeProjectEntry(entry),
    added: true,
  };
}

function detachProjectById(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return { removed: false, project: null };

  const data = readProjectsData();
  const index = data.projects.findIndex((project) => project.id === id);
  if (index === -1) return { removed: false, project: null };

  const [removed] = data.projects.splice(index, 1);
  writeProjectsData(data);
  return {
    removed: true,
    project: normalizeProjectEntry(removed),
  };
}

function listProjects() {
  const data = readProjectsData();
  return data.projects.map((project) => normalizeProjectEntry(project)).filter(Boolean);
}

function getProjectById(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return null;
  return listProjects().find((project) => project.id === id) || null;
}

module.exports = {
  attachProject,
  canonicalizeRepoPath,
  clearDaemonMeta,
  clearDaemonMetaIfSelf,
  detachProjectById,
  ensureGlobalStateDir,
  getDaemonMetaPath,
  getGlobalLogPath,
  getGlobalStateDir,
  getProjectById,
  getProjectsPath,
  listProjects,
  readDaemonMeta,
  readProjectsData,
  writeDaemonMeta,
};
