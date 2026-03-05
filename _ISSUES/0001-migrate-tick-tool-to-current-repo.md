---
id: 0001
title: Migrate tick tool to current repo
status: done
priority: p1
owner: codex
labels: [TASK]
created: 2026-03-05
updated: 2026-03-05
---

## Context
The `tick` CLI currently lives in `~/_scripts/tools/tick`.
This repository should become the standalone home for the tool and tests.

## Acceptance criteria
- [x] Tool source files and directories are copied to this repository.
- [x] `tick` entrypoint uses local relative paths (no hardcoded source path).
- [x] `tick` is executable and `./tick -h` works from repo root.
- [x] Tool tests pass locally (`npm test`).
- [x] `README.md` documents local usage, tests, and optional global setup.

## Notes
Implementation follows `_DOCS/020_plan.md`.

## Log
- 2026-03-05: created

- 2026-03-05: Starting migration of tick tool from ~/_scripts/tools/tick
- 2026-03-05: Started implementation: copying tick source files into repo and preserving metadata.

- 2026-03-05: Migration completed: local pathing, package.json, tests, and README verified.