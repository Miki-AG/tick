# Requirements: Support Multiple Repositories in `tick-report`

## Goal

Extend `tick-report` so a single running instance can track and serve multiple attached repositories and their UIs.

## Architecture Constraints (Mandatory)

1. Only one `tick-report` daemon instance may run at any time.
2. The running instance must be stateless as a request-serving process:
   - Any project UI request can be handled independently.
   - No per-UI in-memory session state is required to serve updates.
3. The single instance must provide updates to any attached project UI that requests them.
4. Running `tick-report start` from a second repository must not start another daemon:
   - It must attach/register that repository to the existing instance.
   - It must return output indicating that the existing instance was reused.

## Scope

In scope:

1. Landing page changes in `tick-report`.
2. Attach behavior when running `tick-report start` in any repository.
3. Per-project pages.
4. Detach behavior from the UI.
5. Single-instance process behavior.
6. Stateless multi-project update delivery.

Out of scope:

1. Changes to `tick` ticket schema.
2. Deleting or moving repository files on detach.
3. Redesigning all existing report UI components.

## Functional Requirements

1. Landing page (`/`) must show a list of attached projects.
2. Each project row must display:
   - Absolute repository path.
   - `GO` action to open that project page.
   - `DETACH` action to remove that project from attached list.
3. Running `tick-report start` in a repository must attach that repository to the single running instance.
4. Multiple repositories can be attached at the same time.
5. Each attached repository must have its own dedicated page.
6. `GO` must navigate to the corresponding project page in a new tab.
7. `DETACH` must:
   - Remove only the selected project from the attached list.
   - Not delete repository data.
   - Not modify the repository's `_ISSUES` files.
8. Re-attaching an already attached repository must be idempotent (no duplicates).
9. If no instance is running, `tick-report start` must start one; if an instance is running, `start` must reuse it.
10. Update endpoints must resolve project identity (for example project id/path) and return that project's data regardless of request origin.
11. Concurrent polling from multiple project pages must return correct project-specific updates.

## Behavior and Compatibility

1. Existing single-repository functionality must continue to work.
2. Existing report/ticket rendering within a project should remain consistent with current behavior.
3. If an attached path is no longer accessible, the UI must handle it gracefully (for example: visible error/status for that project, no server crash).
4. `tick-report status` must reflect a single global instance state, not per-repository daemon instances.

## UX Requirements

1. Landing page must prioritize repository selection/navigation.
2. `GO` and `DETACH` controls must be clearly visible for each project.
3. Detach action must provide immediate UI feedback (project removed from list or visible error message).
4. UI/CLI feedback must make it clear when a `start` call reused an existing instance.

## Non-Functional Requirements

1. Project list operations must not block the server for long-running filesystem checks.
2. Invalid detach/go requests must return clear client-facing errors.
3. Changes must not break existing `tick-report` start/stop/status command flows.
4. Multi-project update polling must remain stable under simultaneous requests.

## Acceptance Criteria

1. Starting `tick-report` in repository A, then running `start` in repository B, results in both projects attached but only one daemon process running.
2. Repeated `start` calls from different repositories attach projects without spawning additional instances.
3. Landing page shows repository path, `GO`, and `DETACH` for each attached project.
4. Clicking `GO` opens the correct project page and displays that repository's report data.
5. Clicking `DETACH` removes only that repository from the list and does not alter `_ISSUES` content.
6. Detached repository can be attached again via `tick-report start`.
7. Starting `tick-report` multiple times in the same repository does not create duplicates.
8. Two project pages polling concurrently receive correct project-specific updates from the same running instance.
9. Existing single-repo flows (`start`, `status`, `stop`) still pass smoke checks.
