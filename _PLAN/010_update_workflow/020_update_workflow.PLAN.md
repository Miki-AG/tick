# Update Workflow Plan

## Objective

Extend `tick` from a ticket-only tracker into a combined planning + execution workflow with:

- interactive repo initialization
- `_TICKETS` as the canonical execution folder
- `_PLAN` and `_DOCS` as first-class modules
- WORKSTREAM / JOB ticket hierarchy
- template-backed commands for requirements, plans, and documentation
- `tick-report` support for WORKSTREAM-focused views
- repo documentation that teaches agents the full pipeline

## Scope

This plan covers:

- CLI behavior changes in `src/tick`
- ticket schema and storage changes
- new planning/documentation templates and generation commands
- `tick-report` backend and web UI changes
- tests and fixtures
- README updates and agent-facing guidance

This plan does not cover:

- automatic migration of existing project contents beyond lightweight `_ISSUES` compatibility if we choose to keep it during rollout
- changes to ticket IDs, status vocabulary, or priority vocabulary

## Proposed Decisions

### 1. Canonical execution folder is `_TICKETS`

- All new repos created by `tick init` will use `_TICKETS`.
- Internally, directory naming should be centralized so the code stops hardcoding `_ISSUES`.
- Recommended rollout: support `_ISSUES` as a legacy read fallback during migration, but only write new content to `_TICKETS`.

### 2. Ticket hierarchy is represented in front matter

Add these fields to ticket front matter:

- `type: workstream|job`
- `parent:` optional, only for JOBs; references a WORKSTREAM id
- `depends_on: []` optional list of ticket ids

Implications:

- WORKSTREAM children are derived from JOB `parent` references; they are not stored redundantly.
- `list` and `tick-report` can render type, parent, and dependencies without additional files.

### 3. Planning commands are explicit top-level commands

Add new CLI commands:

- `tick req <name>`
- `tick plan <name>`
- `tick doc <name>`

These commands should generate files from templates and keep naming deterministic.

### 4. Planning file placement follows the requested hierarchy

- `_PLAN/010_PRD.md` remains the high-level product document pattern.
- Feature-specific planning artifacts live under `_PLAN/<feature-slug>/`.
- Inside each feature folder:
  - `010_<feature>.REQ.md`
  - `020_<feature>.PLAN.md`
- `_DOCS/` contains post-implementation docs only.

## Workstreams

### Workstream 1. Normalize storage and shared constants

Update shared path logic so both `tick` and `tick-report` rely on one canonical ticket-directory name instead of scattered `_ISSUES` literals.

Primary files:

- `src/tick/lib.js`
- `src/tick/init.js`
- `src/tick/new.js`
- `src/tick/update.js`
- `src/tick/list.js`
- `src/tick/tick`
- `src/tick-report/lib/constants.js`
- `src/tick-report/lib/tickets.js`
- `src/tick-report/lib/ticket-editor.js`
- `src/tick-report/lib/cli.js`
- `src/tick-report/lib/global-state.js`
- `src/tick-report/lib/process-control.js`
- `src/tick-report/lib/server.js`

Deliverables:

- shared constant for `_TICKETS`
- optional `_ISSUES` legacy fallback strategy
- user-facing messages updated to `_TICKETS`

### Workstream 2. Make `tick init` interactive and module-aware

Change `tick init` so it prompts for:

- `1` ticketing only
- `2` planning only
- `3` both

Expected folder creation:

- ticketing only: `_TICKETS`
- planning only: `_PLAN`, `_DOCS`
- both: `_TICKETS`, `_PLAN`, `_DOCS`

Also create minimal README/index files in any created top-level folders so agents immediately know their purpose.

Primary files:

- `src/tick/init.js`
- `src/tick/tick`

Deliverables:

- interactive prompt flow
- initialization guards updated for the new folder combinations
- per-folder README bootstrapping

### Workstream 3. Extend ticket schema for WORKSTREAM and JOB

Update ticket creation, parsing, listing, and updating to support the new execution model.

Changes:

- rename the base ticket template from issue-oriented wording to ticket-oriented wording
- add `type`, `parent`, and `depends_on` front matter support
- allow `tick new` and `tick update` to set or modify those fields
- update `tick list` output to show ticket type and dependencies

Recommended CLI additions:

- `tick new "Title" --type workstream|job`
- `tick new "Title" --parent 0001`
- `tick new "Title" --depends-on 0002,0003`
- `tick update 0004 --type job --parent 0001 --depends-on 0002,0003`

Validation rules:

- WORKSTREAM cannot specify `parent`
- JOB `parent`, when present, must reference an existing WORKSTREAM
- `depends_on` ids must exist and cannot include self

Primary files:

