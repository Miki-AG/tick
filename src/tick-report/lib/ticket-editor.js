"use strict";

const fs = require("fs");
const path = require("path");
const { ISSUES_DIR_NAME, STATUS_FILE_NAME } = require("./constants");
const { readTicketById } = require("./tickets");

const VALID_STATUSES = new Set(["open", "doing", "blocked", "done", "wontfix"]);
const VALID_PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeNewline(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseUpdateLines(value) {
  return normalizeNewline(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readUpdatesValue(value) {
  if (typeof value === "string") return value;
  if (isObject(value) && typeof value.updates === "string") return value.updates;
  return "";
}

function mergeCumulativeUpdates(existingValue, incomingValue) {
  const existingLines = parseUpdateLines(readUpdatesValue(existingValue));
  const incomingLines = parseUpdateLines(incomingValue);

  if (incomingLines.length === 0) {
    return existingLines.join("\n");
  }

  const incomingStartsWithExisting =
    incomingLines.length >= existingLines.length &&
    existingLines.every((line, index) => line === incomingLines[index]);

  if (incomingStartsWithExisting) {
    const appended = incomingLines.slice(existingLines.length);
    return [...existingLines, ...appended].join("\n");
  }

  return [...existingLines, ...incomingLines].join("\n");
}

function parseLabelsInput(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
  }
  const raw = String(value || "");
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniquePreservingOrder(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatYamlScalar(value) {
  const text = String(value || "");
  if (text.length === 0) return "";
  if (/^[A-Za-z0-9._/@:+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function formatLabelsInline(labels) {
  if (!labels || labels.length === 0) return "[]";
  const rendered = labels.map((label) => formatYamlScalar(label));
  return `[${rendered.join(", ")}]`;
}

function serializeFrontMatter(frontMatter) {
  const orderedKeys = ["id", "title", "status", "priority", "owner", "labels", "created", "updated"];
  const known = new Set(orderedKeys);
  const lines = [];

  for (const key of orderedKeys) {
    if (!Object.prototype.hasOwnProperty.call(frontMatter, key)) continue;
    if (key === "labels") {
      lines.push(`labels: ${formatLabelsInline(frontMatter.labels || [])}`);
      continue;
    }
    lines.push(`${key}: ${formatYamlScalar(frontMatter[key])}`);
  }

  for (const [key, value] of Object.entries(frontMatter)) {
    if (known.has(key)) continue;
    lines.push(`${key}: ${formatYamlScalar(value)}`);
  }

  return lines.join("\n");
}

function writeFileAtomic(targetPath, newContent) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmpPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`);

  let mode;
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) {
      mode = stat.mode & 0o777;
    }
  } catch (err) {
    // target may not exist
  }

  try {
    fs.writeFileSync(tmpPath, newContent, {
      encoding: "utf8",
      flag: "wx",
      mode: mode,
    });
    fs.renameSync(tmpPath, targetPath);
    if (mode !== undefined) {
      fs.chmodSync(targetPath, mode);
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (cleanupErr) {
      // ignore cleanup errors
    }
    throw new Error(`Unable to write file: ${err.message}`);
  }
}

function prepareStatusJsonWithUpdates(statusPath, ticket, updatesValue) {
  let parsed = {};
  if (fs.existsSync(statusPath)) {
    try {
      parsed = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    } catch (err) {
      throw new Error(
        `Invalid JSON in ${ISSUES_DIR_NAME}/${STATUS_FILE_NAME}: ${err.message}`
      );
    }
    if (!isObject(parsed)) {
      throw new Error(`${ISSUES_DIR_NAME}/${STATUS_FILE_NAME} must be a JSON object.`);
    }
  }

  const container = isObject(parsed.tickets) ? parsed.tickets : parsed;
  const reserved = new Set(["popup", "notice", "tickets"]);
  const candidateKeys = [String(ticket.id || ""), String(ticket.fileId || "")].filter(Boolean);

  let targetKey = String(ticket.fileId || "");
  for (const key of candidateKeys) {
    if (reserved.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(container, key)) {
      targetKey = key;
      break;
    }
  }

  const mergedUpdates = mergeCumulativeUpdates(container[targetKey], updatesValue);
  if (mergedUpdates.length === 0) {
    delete container[targetKey];
  } else {
    const currentValue = container[targetKey];
    if (isObject(currentValue)) {
      container[targetKey] = {
        ...currentValue,
        updates: mergedUpdates,
      };
    } else if (typeof currentValue === "string") {
      container[targetKey] = mergedUpdates;
    } else {
      container[targetKey] = {
        updates: mergedUpdates,
      };
    }
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function updateTicketById(rootDir, ticketId, payload) {
  if (!isObject(payload)) {
    return {
      ok: false,
      code: 400,
      error: "Request body must be a JSON object.",
    };
  }

  const lookup = readTicketById(rootDir, ticketId);
  if (lookup.invalidId) {
    return {
      ok: false,
      code: 400,
      error: "Invalid ticket id.",
    };
  }
  if (!lookup.tickEnabled) {
    return {
      ok: false,
      code: 404,
      error: "tick is not initialized in this folder (missing ./_ISSUES).",
    };
  }
  if (!lookup.ticket) {
    return {
      ok: false,
      code: 404,
      error: `Ticket not found: ${ticketId}`,
    };
  }

  const ticket = lookup.ticket;
  const frontMatter = isObject(ticket.frontMatter) ? { ...ticket.frontMatter } : {};

  const title = normalizeString(payload.title);
  const status = normalizeString(payload.status).toLowerCase();
  const priority = normalizeString(payload.priority).toLowerCase();
  const owner = normalizeOptionalString(payload.owner);
  const labels = uniquePreservingOrder(parseLabelsInput(payload.labels));
  const body = normalizeNewline(payload.body);
  const updates = payload.updates === undefined ? undefined : normalizeOptionalString(payload.updates);

  if (!title) {
    return {
      ok: false,
      code: 400,
      error: "Title is required.",
    };
  }
  if (!VALID_STATUSES.has(status)) {
    return {
      ok: false,
      code: 400,
      error: "Invalid status. Use open, doing, blocked, done, or wontfix.",
    };
  }
  if (!VALID_PRIORITIES.has(priority)) {
    return {
      ok: false,
      code: 400,
      error: "Invalid priority. Use p0, p1, p2, or p3.",
    };
  }
  if (typeof payload.body !== "string") {
    return {
      ok: false,
      code: 400,
      error: "Body must be a string.",
    };
  }

  frontMatter.id = String(frontMatter.id || ticket.fileId || ticket.id);
  frontMatter.title = title;
  frontMatter.status = status;
  frontMatter.priority = priority;
  frontMatter.owner = owner;
  frontMatter.labels = labels;
  frontMatter.updated = todayISO();

  const frontMatterText = serializeFrontMatter(frontMatter);
  const bodyText = body.replace(/^\n+/, "");
  const fullText = `---\n${frontMatterText}\n---\n\n${bodyText}\n`;

  const issuesDir = path.join(rootDir, ISSUES_DIR_NAME);
  const ticketPath = path.join(issuesDir, ticket.fileName);
  const statusPath = path.join(issuesDir, STATUS_FILE_NAME);

  let statusJsonText = null;
  if (updates !== undefined) {
    try {
      statusJsonText = prepareStatusJsonWithUpdates(statusPath, ticket, updates);
    } catch (err) {
      return {
        ok: false,
        code: 400,
        error: err.message,
      };
    }
  }

  try {
    writeFileAtomic(ticketPath, fullText);
    if (statusJsonText !== null) {
      writeFileAtomic(statusPath, statusJsonText);
    }
  } catch (err) {
    return {
      ok: false,
      code: 500,
      error: err.message,
    };
  }

  const refreshed = readTicketById(rootDir, ticketId);
  return {
    ok: true,
    code: 200,
    ticket: refreshed.ticket,
    popup: refreshed.popup,
  };
}

module.exports = {
  updateTicketById,
};
