"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TICK_REPORT_BIN = path.join(REPO_ROOT, "tick-report");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCommand(cwd, args, extraEnv = {}) {
  const result = spawnSync(TICK_REPORT_BIN, args, {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.error) {
    throw new Error(`Command failed to execute: ${result.error.message}`);
  }

  return {
    command: `${TICK_REPORT_BIN} ${args.join(" ")}`.trim(),
    exitCode: result.status === null ? 1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function printResult(name, result) {
  process.stdout.write(`Scenario: ${name}\n`);
  process.stdout.write(`Command: ${result.command}\n`);
  process.stdout.write(`Exit: ${result.exitCode}\n`);
  process.stdout.write("Stdout:\n");
  process.stdout.write(result.stdout.trim().length ? result.stdout : "<empty>\n");
  process.stdout.write("Stderr:\n");
  process.stdout.write(result.stderr.trim().length ? result.stderr : "<empty>\n");
  process.stdout.write("\n");
}

function ensureRepoArtifacts() {
  if (!fs.existsSync(TICK_REPORT_BIN)) {
    fail(`Missing root wrapper: ${TICK_REPORT_BIN}`);
  }
  const sourceEntry = path.join(REPO_ROOT, "src", "tick-report", "tick-report");
  if (!fs.existsSync(sourceEntry)) {
    fail(`Missing source entrypoint: ${sourceEntry}`);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!Number.isFinite(port)) {
          reject(new Error("Unable to determine free port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

function extractUrl(stdout) {
  const match = String(stdout || "").match(/URL:\s*(http:\/\/[^\s]+)/i);
  return match ? match[1] : null;
}

function createRepoWithSampleIssue(repoDir, title) {
  const issuesDir = path.join(repoDir, "_ISSUES");
  fs.mkdirSync(issuesDir, { recursive: true });
  const issuePath = path.join(issuesDir, "0001-sample.md");
  const content = `---\nid: 0001\ntitle: ${title}\nstatus: open\npriority: p1\nowner: test\nlabels: [TASK]\ncreated: 2026-03-05\nupdated: 2026-03-05\n---\n\n## Context\nSample context\n\n## Acceptance criteria\n- [ ] Sample\n\n## Notes\nSample\n\n## Log\n- 2026-03-05: created\n`;
  fs.writeFileSync(issuePath, content, "utf8");
}

async function fetchJson(url, init) {
  const res = await fetch(url, {
    cache: "no-store",
    ...(init || {}),
  });
  const data = await res.json();
  return { res, data };
}

async function fetchText(url, init) {
  const res = await fetch(url, {
    cache: "no-store",
    ...(init || {}),
  });
  const text = await res.text();
  return { res, text };
}

async function runScenarios() {
  let passed = 0;
  let failed = 0;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tick-report-multi-"));
  const globalStateDir = path.join(tempRoot, "global-state");
  const repoA = path.join(tempRoot, "repo-a");
  const repoB = path.join(tempRoot, "repo-b");
  fs.mkdirSync(repoA, { recursive: true });
  fs.mkdirSync(repoB, { recursive: true });
  createRepoWithSampleIssue(repoA, "Repo A original title");
  createRepoWithSampleIssue(repoB, "Repo B original title");
  const repoAReal = fs.realpathSync(repoA);
  const repoBReal = fs.realpathSync(repoB);

  const port = await getFreePort();
  const env = { TICK_REPORT_HOME: globalStateDir };

  const helpResult = runCommand(repoA, ["-h"], env);
  printResult("001-help", helpResult);
  try {
    assert(helpResult.exitCode === 0, "Help command must exit 0.");
    assert(
      helpResult.stdout.toLowerCase().includes("single daemon"),
      "Help output should mention single daemon behavior."
    );
    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`Error: ${err.message}\n\n`);
  }

  let startA;
  let startB;
  let statusA;
  let stopResult;

  try {
    startA = runCommand(repoA, [
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--interval",
      "500",
    ], env);
    printResult("002-start-repo-a", startA);

    startB = runCommand(repoB, [
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--interval",
      "500",
    ], env);
    printResult("003-start-repo-b", startB);

    statusA = runCommand(repoA, ["status"], env);
    printResult("004-status", statusA);

    assert(startA.exitCode === 0, "First start must exit 0.");
    assert(startA.stdout.includes("launch requested"), "First start should launch daemon.");
    assert(startB.exitCode === 0, "Second start must exit 0.");
    assert(startB.stdout.includes("Reused existing instance"), "Second start should reuse daemon.");
    assert(statusA.exitCode === 0, "Status must exit 0.");
    assert(statusA.stdout.includes("attached projects: 2"), "Status should report two attached projects.");

    const baseUrl = extractUrl(startA.stdout);
    assert(baseUrl, "Start output must include URL.");

    const projectsResponse = await fetchJson(`${baseUrl}/api/projects`);
    assert(projectsResponse.res.ok, "GET /api/projects must succeed.");
    const projects = Array.isArray(projectsResponse.data.projects)
      ? projectsResponse.data.projects
      : [];
    assert(projects.length === 2, "Expected exactly two attached projects.");

    const projectA = projects.find((project) => project.path === repoAReal);
    const projectB = projects.find((project) => project.path === repoBReal);
    assert(projectA, "Repo A project must be present.");
    assert(projectB, "Repo B project must be present.");

    const reportA = await fetchJson(`${baseUrl}/api/projects/${encodeURIComponent(projectA.id)}/report`);
    const reportB = await fetchJson(`${baseUrl}/api/projects/${encodeURIComponent(projectB.id)}/report`);
    assert(reportA.res.ok && reportB.res.ok, "Project report endpoints must succeed.");

    const landingHtml = await fetchText(`${baseUrl}/`);
    const projectHtml = await fetchText(`${baseUrl}/project/${encodeURIComponent(projectA.id)}`);
    const ticketHtml = await fetchText(
      `${baseUrl}/project/${encodeURIComponent(projectA.id)}/ticket/0001`
    );
    assert(landingHtml.res.ok, "Landing page must load.");
    assert(projectHtml.res.ok, "Project page must load.");
    assert(ticketHtml.res.ok, "Ticket page must load.");
    assert(
      landingHtml.text.includes("id=\"project-rows\""),
      "Landing page must show project list."
    );
    assert(
      !landingHtml.text.includes("id=\"rows\""),
      "Landing page must not show ticket list."
    );
    assert(
      !landingHtml.text.includes(">VIEW<"),
      "Landing page must not show VIEW action."
    );
    assert(
      !landingHtml.text.includes("id=\"status-filters\""),
      "Landing page must not show ticket filter toolbar."
    );
    assert(
      !projectHtml.text.includes("id=\"project-rows\""),
      "Project page must not show project list."
    );
    assert(
      projectHtml.text.includes("id=\"rows\""),
      "Project page must show ticket list."
    );
    assert(
      projectHtml.text.includes("id=\"status-filters\""),
      "Project page must show status filter toggles."
    );
    assert(
      projectHtml.text.includes("id=\"min-ticket-id\""),
      "Project page must show minimum ticket filter input."
    );
    assert(
      ticketHtml.text.includes("href=\"/\">tick-report</a>"),
      "Ticket page breadcrumb must link tick-report to landing page."
    );
    assert(
      ticketHtml.text.includes(`href=\"/project/${encodeURIComponent(projectA.id)}\"`),
      "Ticket page breadcrumb must link project id to the project page."
    );
    assert(
      ticketHtml.text.includes(">repo-a<"),
      "Ticket page breadcrumb project segment should show project folder name."
    );
    assert(
      ticketHtml.text.includes(">ticket 0001<"),
      "Ticket page breadcrumb must render ticket segment separately."
    );

    const updateRes = await fetchJson(
      `${baseUrl}/api/projects/${encodeURIComponent(projectA.id)}/ticket/0001`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Repo A updated title",
          status: "doing",
          priority: "p1",
          owner: "tester",
          labels: ["TASK"],
          updates: "Updated from multi-repo test",
          body: "Updated body",
        }),
      }
    );
    assert(updateRes.res.ok, "Project-scoped ticket update must succeed.");

    const repoAFile = fs.readFileSync(path.join(repoA, "_ISSUES", "0001-sample.md"), "utf8");
    const repoBFile = fs.readFileSync(path.join(repoB, "_ISSUES", "0001-sample.md"), "utf8");
    assert(repoAFile.includes("Repo A updated title"), "Repo A ticket file should be updated.");
    assert(!repoBFile.includes("Repo A updated title"), "Repo B ticket file must remain unchanged.");

    const detachRes = await fetchJson(
      `${baseUrl}/api/projects/${encodeURIComponent(projectB.id)}/detach`,
      {
        method: "POST",
      }
    );
    assert(detachRes.res.ok, "Detach endpoint must succeed.");
    const remaining = Array.isArray(detachRes.data.projects) ? detachRes.data.projects : [];
    assert(remaining.length === 1, "Detach should leave one project.");

    passed += 1;
  } catch (err) {
    failed += 1;
    process.stdout.write(`Error: ${err.message}\n\n`);
  } finally {
    try {
      stopResult = runCommand(repoA, ["stop"], env);
      printResult("005-stop", stopResult);
    } catch (err) {
      process.stdout.write(`Cleanup stop failed: ${err.message}\n\n`);
    }
  }

  process.stdout.write(`Total scenarios: 2\n`);
  process.stdout.write(`Total passed: ${passed}\n`);
  process.stdout.write(`Total failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

async function main() {
  ensureRepoArtifacts();
  await runScenarios();
}

main().catch((err) => {
  fail(err.message);
});
