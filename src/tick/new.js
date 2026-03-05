const fs = require("fs");
const path = require("path");
const {
  issuesDir,
  templatePath,
  todayISO,
  slugify,
  parseArgs,
  requireIssuesDir,
  listTicketFiles,
  replaceFrontMatterValue,
  splitFrontMatter,
  validatePriority,
} = require("./lib");

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usageAndExit() {
  process.stderr.write(
    'Usage: node new.js "Issue title" [--priority p0|p1|p2|p3] [--owner name] [--labels a,b,c]\n'
  );
  process.exit(2);
}

function ensureAllowedFlags(flags) {
  const unsupported = [];
  if (flags.status !== undefined) unsupported.push("--status");
  if (flags.label !== undefined) unsupported.push("--label");
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

  if (positional.length === 0) {
    usageAndExit();
  }
  if (positional.length > 1) {
    fail(`Unexpected argument: ${positional[1]}`);
  }

  ensureAllowedFlags(flags);

  const title = positional[0];
  const priority = flags.priority || "p2";
  const owner = flags.owner || "";
  const labelsRaw = flags.labels || "";

  try {
    validatePriority(priority);
  } catch (err) {
    fail(err.message);
  }

  try {
    requireIssuesDir();
  } catch (err) {
    fail(err.message);
  }

  const tplPath = templatePath();
  try {
    fs.accessSync(tplPath, fs.constants.R_OK);
  } catch (err) {
    if (err.code === "ENOENT") {
      fail(`Template not found at ${tplPath}`);
    }
    fail(`Unable to read template: ${err.message}`);
  }

  let entries;
  try {
    entries = listTicketFiles();
  } catch (err) {
    fail(err.message);
  }

  let maxId = 0;
  for (const entry of entries) {
    const base = path.basename(entry);
    const match = base.match(/^(\d{4})-.*\.md$/);
    if (!match) continue;
    const idNum = Number(match[1]);
    if (Number.isFinite(idNum) && idNum > maxId) {
      maxId = idNum;
    }
  }

  const nextIdNum = maxId + 1;
  const id = String(nextIdNum).padStart(4, "0");
  const slug = slugify(title);
  const targetPath = path.join(issuesDir(), `${id}-${slug}.md`);

  if (fs.existsSync(targetPath)) {
    fail(`Issue already exists: _ISSUES/${id}-${slug}.md`);
  }

  let template;
  try {
    template = fs.readFileSync(tplPath, "utf8");
  } catch (err) {
    fail(`Unable to read template: ${err.message}`);
  }

  let content = template;
  content = content.split("{{id}}").join(id);
  content = content.split("{{title}}").join(title);
  content = content.split("{{date}}").join(todayISO());

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

  try {
    frontMatterRaw = replaceFrontMatterValue(frontMatterRaw, "priority", priority);
    frontMatterRaw = replaceFrontMatterValue(frontMatterRaw, "owner", owner);
    const labels = labelsRaw
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
    const labelsValue = labels.length > 0 ? `[${labels.join(", ")}]` : "[]";
    frontMatterRaw = replaceFrontMatterValue(frontMatterRaw, "labels", labelsValue);
  } catch (err) {
    fail(err.message);
  }

  let newContent = `---${eol}${frontMatterRaw}${eol}---`;
  if (bodyRaw.length > 0) {
    newContent += `${eol}${bodyRaw}`;
  }

  try {
    fs.writeFileSync(targetPath, newContent, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    fail(`Unable to write issue file: ${err.message}`);
  }

  process.stdout.write(`_ISSUES/${id}-${slug}.md\n`);
}

main();