- `src/tick/templates/issue.md` or renamed replacement
- `src/tick/lib.js`
- `src/tick/new.js`
- `src/tick/update.js`
- `src/tick/list.js`

Deliverables:

- updated markdown template
- new argument parsing and validation
- list output that exposes hierarchy-relevant metadata

### Workstream 4. Add planning/documentation templates and generators

Create template files under `src/tick/templates` for:

- requirements documents
- planning documents
- documentation documents

Add generation commands that:

- slugify the feature/doc name
- create the expected folder under `_PLAN` when needed
- assign deterministic numbered filenames
- avoid overwriting existing files

Primary files:

- `src/tick/templates/`
- new command modules under `src/tick/`
- `src/tick/tick`

Deliverables:

- `req` generator
- `plan` generator
- `doc` generator
- stable naming rules for feature folders and document filenames

### Workstream 5. Update `tick-report` for WORKSTREAM views

Extend report data shaping and UI filtering so a user can select one WORKSTREAM and see:

- the WORKSTREAM itself
- all JOBs whose `parent` points to that WORKSTREAM

Changes:

- include `type`, `parent`, and `depends_on` in report payloads
- expose WORKSTREAM selection/filter controls in the project view
- render hierarchy/dependency information in table rows or related UI affordances

Primary files:

- `src/tick-report/lib/tickets.js`
- `src/tick-report/web/src/lib/types.ts`
- `src/tick-report/web/src/pages/project-page.tsx`
- `src/tick-report/web/src/pages/ticket-page.tsx`
- legacy UI files under `src/tick-report/files/` if legacy mode remains supported

Deliverables:

- extended ticket payload shape
- project-page WORKSTREAM filter
- UI visibility of JOB membership and dependencies

### Workstream 6. Update tests and fixtures

The current test suite is tightly coupled to `_ISSUES`, issue wording, and the current ticket schema. It needs a coordinated update.

Changes:

- update `test/tick/run.js` and `test/tick-report/run.js` for `_TICKETS`
- migrate scenario fixtures from `start-issues` / `expected-results-issues` naming if we want full consistency
- add coverage for interactive init
- add coverage for WORKSTREAM/JOB validation and list output
- add coverage for planning/doc generation commands
- add report tests for WORKSTREAM filtering

Deliverables:

- green `npm test`
- green `npm run test:tick-report`
- new scenarios for the added workflow

### Workstream 7. Rewrite agent-facing documentation

The README update is part of the core deliverable, not a cleanup task.

Documentation changes:

- rewrite the root `README.md` around the new pipeline
- add an index near the top that points agents to the right document for planning, tickets, and implementation docs
- add focused READMEs in:
  - `_PLAN/`
  - `_TICKETS/`
  - `_DOCS/`

Required content:

- naming conventions
- when to create PRD vs REQ vs PLAN vs ticket vs DOC
- how WORKSTREAM/JOB hierarchy should be used
- exact pipeline from idea to implementation to documentation
- examples of the new commands

## Suggested Implementation Order

1. Centralize directory constants and decide whether `_ISSUES` fallback stays during migration.
2. Update `tick init` so new repos bootstrap the correct folder structure and top-level READMEs.
3. Extend ticket schema and command parsing for WORKSTREAM/JOB plus dependencies.
4. Add planning/documentation templates and generators.
5. Update `tick-report` data parsing and UI for WORKSTREAM selection.
6. Rewrite docs after the command surface and naming rules are stable.
7. Finish by updating and expanding tests across both CLIs.

## Validation

Minimum validation before merge:

- `tick init` works for all 3 interactive choices
- `tick new`, `tick update`, and `tick list` correctly handle `type`, `parent`, and `depends_on`
- planning/documentation generators create the expected files and refuse invalid duplicates
- `tick-report` shows a WORKSTREAM-scoped view with its JOBs
- root and folder READMEs reflect the implemented command surface and file layout
- `npm test`
- `npm run test:tick-report`
- `npm run build:tick-report-web`

## Risks

- Interactive `init` will require test harness changes because current tests assume non-interactive execution.
- `_ISSUES` is hardcoded across CLI, report backend, report frontend labels, and tests; partial migration will leave the product inconsistent.
- WORKSTREAM/JOB semantics can get muddled if validation rules are too loose, especially around JOB parents and dependency cycles.
- README quality matters here because the user explicitly wants agents to follow the workflow without guesswork.

## Definition of Done

This feature is done when:

- a new repo can be initialized as ticketing-only, planning-only, or both
- ticketing uses `_TICKETS` and supports WORKSTREAM/JOB hierarchy
- planning/documentation docs can be generated from templates
- `tick-report` can focus on one WORKSTREAM and show its JOBs
- tests cover the new flow
- agents can learn the workflow by following the README hierarchy without needing extra tribal knowledge
