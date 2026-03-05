# Migration Plan: Tick Tool

Migrate the `tick` issue tracking tool from `~/_scripts/tools/tick` into this repository with no behavior regression.

## Decisions Locked

1. Add a `package.json` for script standardization (`test` script required).
2. Keep `templates/` and `test/` at repository root to preserve source layout and compatibility.
3. Keep a shell entrypoint named `tick` at root and preserve executable permissions.

## Execution Steps

1. Initialize issue tracking (already done).
   - `_ISSUES/` exists.
   - Migration task exists and is in progress.
2. Copy source files with metadata preserved.
   - Source: `~/_scripts/tools/tick`
   - Command pattern: `rsync -a <source>/ ./`
   - Required artifacts:
     - `init.js`
     - `lib.js`
     - `list.js`
     - `new.js`
     - `update.js`
     - `tick`
     - `templates/`
     - `test/`
3. Update path-coupled code.
   - Replace hardcoded `~/_scripts/tools/tick` references with paths derived from script location.
   - At minimum update `tick`; inspect `test/run.js` and all copied JS files.
4. Add/update `package.json`.
   - Ensure `npm test` runs the tool test suite.
   - Keep dependency surface minimal.
5. Verify behavior and migration integrity.
   - `test -x ./tick`
   - `./tick -h`
   - `npm test` (or `node test/run.js` if needed during bootstrap)
   - `rg "~/_scripts/tools/tick|/Users/.*/_scripts/tools/tick" .`
     - Expected: no matches in tool code.
6. Update documentation.
   - `README.md` must include:
     - Purpose and scope of `tick`
     - Local usage (`./tick <command>`)
     - Test command (`npm test`)
     - Optional global usage via PATH/alias
7. Optional cleanup guidance.
   - Document how to repoint existing aliases or PATH entries from old location to this repo.

## Definition Of Done

1. All required files/directories are present in repo and runnable from local paths.
2. `tick` is executable and invokes local scripts only.
3. No hardcoded references to old absolute source path remain in migrated implementation.
4. Tool tests pass locally with exit code `0`.
5. `README.md` documents local and optional global usage plus testing.

## Risks And Mitigations

1. Hidden hardcoded paths outside the entrypoint.
   - Mitigation: repository-wide `rg` scan for source path patterns and patch all matches.
2. Behavior drift during migration.
   - Mitigation: run command parity checks (`-h`, new/list/update flows, tests).
3. Permission regression on shell entrypoint.
   - Mitigation: explicit `test -x ./tick` check and `chmod +x ./tick` if needed.
