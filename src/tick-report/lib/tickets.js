"use strict";

const fs = require("fs");
const path = require("path");
const { CONFIG_FILE_NAME, ISSUES_DIR_NAME, STATUS_FILE_NAME } = require("./constants");

const COLUMN_KEYS = ["id", "title", "status", "priority", "owner", "labels", "updated", "updates"];

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) return null;
  const inside = trimmed.slice(1, -1).trim();
  if (inside.length === 0) return [];
  return inside
    .split(",")
    .map((item) => unquote(item).trim())
    .filter((item) => item.length > 0);
}

function parseFrontMatterAndBody(content) {
  const raw = String(content || "");
  const lines = raw.split(/\r?\n/);
  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") {
      firstNonEmpty = i;
      break;
    }
  }
  if (firstNonEmpty === -1 || lines[firstNonEmpty].trim() !== "---") {
    return { frontMatter: {}, body: raw };
  }

  let end = -1;
  for (let i = firstNonEmpty + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return { frontMatter: {}, body: raw };

  const fmLines = lines.slice(firstNonEmpty + 1, end);
  const data = {};

  for (let i = 0; i < fmLines.length; i += 1) {
    const line = fmLines[i];
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const rawValue = match[2];

    if (key === "labels") {
      const inline = parseInlineList(rawValue);
      if (inline !== null) {
        data.labels = inline;
        continue;
      }

      if (rawValue.trim() === "") {
        const collected = [];
        let j = i + 1;
        while (j < fmLines.length) {
          const itemMatch = fmLines[j].match(/^\s*-\s*(.+)\s*$/);
          if (!itemMatch) break;
          const item = unquote(itemMatch[1]).trim();
          if (item.length > 0) collected.push(item);
          j += 1;
        }
        data.labels = collected;
        i = j - 1;
        continue;
      }
    }

    data[key] = unquote(rawValue);
  }

  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  return { frontMatter: data, body };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeLevel(value) {
  const level = String(value || "").toLowerCase();
  if (level === "warn" || level === "error") return level;
  return "info";
}

function readStatusData(issuesDir) {
  const statusPath = path.join(issuesDir, STATUS_FILE_NAME);
  if (!fs.existsSync(statusPath)) {
    return { updatesById: {}, popup: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (err) {
    return {
      updatesById: {},
      popup: {
        level: "error",
        message: `Invalid JSON in ${ISSUES_DIR_NAME}/${STATUS_FILE_NAME}: ${err.message}`,
      },
    };
  }

  if (!isObject(parsed)) {
    return {
      updatesById: {},
      popup: {
        level: "error",
        message: `${ISSUES_DIR_NAME}/${STATUS_FILE_NAME} must be a JSON object.`,
      },
    };
  }

  let popup = null;
  const popupRaw = isObject(parsed.popup)
    ? parsed.popup
    : isObject(parsed.notice)
      ? parsed.notice
      : null;

  if (popupRaw && String(popupRaw.message || "").trim().length > 0) {
    popup = {
      level: normalizeLevel(popupRaw.level),
      message: String(popupRaw.message).trim(),
    };
  }

  const updatesById = {};
  const ticketContainer = isObject(parsed.tickets) ? parsed.tickets : parsed;
  const reserved = new Set(["popup", "notice", "tickets"]);

  for (const [ticketId, value] of Object.entries(ticketContainer)) {
    if (reserved.has(ticketId)) continue;
    if (typeof value === "string") {
      updatesById[ticketId] = value;
      continue;
    }
    if (isObject(value) && typeof value.updates === "string") {
      updatesById[ticketId] = value.updates;
    }
  }

  return { updatesById, popup };
}

function buildDefaultDesktopColumns() {
  return {
    id: true,
    title: true,
    status: true,
    priority: true,
    owner: true,
    labels: true,
    updated: true,
    updates: true,
  };
}

function buildDefaultMobileColumns() {
  return {
    id: true,
    title: true,
    status: true,
    priority: false,
    owner: false,
    labels: false,
    updated: false,
    updates: false,
  };
}

function buildDefaultColumnConfig() {
  return {
    desktop: buildDefaultDesktopColumns(),
    mobile: buildDefaultMobileColumns(),
  };
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
}

function normalizeColumns(rawColumns, defaults) {
  const source = isObject(rawColumns) ? rawColumns : {};
  const normalized = { ...(defaults || buildDefaultDesktopColumns()) };
  for (const key of COLUMN_KEYS) {
    normalized[key] = normalizeBoolean(source[key], defaults[key]);
  }
  return normalized;
}

function normalizeConfig(rawConfig) {
  const source = isObject(rawConfig) ? rawConfig : {};
  const columnsSource = isObject(source.columns) ? source.columns : source;

  let desktopSource = null;
  let mobileSource = null;

  if (isObject(columnsSource.desktop) || isObject(columnsSource.mobile)) {
    desktopSource = isObject(columnsSource.desktop) ? columnsSource.desktop : null;
    mobileSource = isObject(columnsSource.mobile) ? columnsSource.mobile : null;
  } else if (isObject(source.desktop) || isObject(source.mobile)) {
    desktopSource = isObject(source.desktop) ? source.desktop : null;
    mobileSource = isObject(source.mobile) ? source.mobile : null;
  } else if (isObject(columnsSource)) {
    desktopSource = columnsSource;
    mobileSource = columnsSource;
  }

  return {
    columns: {
      desktop: normalizeColumns(desktopSource, buildDefaultDesktopColumns()),
      mobile: normalizeColumns(mobileSource, buildDefaultMobileColumns()),
    },
  };
}

function parseRequestedColumns(input) {
  const source = isObject(input) ? input : {};
  const columnsSource = isObject(source.columns) ? source.columns : source;

  if (isObject(columnsSource.desktop) || isObject(columnsSource.mobile)) {
    return {
      desktop: isObject(columnsSource.desktop) ? columnsSource.desktop : null,
      mobile: isObject(columnsSource.mobile) ? columnsSource.mobile : null,
    };
  }

  if (isObject(source.desktop) || isObject(source.mobile)) {
    return {
      desktop: isObject(source.desktop) ? source.desktop : null,
      mobile: isObject(source.mobile) ? source.mobile : null,
    };
  }

  if (isObject(columnsSource)) {
    return {
      desktop: columnsSource,
      mobile: columnsSource,
    };
  }

  return {
    desktop: null,
    mobile: null,
  };
}

function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function getIssuesDir(rootDir) {
  return path.join(rootDir, ISSUES_DIR_NAME);
}

function listIssueFiles(issuesDir) {
  const entries = fs.readdirSync(issuesDir);
  return entries.filter((name) => /^[0-9]{4}-.*\.md$/.test(name)).sort();
}

function toLabelsText(labelsValue) {
  if (Array.isArray(labelsValue)) return labelsValue.join(", ");
  return String(labelsValue || "").trim();
}

function toTicketIdNumber(ticket) {
  const fileNum = Number.parseInt(String(ticket.fileId || ""), 10);
  if (Number.isFinite(fileNum)) return fileNum;
  const idNum = Number.parseInt(String(ticket.id || ""), 10);
  if (Number.isFinite(idNum)) return idNum;
  return Number.MAX_SAFE_INTEGER;
}

function getFileMtimeIso(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch (err) {
    return "";
  }
}

function buildTicketRecord(fileName, filePath, content, updatesById, includeBody = false) {
  const { frontMatter, body } = parseFrontMatterAndBody(content);
  const idFromFile = fileName.slice(0, 4);
  const id = String(frontMatter.id || idFromFile);
  const updatedAt = getFileMtimeIso(filePath);

  let updated = String(frontMatter.updated || "").trim();
  if (!updated) {
    updated = updatedAt ? updatedAt.slice(0, 10) : "";
  }

  const ticket = {
    id,
    fileId: idFromFile,
    fileName,
    title: String(frontMatter.title || ""),
    status: String(frontMatter.status || ""),
    priority: String(frontMatter.priority || ""),
    owner: String(frontMatter.owner || ""),
    labels: toLabelsText(frontMatter.labels),
    updated,
    updatedAt,
    updates: String(updatesById[id] || updatesById[idFromFile] || ""),
    _idNum: Number.parseInt(idFromFile, 10),
  };

  if (includeBody) {
    ticket.body = body;
    ticket.rawContent = content;
    ticket.frontMatter = frontMatter;
  }

  return ticket;
}

function normalizeTicketLookupId(value) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) return null;
  const numeric = Number.parseInt(text, 10);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return String(numeric).padStart(4, "0");
}

function readTickets(rootDir) {
  const issuesDir = getIssuesDir(rootDir);
  if (!fs.existsSync(issuesDir) || !fs.statSync(issuesDir).isDirectory()) {
    return {
      tickEnabled: false,
      issuesDir,
      tickets: [],
      popup: null,
    };
  }

  const { updatesById, popup } = readStatusData(issuesDir);
  const issueFiles = listIssueFiles(issuesDir);

  const tickets = [];
  for (const fileName of issueFiles) {
    const filePath = path.join(issuesDir, fileName);
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      continue;
    }

    tickets.push(buildTicketRecord(fileName, filePath, content, updatesById, false));
  }

  tickets.sort((a, b) => {
    const aNum = toTicketIdNumber(a);
    const bNum = toTicketIdNumber(b);
    if (aNum !== bNum) return aNum - bNum;
    return a.id.localeCompare(b.id);
  });

  for (const ticket of tickets) {
    delete ticket._idNum;
  }

  return {
    tickEnabled: true,
    issuesDir,
    tickets,
    popup,
  };
}

