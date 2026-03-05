---
id: 0002
title: Move tick sources under src/tick
status: done
priority: p1
owner: codex
labels: [TASK]
created: 2026-03-05
updated: 2026-03-05
---

## Context
User requested all `tick` sources live under `src/tick`.
Keep `./tick` working from repo root while relocating implementation and tests.

## Acceptance criteria
- [x] `init.js`, `lib.js`, `list.js`, `new.js`, `update.js` exist under `src/tick`.
- [x] `templates/` and `test/` exist under `src/tick`.
- [x] Root `./tick` works as wrapper and remains executable.
- [x] `./tick -h` and `./tick list` still work from repo root.
- [x] `npm test` passes using the moved test runner path.
- [x] `README.md` reflects the `src/tick` layout.

## Notes
This is a repository layout refactor without behavior changes.

## Log
- 2026-03-05: created

- 2026-03-05: Moved implementation files to src/tick and added root wrapper entrypoint.

- 2026-03-05: Layout refactor complete: all sources moved to src/tick and behavior verified.
