# Requirements: `tick-report` Migration

Migrate the `tick-report` tool from `~/_scripts/tools/tick-report` into this repository with behavior parity and no hardcoded dependency on the old location.

## Goal

Make this repository the canonical source for `tick-report` while preserving current CLI behavior (`start`, `stop`, `status`, `serve`, `-h`/`help`) and compatibility with the existing `_ISSUES` + `status.json` workflow.

## Scope

In scope:

1. Copy `tick-report` source and assets into this repo.
2. Rewire all runtime path resolution to repository-local files.
3. Keep a root CLI entrypoint named `tick-report`.
4. Place implementation sources under `src/tick-report`.
5. Place tests under `test/tick-report`.
6. Add documentation and repeatable verification commands.

Out of scope:

1. Changing ticket data model or `_ISSUES` file format.
2. Redesigning the HTML/CSS templates.
3. Removing `~/_scripts/tools/tick-report` automatically without explicit user request.

## Source Inventory (Current Tool)

Expected source to migrate from `~/_scripts/tools/tick-report`:

1. `tick-report` (Node CLI entrypoint)
2. `lib/` (CLI parsing, daemon control, server, template rendering, ticket parsing/editing)
3. `files/` (HTML/CSS/templates/client JS)

## Functional Requirements

1. CLI command parity:
   - Support: `tick-report start`, `tick-report stop`, `tick-report status`, `tick-report serve`, `tick-report -h`.
2. Runtime behavior parity:
   - Continue reading tickets from `./_ISSUES/*.md`.
   - Continue reading optional status updates from `./_ISSUES/status.json`.
   - Continue honoring popup format in `status.json` (`info|warn|error`).
3. Daemon lifecycle parity:
   - `start` writes and uses PID metadata in current working directory.
   - `stop` stops previously started process cleanly.
   - `status` reflects actual process state for current directory.
4. Serving parity:
   - Foreground server via `serve`.
   - Default port and interval behavior remain unchanged unless explicitly configured.
   - `--host`, `--port`, `--interval` option validation remains unchanged.
5. Local path safety:
   - No runtime reference to `~/_scripts/tools/tick-report` or any absolute source-path coupling.
6. Repository layout:
   - Source implementation in `src/tick-report/`.
   - Test suite in `test/tick-report/`.
   - Root wrapper executable `./tick-report` delegates to local source.

## Non-Functional Requirements

1. Migration must preserve executable permissions on entrypoints.
2. Migration must avoid introducing unnecessary external dependencies.
3. Documentation must be sufficient for local usage without external setup.
4. Existing `tick` tool behavior must remain unaffected.

## Deliverables

1. Migrated code under `src/tick-report/`.
2. Test assets and runner under `test/tick-report/`.
3. Root wrapper `./tick-report`.
4. Updated `README.md` section for `tick-report` usage and verification.
5. `package.json` scripts for `tick-report` verification (or equivalent documented command).

## Acceptance Criteria (Verifiable)

1. `./tick-report -h` exits successfully and lists expected commands.
2. `./tick-report status` runs from repo root without referencing old path.
3. `rg "~/_scripts/tools/tick-report|/Users/.*/_scripts/tools/tick-report" src/tick-report test/tick-report tick-report` returns no matches.
4. Local smoke flow passes:
   - start daemon
   - check status
   - stop daemon
   - check status again
5. Any `tick-report` tests/smoke checks defined in this repo pass with exit code `0`.
6. Documentation reflects final paths (`src/tick-report`, `test/tick-report`, `./tick-report`).
