# General

Core guidance for collaborating with LLMs across this project.

## Tool Usage

Use local helper tools directly from any project folder:

- `tick`: lightweight issue tracking in `./_ISSUES`.
- `kport`: check common local dev ports and kill a selected listener.

## LLM Issue Workflow (`tick`)

- The LLM must use `tick` to track and manage implementation work.
- If `./_ISSUES` does not exist, run `tick init` before starting work.
- Create work items with `tick new "Title" --priority p1 --owner <agent> --labels ...`.
- Move issues through status as work evolves (for example: `open -> doing -> done`).
- Record meaningful progress using ticket updates (`tick update <id> ...`) so history stays in the issue.
- Keep acceptance criteria up to date and verifiable per issue.
- Use `tick list` to review active work and avoid losing track of in-progress tasks.
- Use `tick -h` for full command reference.

### Label Taxonomy (`tick` tags)

Use these labels consistently:

- `TESTING`: testing work, test scenarios, validation, QA checks.
- `BUG`: defects found, bug fixes, regressions.
- `TASK`: all other non-bug implementation or operational work.

Guidelines:

- Use uppercase exactly as shown: `TESTING`, `BUG`, `TASK`.
- Prefer one primary label per issue unless multiple are clearly necessary.
- If unsure between `BUG` and `TASK`, use `TASK` and clarify in issue context/log.
- If a `TESTING` task discovers a defect, create a separate new ticket labeled `BUG` for that defect.
- Reference the originating testing ticket in the new bug ticket (and optionally cross-reference back).
- When a test unveils a bug, update the testing ticket status text to include `Found bug <id>` (example: `Found bug 0007`).

## LLM User Communication (`_ISSUES/status.json`)

- The LLM should maintain `./_ISSUES/status.json` with granular, current progress.
- This file is consumed by `tick-report` and is the live communication layer for users.
- Keep it valid JSON at all times (rewrite atomically; no partial JSON).
- Use one entry per ticket id with an `updates` field.
- Use `popup` for short top-left notifications the user must notice.
- For test-discovered defects, the testing ticket `updates` must contain the exact pattern: `Found bug <id>`.
- Popup levels:
- `info`: neutral updates.
- `warn`: waiting for user input/permission.
- `error`: blocked by failure or urgent action required.
- Clear popup by removing it or setting an empty message once resolved.

Example:

```json
{
  "popup": {
    "level": "warn",
    "message": "Need permission to run command outside sandbox."
  },
  "0001": {
    "updates": "Found bug 0007 while validating export scenario."
  },
  "0002": {
    "updates": "Blocked waiting for API key from user."
  }
}
```

## _AI-META File Map

- `_AI-META/_general.md`: shared baseline instructions and operating rules for all LLM work in this project.
- `_AI-META/reporting.md`: how to report progress, decisions, risks, and outcomes.
- `_AI-META/coding.md`: coding standards, implementation expectations, testing, and review quality bar.
- `_AI-META/writing-professional.md`: guidance for technical, business, and stakeholder-facing writing.
- `_AI-META/writing-fiction.md`: guidance for creative and narrative writing tasks.
- `_AI-META/research.md`: guidance for fact-finding, source quality, verification, and synthesis.
