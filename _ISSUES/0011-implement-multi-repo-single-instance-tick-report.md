---
id: 0011
title: Implement multi-repo single-instance tick-report
status: done
priority: p0
owner: codex
labels: [TASK]
created: 2026-03-05
updated: 2026-03-05
---

## Context
Implement `_DOCS/050_support_for_multiple_repos.REQUIREMENTS.md` and
`_DOCS/060_support_for_multiple_repos.PLAN.md`.

## Acceptance criteria
- [x] `tick-report` runs as a single global daemon instance.
- [x] Starting from another repo reuses daemon and attaches that repo.
- [x] Landing page lists attached projects with `GO` and `DETACH`.
- [x] Project-scoped report and ticket endpoints work for multiple repos.
- [x] Project-scoped ticket update modifies only the targeted repo.
- [x] Existing `tick` tests still pass.
- [x] `tick-report` tests pass with multi-repo and update-isolation coverage.

## Notes
Must preserve single-repo compatibility while enforcing single-instance semantics.

## Log
- 2026-03-05: created

- 2026-03-05: Implemented global daemon state, multi-project APIs/UI, and project-scoped ticket update isolation.
- 2026-03-05: Implemented single-instance stateless multi-repo support with project-scoped ticket updates and isolation tests.