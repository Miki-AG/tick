---
id: 0003
title: Move tests to test/tick
status: done
priority: p1
owner: codex
labels: [TASK]
created: 2026-03-05
updated: 2026-03-05
---

## Context
User requested the test suite to live under `test/tick` instead of `src/tick/test`.
The command surface must remain stable (`./tick test`, `npm test`).

## Acceptance criteria
- [x] Test scenarios and runner are located under `test/tick`.
- [x] `src/tick/test` no longer exists.
- [x] `./tick test` resolves to `test/tick/run.js`.
- [x] `npm test` runs `node test/tick/run.js`.
- [x] `test/tick/run.js` executes the correct CLI path after relocation.
- [x] `README.md` reflects the `test/tick` layout.

## Notes
This is a filesystem layout refactor only.

## Log
- 2026-03-05: created

- 2026-03-05: Moved tests to test/tick and updated source/test entrypoints.
- 2026-03-05: Moved tests to test/tick and updated wrapper, runner, npm script, and docs.