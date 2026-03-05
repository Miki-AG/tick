"use strict";

const fs = require("fs");
const path = require("path");
const { ISSUES_DIR_NAME, STATUS_FILE_NAME } = require("./constants");

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

module.exports = {
  readTickets,
  readTicketById,
};
