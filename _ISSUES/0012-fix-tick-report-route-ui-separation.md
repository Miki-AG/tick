---
id: 0012
title: Fix tick-report route UI separation
status: done
priority: p1
owner:codex
labels: [BUG]
created: 2026-03-05
updated: 2026-03-05
---

## Context
`tick-report` route rendering was mixed:
- `/` showed projects and tickets, and included a `VIEW` action.
- `/project/:id` showed both projects and tickets.
Required behavior:
- `/` must show only project list (no ticket list, no `VIEW` action).
- `/project/:id` must show only ticket list for the selected project.

## Acceptance criteria
- [x] `/` renders project table only (`id="project-rows"` present, ticket table `id="rows"` absent).
- [x] `/` does not render `VIEW` action.
- [x] `/project/:id` renders ticket table only (`id="rows"` present, project table `id="project-rows"` absent).
- [x] Automated tests cover route-specific HTML expectations.

## Notes
- Implemented route mode in server config (`landing` vs `project`).
- Updated shared report card partial to render one section per mode.
- Updated frontend script behavior to be mode-aware.

## Log
- 2026-03-05: created
- 2026-03-05: implemented route-mode rendering and removed `VIEW` action from landing page.
- 2026-03-05: added assertions in `test/tick-report/run.js` for both route HTML outputs.
- 2026-03-05: validated with `npm run test:tick-report` and `npm test`.
- 2026-03-05: refactored from shared index template to explicit `landing.ejs` and `project.ejs` templates.