function readTicketById(rootDir, ticketId) {
  const issuesDir = getIssuesDir(rootDir);
  if (!fs.existsSync(issuesDir) || !fs.statSync(issuesDir).isDirectory()) {
    return {
      tickEnabled: false,
      issuesDir,
      ticket: null,
      popup: null,
      invalidId: false,
    };
  }

  const normalizedId = normalizeTicketLookupId(ticketId);
  if (!normalizedId) {
    return {
      tickEnabled: true,
      issuesDir,
      ticket: null,
      popup: null,
      invalidId: true,
    };
  }

  const { updatesById, popup } = readStatusData(issuesDir);
  const issueFiles = listIssueFiles(issuesDir);
  const fileName = issueFiles.find((name) => name.startsWith(`${normalizedId}-`));
  if (!fileName) {
    return {
      tickEnabled: true,
      issuesDir,
      ticket: null,
      popup,
      invalidId: false,
    };
  }

  const filePath = path.join(issuesDir, fileName);
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      tickEnabled: true,
      issuesDir,
      ticket: null,
      popup: {
        level: "error",
        message: `Unable to read ${ISSUES_DIR_NAME}/${fileName}: ${err.message}`,
      },
      invalidId: false,
    };
  }

  const ticket = buildTicketRecord(fileName, filePath, content, updatesById, true);
  delete ticket._idNum;

  return {
    tickEnabled: true,
    issuesDir,
    ticket,
    popup,
    invalidId: false,
  };
}

