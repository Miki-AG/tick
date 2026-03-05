const fs = require("fs");
const path = require("path");
const {
  parseArgs,
  requireIssuesDir,
  findTicketFileById,
  splitFrontMatter,
  parseFrontMatter,
  replaceFrontMatterValue,
  updateLabels,
  appendLog,
  checkAcceptance,
  writeFileAtomic,
  todayISO,
  validateStatus,
  validatePriority,
} = require("./lib");

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function getSingleKeyValue(frontMatterRaw, key) {
  const lines = frontMatterRaw.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.*?)(\\s*(#.*)?)$`, "i");
  let count = 0;
  let value = null;
  for (const line of lines) {
    const match = line.match(re);
    if (!match) continue;
    count += 1;
    if (count === 1) {
      value = match[1].trim();
    }
  }
  if (count === 0) {
    throw new Error(`Missing required key: ${key}`);
  }
  if (count > 1) {
    throw new Error(`Multiple ${key} lines found in front matter.`);
  }
  return value;
}

function ensureAllowedFlags(flags) {
  const unsupported = [];
  if (flags.labels !== undefined) unsupported.push("--labels");
  if (flags.label !== undefined) unsupported.push("--label");
  if (unsupported.length > 0) {
    fail(`Unknown flag: ${unsupported[0]}`);
  }
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (positional.length === 0) {
    fail("Missing id. Usage: tick update <id> [options]", 2);
  }
  if (positional.length > 1) {
    fail(`Unexpected argument: ${positional[1]}`);
  }

  const id = positional[0];
  if (!/^\d{4}$/.test(id)) {
    fail("Invalid id. Must be exactly 4 digits.");
  }

  ensureAllowedFlags(flags);

  const status = flags.status !== undefined ? flags.status : null;
  const priority = flags.priority !== undefined ? flags.priority : null;
  const owner = flags.owner !== undefined ? flags.owner : null;
  const addLabels = flags.addLabel || [];
  const removeLabels = flags.removeLabel || [];
  const logMessage = flags.log !== undefined ? flags.log : null;
  const checkNeedle = flags.check !== undefined ? flags.check : null;

  if (status) {
    try {
      validateStatus(status);
    } catch (err) {
      fail(err.message);
    }
  }
  if (priority) {
    try {
      validatePriority(priority);
    } catch (err) {
      fail(err.message);
    }
  }

  if (
    status === null &&
    priority === null &&
    owner === null &&
    addLabels.length === 0 &&
    removeLabels.length === 0 &&
    logMessage === null &&
    checkNeedle === null
  ) {
    fail("No changes requested.");
  }

  try {
    requireIssuesDir();
  } catch (err) {
    fail(err.message);
  }

  let filePath;
  try {
    filePath = findTicketFileById(id);
  } catch (err) {
    fail(err.message);
  }

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    fail(`Unable to read issue file: ${path.basename(filePath)}`);
  }

  let frontMatterRaw;
  let bodyRaw;
  let eol;
  try {
    const split = splitFrontMatter(content);
    frontMatterRaw = split.frontMatterRaw;
    bodyRaw = split.bodyRaw;
    eol = split.eol;
  } catch (err) {
    fail(err.message);
  }

  const changes = [];
  let changed = false;
  let updatedFront = frontMatterRaw;
  let updatedBody = bodyRaw;

  if (status !== null) {
    try {
      const oldValue = getSingleKeyValue(updatedFront, "status");
      if (oldValue !== status) {
        updatedFront = replaceFrontMatterValue(updatedFront, "status", status);
        changes.push(`status: ${oldValue} -> ${status}`);
        changed = true;
      }
    } catch (err) {
      fail(err.message);
    }
  }

  if (priority !== null) {
    try {
      const oldValue = getSingleKeyValue(updatedFront, "priority");
      if (oldValue !== priority) {
        updatedFront = replaceFrontMatterValue(
          updatedFront,
          "priority",
          priority
        );
        changes.push(`priority: ${oldValue} -> ${priority}`);
        changed = true;
      }
    } catch (err) {
      fail(err.message);
    }
  }

  if (owner !== null) {
    try {
      const oldValue = getSingleKeyValue(updatedFront, "owner");
      if (oldValue !== owner) {
        updatedFront = replaceFrontMatterValue(updatedFront, "owner", owner);
        changes.push(`owner: ${oldValue} -> ${owner}`);
        changed = true;
      }
    } catch (err) {
      fail(err.message);
    }
  }

  if (addLabels.length > 0 || removeLabels.length > 0) {
    const beforeLabels = parseFrontMatter(updatedFront).labels || [];
    let afterFront = updatedFront;
    try {
      afterFront = updateLabels(updatedFront, {
        add: addLabels,
        remove: removeLabels,
      });
    } catch (err) {
      fail(err.message);
    }
    const afterLabels = parseFrontMatter(afterFront).labels || [];

    const removed = beforeLabels.filter((label) => !afterLabels.includes(label));
    const added = afterLabels.filter((label) => !beforeLabels.includes(label));

    for (const label of removed) {
      changes.push(`labels: -${label}`);
      changed = true;
    }
    for (const label of added) {
      changes.push(`labels: +${label}`);
      changed = true;
    }

    updatedFront = afterFront;
  }

  if (logMessage !== null) {
    try {
      updatedBody = appendLog(updatedBody, logMessage);
      changes.push("log: appended");
      changed = true;
    } catch (err) {
      fail(err.message);
    }
  }

  if (checkNeedle !== null) {
    try {
      updatedBody = checkAcceptance(updatedBody, checkNeedle);
      changes.push(`acceptance: checked "${checkNeedle}"`);
      changed = true;
    } catch (err) {
      fail(err.message);
    }
  }

  if (!changed) {
    fail("No changes applied.");
  }

  const today = todayISO();
  try {
    getSingleKeyValue(updatedFront, "updated");
    updatedFront = replaceFrontMatterValue(updatedFront, "updated", today);
  } catch (err) {
    fail(err.message);
  }
  changes.unshift(`updated: ${today}`);

  let newContent = `---${eol}${updatedFront}${eol}---`;
  if (updatedBody.length > 0) {
    newContent += `${eol}${updatedBody}`;
  }

  try {
    writeFileAtomic(filePath, newContent);
  } catch (err) {
    fail(err.message);
  }

  process.stdout.write(`_ISSUES/${path.basename(filePath)}\n`);
  for (const line of changes) {
    process.stdout.write(`${line}\n`);
  }
}

main();
