# Implementation Plan: Multi-Repo Support with Single Stateless `tick-report`

Implement `_DOCS/050_support_for_multiple_repos.REQUIREMENTS.md`.

## Decisions Locked

1. `tick-report` runs as one global daemon process at a time.
2. `start` from any repository either:
   - starts the global daemon (if none exists), then attaches that repository, or
   - reuses the existing daemon and only attaches that repository.
3. Daemon runtime metadata and attached-project registry are stored outside repository `_ISSUES` folders.
4. Request handling is stateless:
   - each API call carries/derives project identity,
   - no per-UI session memory is required to serve updates.
5. Existing CLI surface remains (`start`, `stop`, `status`, `serve`, `-h`).

## Target Runtime State

Use a global runtime directory (example: `~/.tick-report/`) with:

1. `daemon.json`:
   - `pid`, `host`, `port`, `startedAt`
2. `projects.json`:
   - attached project entries keyed by normalized absolute path/id
3. `tick-report.log`
4. optional lock file for atomic updates.

Notes:

1. Repository `_ISSUES` remains the project data source.
2. Attach/detach only updates global registry, never `_ISSUES` content.

## Execution Steps

1. Add global state helpers.
   - Create a new module for global state paths, read/write, and locking.
   - Normalize and validate repository paths.
2. Refactor process management to global single-instance semantics.
   - `start`: detect running daemon from global `daemon.json`.
   - If running: attach current repo, print "reused existing instance" output.
   - If not running: spawn daemon once, write global pid metadata, attach current repo.
   - `stop`: stop global daemon regardless of caller repository.
   - `status`: report global daemon status + attached project count.
3. Implement project registry operations.
   - `attachProject(repoPath)` idempotent.
   - `detachProject(projectId|repoPath)` for UI action.
   - `listProjects()` for landing page and API.
4. Update server routing/API for multi-project stateless access.
   - Add project list endpoint (for landing page).
   - Add project-specific endpoints (report/ticket read + ticket update) keyed by project id/path.
   - Keep backward compatibility where reasonable (redirect/alias legacy routes).
5. Update landing page and per-project navigation.
   - `/` shows attached projects with path + `GO` + `DETACH`.
   - `GO` opens project page in new tab.
   - `DETACH` calls API and refreshes list.
6. Handle inaccessible project paths gracefully.
   - Mark project status as unavailable in responses/UI.
   - Never crash server for one bad project path.
7. Preserve existing single-repo behavior.
   - If only one project attached, existing workflows still behave as expected.
8. Add/extend tests under `test/tick-report`.
   - single-instance enforcement tests,
   - attach/detach idempotency,
   - two-project concurrent polling correctness,
   - status/start/stop compatibility checks.
9. Update docs.
   - CLI behavior with global single-instance semantics.
   - attach/detach behavior and multi-project navigation.
   - troubleshooting (stale global pid/lock).

## Data/API Contract Proposal

1. `GET /api/projects`
   - returns attached projects with id, path, availability.
2. `POST /api/projects/attach`
   - body includes repository path (used by CLI and optional UI flows).
3. `POST /api/projects/:id/detach`
   - removes project from registry.
4. `GET /api/projects/:id/report`
   - returns report payload for selected project.
5. `GET /api/projects/:id/ticket/:ticketId`
   - returns ticket payload for selected project.
6. `POST` or `PATCH /api/projects/:id/ticket/:ticketId`
   - updates ticket fields for selected project only.
   - must reject requests that do not resolve to a valid attached project.

## Verification Plan

1. Single-instance check:
   - start in repo A, start in repo B, confirm one daemon pid.
2. Attach list check:
   - `/` lists both repos with path + GO + DETACH.
3. Project isolation check:
   - load two project pages, verify each shows correct repo-specific ticket data.
   - update a ticket in project A and verify project B ticket files remain unchanged.
4. Detach check:
   - detach one repo, confirm other remains and `_ISSUES` files unchanged.
5. Idempotency check:
   - repeated start in same repo does not duplicate entry.
6. CLI compatibility check:
   - `start`, `status`, `stop` still work from repo roots.
7. Regression check:
   - existing `tick` test suite still passes.

## Definition Of Done

1. One global daemon process enforces multi-repo support.
2. Attached projects are tracked in global state, not per-repo daemon state.
3. Server handles project requests statelessly and serves any attached project UI.
4. Landing page + GO/DETACH flows work and are tested.
5. Project-scoped ticket update endpoints work and preserve cross-project isolation.
6. Existing core CLI flows remain operational.
7. Documentation reflects final architecture and operations.

## Risks And Mitigations

1. Race conditions updating global registry.
   - Mitigation: atomic writes + lock strategy.
2. Stale pid/lock state after crashes.
   - Mitigation: robust stale detection + recovery on `start/status`.
3. Path normalization inconsistencies across symlinks.
   - Mitigation: canonicalize with `realpath` and store canonical path.
4. Backward compatibility regressions in existing API/UI.
   - Mitigation: compatibility routes + targeted regression tests.
