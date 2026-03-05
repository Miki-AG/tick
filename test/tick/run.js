const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readCommand(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const line = lines.find((l) => l.length > 0);
  if (!line) {
    fail(`Command file is empty: ${filePath}`);
  }
  return line;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function runScenario(scenarioName) {
  const scenarioDir = path.join(__dirname, scenarioName);

  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenarioDir}`);
  }

  const commandPath = path.join(scenarioDir, "command");
  const startIssuesDir = path.join(scenarioDir, "start-issues");
  const generatedDir = path.join(scenarioDir, "generated-result-issues");
  const issuesIsFileFlag = path.join(scenarioDir, "issues-is-file");

  if (!fs.existsSync(commandPath)) {
    throw new Error(`Missing command file: ${commandPath}`);
  }
  if (!fs.existsSync(startIssuesDir)) {
    throw new Error(`Missing start-issues directory: ${startIssuesDir}`);
  }
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tick-test-"));
  const issuesDir = path.join(tempRoot, "_ISSUES");

  if (fs.existsSync(issuesIsFileFlag)) {
    fs.writeFileSync(issuesDir, "", { encoding: "utf8", flag: "w" });
  } else {
    fs.mkdirSync(issuesDir, { recursive: true });
    copyDir(startIssuesDir, issuesDir);
  }

  let command = readCommand(commandPath);
  const tickPath = path.join(__dirname, "..", "..", "src", "tick", "tick");
  command = command.replace(/^tick\b/, `"${tickPath}"`);

  const result = spawnSync(command, {
    cwd: tempRoot,
    shell: true,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Failed to run command: ${result.error.message}`);
  }

  const exitCode = result.status === null ? 1 : result.status;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";

  const outputLines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const firstLine = outputLines[0] || "";
  if (firstLine.startsWith("_ISSUES/")) {
    const generatedPath = path.join(tempRoot, firstLine);
    if (fs.existsSync(generatedPath)) {
      const target = path.join(generatedDir, "issue.md");
      fs.copyFileSync(generatedPath, target);
    }
  }

  return { scenarioName, command, exitCode, stdout, stderr };
}

function main() {
  const argScenario = process.argv[2];
  let scenarios = [];

  if (argScenario) {
    scenarios = [argScenario];
  } else {
    const entries = fs.readdirSync(__dirname, { withFileTypes: true });
    scenarios = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d{3}-/.test(name))
      .sort();
  }

  if (scenarios.length === 0) {
    fail("No scenarios found.");
  }

  let passed = 0;
  let failed = 0;

  for (const scenarioName of scenarios) {
    let ok = true;
    try {
      const result = runScenario(scenarioName);
      process.stdout.write(`Scenario: ${result.scenarioName}\n`);
      process.stdout.write(`Command: ${result.command}\n`);
      process.stdout.write(`Exit: ${result.exitCode}\n`);
      process.stdout.write("Stdout:\n");
      process.stdout.write(result.stdout.trim().length ? result.stdout : "<empty>\n");
      process.stdout.write("Stderr:\n");
      process.stdout.write(result.stderr.trim().length ? result.stderr : "<empty>\n");
      process.stdout.write("\n");
    } catch (err) {
      ok = false;
      process.stdout.write(`Scenario: ${scenarioName}\n`);
      process.stdout.write(`Error: ${err.message}\n\n`);
    }
    if (ok) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  process.stdout.write(`Total passed: ${passed}\n`);
  process.stdout.write(`Total failed: ${failed}\n`);
}

main();
