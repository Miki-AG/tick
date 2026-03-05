const fs = require("fs");
const path = require("path");

/**
 * Return the ticket repo root (current working directory).
 * @returns {string}
 */
function repoRoot() {
  return process.cwd();
}

/**
 * Return the issues directory path.
 * @returns {string}
 */
function issuesDir() {
  return path.join(repoRoot(), "_ISSUES");
}

/**
 * Return the template path (relative to repo root).
 * @returns {string}
 */
function templatePath() {
  return path.join(__dirname, "templates", "issue.md");
}

/**
 * Return today's date in local time as YYYY-MM-DD.
 * @returns {string}
 */
function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Slugify a title string.
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  let slug = String(title || "").toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, "-");
  slug = slug.replace(/-+/g, "-");
  slug = slug.replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

/**
 * Parse CLI args into positional and flags.
 * @param {string[]} argv
 * @returns {{positional: string[], flags: object}}
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {
    status: undefined,
    priority: undefined,
    owner: undefined,
    labels: undefined,
    label: undefined,
    addLabel: [],
    removeLabel: [],
    log: undefined,
    check: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--") && arg.includes("=")) {
      throw new Error(`Invalid flag syntax: ${arg}`);
    }
    if (arg === "--status") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --status");
      flags.status = value;
      i += 1;
      continue;
    }
    if (arg === "--priority") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --priority");
      flags.priority = value;
      i += 1;
      continue;
    }
    if (arg === "--owner") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --owner");
      flags.owner = value;
      i += 1;
      continue;
    }
    if (arg === "--labels") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --labels");
      flags.labels = value;
      i += 1;
      continue;
    }
    if (arg === "--label") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --label");
      flags.label = value;
      i += 1;
      continue;
    }
    if (arg === "--add-label") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --add-label");
      flags.addLabel.push(value);
      i += 1;
      continue;
    }
    if (arg === "--remove-label") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --remove-label");
      flags.removeLabel.push(value);
      i += 1;
      continue;
    }
    if (arg === "--log") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --log");
      flags.log = value;
      i += 1;
      continue;
    }
    if (arg === "--check") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("Missing value for --check");
      flags.check = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  return { positional, flags };
}

/**
 * Ensure issuesDir exists and is a directory.
 * @returns {void}
 */
function requireIssuesDir() {
  let stat;
  try {
    stat = fs.statSync(issuesDir());
  } catch (err) {
    throw new Error("_ISSUES/ not found. Run `tick init` first.");
  }
  if (!stat.isDirectory()) {
    throw new Error("_ISSUES/ not found. Run `tick init` first.");
  }
}

/**
 * List ticket files (absolute paths) in issuesDir.
 * @returns {string[]}
 */
function listTicketFiles() {
  requireIssuesDir();
  const entries = fs.readdirSync(issuesDir());
  const files = entries.filter((entry) => /^[0-9]{4}-.*\.md$/.test(entry));
  return files.map((entry) => path.join(issuesDir(), entry)).sort();
}

/**
 * Find ticket file by id.
 * @param {string} id
 * @returns {string}
 */