function readProjectConfig(rootDir) {
  const issuesDir = getIssuesDir(rootDir);
  if (!fs.existsSync(issuesDir) || !fs.statSync(issuesDir).isDirectory()) {
    return {
      tickEnabled: false,
      issuesDir,
      configPath: path.join(issuesDir, CONFIG_FILE_NAME),
      config: {
        columns: buildDefaultColumnConfig(),
      },
      error: `tick is not initialized in project ${rootDir} (${ISSUES_DIR_NAME} missing).`,
    };
  }

  const configPath = path.join(issuesDir, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    return {
      tickEnabled: true,
      issuesDir,
      configPath,
      config: {
        columns: buildDefaultColumnConfig(),
      },
      error: null,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      tickEnabled: true,
      issuesDir,
      configPath,
      config: normalizeConfig(parsed),
      error: null,
    };
  } catch (err) {
    return {
      tickEnabled: true,
      issuesDir,
      configPath,
      config: {
        columns: buildDefaultColumnConfig(),
      },
      error: `Invalid JSON in ${ISSUES_DIR_NAME}/${CONFIG_FILE_NAME}: ${err.message}`,
    };
  }
}

function updateProjectConfig(rootDir, input) {
  const issuesDir = getIssuesDir(rootDir);
  if (!fs.existsSync(issuesDir) || !fs.statSync(issuesDir).isDirectory()) {
    return {
      ok: false,
      code: 400,
      tickEnabled: false,
      issuesDir,
      config: {
        columns: buildDefaultColumnConfig(),
      },
      error: `tick is not initialized in project ${rootDir} (${ISSUES_DIR_NAME} missing).`,
    };
  }

  const configPath = path.join(issuesDir, CONFIG_FILE_NAME);
  let existing = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      existing = {};
    }
  }

  const normalizedExisting = normalizeConfig(existing);
  const requested = parseRequestedColumns(input);
  const nextDesktop = requested.desktop
    ? normalizeColumns({
        ...normalizedExisting.columns.desktop,
        ...requested.desktop,
      }, buildDefaultDesktopColumns())
    : normalizedExisting.columns.desktop;
  const nextMobile = requested.mobile
    ? normalizeColumns({
        ...normalizedExisting.columns.mobile,
        ...requested.mobile,
      }, buildDefaultMobileColumns())
    : normalizedExisting.columns.mobile;

  const nextRaw = isObject(existing) ? { ...existing } : {};
  nextRaw.columns = {
    desktop: nextDesktop,
    mobile: nextMobile,
  };

  try {
    writeJsonAtomic(configPath, nextRaw);
  } catch (err) {
    return {
      ok: false,
      code: 500,
      tickEnabled: true,
      issuesDir,
      config: {
        columns: {
          desktop: nextDesktop,
          mobile: nextMobile,
        },
      },
      error: `Unable to write ${ISSUES_DIR_NAME}/${CONFIG_FILE_NAME}: ${err.message}`,
    };
  }

  return {
    ok: true,
    code: 200,
    tickEnabled: true,
    issuesDir,
    configPath,
    config: {
      columns: {
        desktop: nextDesktop,
        mobile: nextMobile,
      },
    },
    error: null,
  };
}

module.exports = {
  readProjectConfig,
  updateProjectConfig,
  readTickets,
  readTicketById,
};
