# Migration Plan: `tick-report`

Implement the migration defined in `_DOCS/030_tick-repot_migration.REQUIREMENTS.md`.

## Decisions Locked

1. Keep `./tick-report` as the root executable entrypoint.
2. Place implementation code under `src/tick-report/`.
3. Place tests and smoke checks under `test/tick-report/`.
4. Do not delete `~/_scripts/tools/tick-report` automatically; keep cleanup as explicit opt-in.

## Execution Steps

1. Initialize migration tracking.
   - Create/update ticket in `./_ISSUES`.
   - Set status to `doing`.
2. Copy source from old location.
   - Source: `~/_scripts/tools/tick-report`
   - Copy with metadata preserved (`rsync -a`).
   - Required copied artifacts:
     - `tick-report`
     - `lib/`
     - `files/`
3. Reorganize repository layout.
   - Move migrated implementation to `src/tick-report/`.
   - Keep executable permissions on entrypoint script(s).
4. Add root wrapper.
   - Create `./tick-report` wrapper that delegates to local implementation under `src/tick-report/`.
   - Ensure wrapper is executable (`chmod +x ./tick-report`).
5. Remove old-path coupling.
   - Verify no runtime reference to `~/_scripts/tools/tick-report`.
   - Fix any absolute path use to script-relative/project-relative resolution.
6. Add/relocate test assets.
   - Create `test/tick-report/` runner and smoke checks.
   - Ensure tests execute local `./tick-report` or `src/tick-report/tick-report`.
7. Update package scripts.
   - Add a `tick-report` test/smoke command (for example `npm run test:tick-report`).
   - Keep existing `tick` tests working.
8. Update documentation.
   - Add/extend `README.md` with:
     - `tick-report` purpose
     - local usage commands
     - start/stop/status workflow
     - test command(s)
9. Verify migration.
   - `./tick-report -h`
   - `./tick-report status`
   - Start/stop smoke flow:
     - `./tick-report start ...`
     - `./tick-report status`
     - `./tick-report stop`
     - `./tick-report status`
   - `rg "~/_scripts/tools/tick-report|/Users/.*/_scripts/tools/tick-report" src/tick-report test/tick-report tick-report`
     - Expected: no matches.
   - Run `tick` tests and `tick-report` tests.
10. Close tracking ticket.
    - Mark acceptance criteria complete.
    - Set status `done`.
    - Update `_ISSUES/status.json` completion message.

## Definition Of Done

1. `tick-report` source is present and runnable from `src/tick-report/`.
2. `./tick-report` works from repository root.
3. Tests/smoke checks for `tick-report` exist under `test/tick-report/` and pass.
4. No hardcoded dependency on `~/_scripts/tools/tick-report` remains in migrated code.
5. `README.md` documents `tick-report` usage and verification commands.
6. Existing `tick` tool behavior remains intact.

## Risks And Mitigations

1. Background process orphaning during smoke tests.
   - Mitigation: always run `status` after `stop`; kill stale PID if required.
2. Hidden absolute path references in helper modules.
   - Mitigation: repository-wide `rg` scan for old path patterns.
3. Regression in existing `tick` tooling.
   - Mitigation: run existing `tick` test suite after `tick-report` integration.
