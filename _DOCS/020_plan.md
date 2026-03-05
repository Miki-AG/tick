# Migration Plan: Tick Tool

Migrate the "tick" issue tracking tool from its current location in `~/_scripts/tools/tick` to this repository.

## Steps

1. **Initialize Issue Tracking**: (Done) Initialized `_ISSUES` in the current repository and created a task for the migration.
2. **Copy Files**: Copy all tool files from the source directory to the project root.
   - `init.js`
   - `lib.js`
   - `list.js`
   - `new.js`
   - `update.js`
   - `tick` (zsh entry point)
   - `templates/`
   - `test/`
3. **Update Entry Point**: Modify the `tick` zsh script to use relative paths instead of hardcoded `~/_scripts/tools/tick/` paths.
4. **Update Test Runner**: Review and update `test/run.js` if any other hardcoded paths are found (preliminary check looks okay).
5. **Verify Migration**: Run the tool's own tests using the local version.
6. **Documentation**: Update `README.md` with basic tool usage instructions.
7. **Cleanup (Optional)**: Instructions for the user to update their `PATH` or aliases if they want to use this version globally.

## Open issues

1. None at the moment.

## Questions

1. Should I add a `package.json` to manage dependencies (even if none currently exist)? Yes
2. Should I keep the `templates/` and `test/` directories in the root or move them to a `src/` or `tools/` subdirectory? (Currently assuming root to match source structure). Use sensible defaults.
