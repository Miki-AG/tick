const fs = require("fs");
const path = require("path");
const {
  parseArgs,
  requireIssuesDir,
  listTicketFiles,
  splitFrontMatter,
  parseFrontMatter,
  validateStatus,
} = require("./lib");

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function ensureAllowedFlags(flags) {
  const unsupported = [];
  if (flags.priority !== undefined) unsupported.push("--priority");
  if (flags.labels !== undefined) unsupported.push("--labels");
  if (flags.addLabel.length > 0) unsupported.push("--add-label");
  if (flags.removeLabel.length > 0) unsupported.push("--remove-label");
  if (flags.log !== undefined) unsupported.push("--log");
  if (flags.check !== undefined) unsupported.push("--check");
  if (unsupported.length > 0) {
    fail(`Unknown flag: ${unsupported[0]}`);
  }
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (positional.length > 0) {
    fail(`Unexpected argument: ${positional[0]}`);
  }

  ensureAllowedFlags(flags);

  if (flags.status !== undefined) {
    try {
      validateStatus(flags.status);
    } catch (err) {
      fail(err.message);
    }
  }

  try {
    requireIssuesDir();
  } catch (err) {
    fail(err.message);
  }

  let files;
  try {
    files = listTicketFiles();
  } catch (err) {
    fail(err.message);
  }

  const rows = [];
  for (const filePath of files) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      fail(`Unable to read issue file: ${path.basename(filePath)}`);
    }

    let frontMatterRaw;
    try {
      frontMatterRaw = splitFrontMatter(content).frontMatterRaw;
    } catch (err) {
      continue;
    }

    const fm = parseFrontMatter(frontMatterRaw);
    const idNum = Number.parseInt(fm.id, 10);
    if (!Number.isFinite(idNum)) continue;

    if (flags.status && fm.status !== flags.status) continue;
    if (flags.owner !== undefined && fm.owner !== flags.owner) continue;
    if (flags.label) {
      const labels = Array.isArray(fm.labels) ? fm.labels : [];
      if (!labels.includes(flags.label)) continue;
    }

    rows.push({
      id: fm.id,
      status: fm.status || "",
      priority: fm.priority || "",
      title: fm.title || "",
      file: `_ISSUES/${path.basename(filePath)}`,
      idNum,
    });
  }

  rows.sort((a, b) => a.idNum - b.idNum);

  const header = ["id", "status", "priority", "title", "file"].join("\t");
  process.stdout.write(`${header}\n`);

  for (const row of rows) {
    const line = [row.id, row.status, row.priority, row.title, row.file].join(
      "\t"
    );
    process.stdout.write(`${line}\n`);
  }
}

main();