function findTicketFileById(id) {
  if (!/^[0-9]{4}$/.test(id)) {
    throw new Error(`Invalid ticket id: ${id}`);
  }
  requireIssuesDir();
  const entries = fs.readdirSync(issuesDir());
  const matches = entries.filter((entry) =>
    new RegExp(`^${id}-.*\\.md$`).test(entry)
  );
  if (matches.length === 0) {
    throw new Error(`Ticket ${id} not found`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple tickets found for ${id}: ${matches.join(", ")}`);
  }
  return path.join(issuesDir(), matches[0]);
}

/**
 * Split content into front matter and body.
 * @param {string} content
 * @returns {{frontMatterRaw: string, bodyRaw: string, eol: string}}
 */
function splitFrontMatter(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "") {
      firstNonEmpty = i;
      break;
    }
  }
  if (firstNonEmpty === -1 || lines[firstNonEmpty].trim() !== "---") {
    throw new Error("Invalid front matter: first non-empty line must be ---");
  }

  let end = -1;
  for (let i = firstNonEmpty + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("Invalid front matter: closing --- not found");
  }

  const frontMatterRaw = lines.slice(firstNonEmpty + 1, end).join(eol);
  const bodyRaw = lines.slice(end + 1).join(eol);
  return { frontMatterRaw, bodyRaw, eol };
}

/**
 * Parse front matter into minimal fields.
 * @param {string} frontMatterRaw
 * @returns {{id: string|undefined, title: string|undefined, status: string|undefined, priority: string|undefined, owner: string|undefined, labels: string[]}}
 */
function parseFrontMatter(frontMatterRaw) {
  const lines = frontMatterRaw.split(/\r?\n/);
  const data = {
    id: undefined,
    title: undefined,
    status: undefined,
    priority: undefined,
    owner: undefined,
    labels: [],
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
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
        while (j < lines.length) {
          const itemLine = lines[j];
          const itemMatch = itemLine.match(/^\s*-\s*(.+)\s*$/);
          if (!itemMatch) break;
          const item = unquote(itemMatch[1]).trim();
          if (item.length > 0) collected.push(item);
          j += 1;
        }
        data.labels = collected;
        i = j - 1;
        continue;
      }
      continue;
    }

    if (["id", "title", "status", "priority", "owner"].includes(key)) {
      data[key] = unquote(rawValue);
    }
  }

  return data;
}

/**
 * Replace a scalar key line in front matter.
 * @param {string} frontMatterRaw
 * @param {string} key
 * @param {string} newValue
 * @returns {string}
 */
function replaceFrontMatterValue(frontMatterRaw, key, newValue) {
  const eol = frontMatterRaw.includes("\r\n") ? "\r\n" : "\n";
  const lines = frontMatterRaw.split(/\r?\n/);
  const re = new RegExp(`^(\\s*${key}\\s*:\\s*)(.*?)(\\s*(#.*)?)$`, "i");
  let replaced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(re);
    if (match) {
      lines[i] = `${match[1]}${newValue}${match[3] || ""}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    throw new Error(`Missing required key: ${key}`);
  }
  return lines.join(eol);
}

/**
 * Update labels in front matter, preserving style.
 * @param {string} frontMatterRaw
 * @param {{add: string[], remove: string[]}} ops
 * @returns {string}
 */
function updateLabels(frontMatterRaw, ops) {
  const eol = frontMatterRaw.includes("\r\n") ? "\r\n" : "\n";
  const lines = frontMatterRaw.split(/\r?\n/);
  const indices = findKeyLineIndices(lines, "labels");
  if (indices.length === 0) {
    throw new Error("Missing required key: labels");
  }
  if (indices.length > 1) {
    throw new Error("Multiple labels lines found in front matter.");
  }
  const idx = indices[0];
  const line = lines[idx];
  const lineMatch = line.match(/^(\s*labels\s*:\s*)(.*)$/i);
  if (!lineMatch) {
    throw new Error("Unable to parse labels line.");
  }

  const prefix = lineMatch[1];
  const valuePart = lineMatch[2];
  const inlineMatch = valuePart.match(/^(\[[^\]]*\])(\s*(#.*)?)$/);

  let format = null;
  let labels = [];
  let blockStart = null;
  let blockEnd = null;
  let blockIndent = null;
  const labelsIndent = line.match(/^\s*/)[0];
  let inlineComment = "";

  if (inlineMatch) {
    format = "inline";
    inlineComment = inlineMatch[2] || "";
    labels = parseInlineList(inlineMatch[1]) || [];
  } else if (valuePart.trim() === "") {
    format = "block";
    blockStart = idx + 1;
    blockEnd = blockStart;
    const baseIndentLen = labelsIndent.length;
    while (blockEnd < lines.length) {
      const current = lines[blockEnd];
      if (current.trim() === "") break;
      const itemMatch = current.match(/^(\s*)-\s*(.+)\s*$/);
      if (!itemMatch) break;
      if (itemMatch[1].length <= baseIndentLen) break;
      if (!blockIndent) blockIndent = itemMatch[1];
      labels.push(unquote(itemMatch[2]).trim());
      blockEnd += 1;
    }
    if (!blockIndent) {
      blockIndent = `${labelsIndent}  `;
    }
  } else {
    throw new Error("Unsupported labels format.");
  }

  const add = (ops.add || []).map((l) => l.trim()).filter((l) => l);
  const remove = (ops.remove || []).map((l) => l.trim()).filter((l) => l);

  for (const label of remove) {
    const idxToRemove = labels.indexOf(label);
    if (idxToRemove === -1) {
      throw new Error(`Label not found: ${label}`);
    }
    labels.splice(idxToRemove, 1);
  }

  for (const label of add) {
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }

  if (format === "inline") {
    const listText = labels.length > 0 ? `[${labels.join(", ")}]` : "[]";
    lines[idx] = `${prefix}${listText}${inlineComment}`;
  } else {
    const items = labels.map((label) => `${blockIndent}- ${label}`);
    lines.splice(blockStart, blockEnd - blockStart, ...items);
  }

  return lines.join(eol);
}

/**
 * Append a log entry to the Log section.
 * @param {string} bodyRaw
 * @param {string} message
 * @returns {string}
 */
function appendLog(bodyRaw, message) {
  const eol = bodyRaw.includes("\r\n") ? "\r\n" : "\n";
  const lines = bodyRaw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === "## Log");
  if (headerIndex === -1) {
    throw new Error("Log section not found: ## Log");
  }
  let end = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const logLine = `- ${todayISO()}: ${message}`;
  lines.splice(end, 0, logLine);
  return lines.join(eol);
}

/**
 * Check an acceptance criteria checkbox by needle.
 * @param {string} bodyRaw
 * @param {string} needle
 * @returns {string}
 */
function checkAcceptance(bodyRaw, needle) {
  const eol = bodyRaw.includes("\r\n") ? "\r\n" : "\n";
  const lines = bodyRaw.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => line.trim() === "## Acceptance criteria"
  );
  if (headerIndex === -1) {
    throw new Error("Acceptance criteria section not found: ## Acceptance criteria");
  }
  let end = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  const needleLower = needle.toLowerCase();
  const matches = [];
  for (let i = headerIndex + 1; i < end; i += 1) {
    const line = lines[i];
    const match = line.match(/^(\s*-\s*)\[( |x|X)\](\s*)(.*)$/);
    if (!match) continue;
    const text = match[4];
    if (text.toLowerCase().includes(needleLower)) {
      matches.push({
        index: i,
        line,
        checked: match[2].toLowerCase() === "x",
        prefix: match[1],
        space: match[3],
        text,
      });
    }
  }

  if (matches.length === 0) {
    throw new Error("No matching acceptance criteria found.");
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple matching acceptance criteria: ${matches
        .map((m) => m.line.trim())
        .join(" | ")}`
    );
  }

  const match = matches[0];
  if (match.checked) {
    throw new Error("Acceptance criteria already checked.");
  }
  lines[match.index] = `${match.prefix}[x]${match.space}${match.text}`;
  return lines.join(eol);
}

/**
 * Write a file atomically (temp file + rename).
 * @param {string} targetPath
 * @param {string} newContent
 * @returns {void}
 */
function writeFileAtomic(targetPath, newContent) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmpPath = path.join(
    dir,
    `.${base}.tmp-${process.pid}-${Date.now()}`
  );

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

/**
 * Validate status value.
 * @param {string} status
 * @returns {void}
 */
function validateStatus(status) {
  if (!["open", "doing", "blocked", "done", "wontfix"].includes(status)) {
    throw new Error(
      `Invalid status: ${status}. Use open, doing, blocked, done, or wontfix.`
    );
  }
}

/**
 * Validate priority value.
 * @param {string} priority
 * @returns {void}
 */
function validatePriority(priority) {
  if (!["p0", "p1", "p2", "p3"].includes(priority)) {
    throw new Error(`Invalid priority: ${priority}. Use p0, p1, p2, or p3.`);
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => unquote(item))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function findKeyLineIndices(lines, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*:`, "i");
  const indices = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) indices.push(i);
  }
  return indices;
}

module.exports = {
  repoRoot,
  issuesDir,
  templatePath,
  todayISO,
  slugify,
  parseArgs,
  requireIssuesDir,
  listTicketFiles,
  findTicketFileById,
  splitFrontMatter,
  parseFrontMatter,
  replaceFrontMatterValue,
  updateLabels,
  appendLog,
  checkAcceptance,
  writeFileAtomic,
  validateStatus,
  validatePriority,
};
