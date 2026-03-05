const fs = require("fs");
const path = require("path");
const { repoRoot, issuesDir } = require("./lib");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main() {
  const root = repoRoot();

  if (!fs.existsSync(root)) {
    fail(`Current directory does not exist: ${root}`);
  }

  let rootStat;
  try {
    rootStat = fs.statSync(root);
  } catch (err) {
    fail(`Unable to stat current directory: ${err.message}`);
  }

  if (!rootStat.isDirectory()) {
    fail(`Current path is not a directory: ${root}`);
  }

  try {
    fs.accessSync(root, fs.constants.W_OK);
  } catch (err) {
    fail(`Current directory is not writable: ${root}`);
  }

  const issuesPath = issuesDir();

  if (fs.existsSync(issuesPath)) {
    let issuesStat;
    try {
      issuesStat = fs.statSync(issuesPath);
    } catch (err) {
      fail(`Unable to stat _ISSUES directory: ${err.message}`);
    }

    if (!issuesStat.isDirectory()) {
      fail(`_ISSUES exists but is not a directory: ${issuesPath}`);
    }

    let entries;
    try {
      entries = fs.readdirSync(issuesPath);
    } catch (err) {
      fail(`Unable to read _ISSUES directory: ${err.message}`);
    }

    if (entries.length > 0) {
      fail("Repo already initialized: _ISSUES/ is not empty");
    }
  } else {
    try {
      fs.mkdirSync(issuesPath);
    } catch (err) {
      fail(`Unable to create _ISSUES directory: ${err.message}`);
    }
  }

  const readmePath = path.join(issuesPath, "README.md");
  const readmeContent =
    "---\nThis folder contains ticket Markdown files only.\nNo scripts. No generated files. No exceptions.\n---";

  try {
    fs.writeFileSync(readmePath, readmeContent, { encoding: "utf8", flag: "w" });
  } catch (err) {
    fail(`Unable to write README.md: ${err.message}`);
  }

  process.stdout.write("Initialized ticket repo in ./_ISSUES\n");
}

main();
