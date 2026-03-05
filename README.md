# tick

`tick` is a text-based ticketing system designed for AI-agent workflows.

It provides:

- A simple executable (`./tick`) that makes it easy for AI agents to create, update, and track tickets.
- Full observability: there is no hidden runtime state; all ticket state lives in markdown files under `./_ISSUES`.
- A companion monitor (`tick-report`) for watching multiple `tick` projects simultaneously.

## Requirements

- Node.js 18+
- zsh (for the `./tick` entrypoint)

## Local usage

Run commands from this repository root:

```sh
./tick -h
./tick init
./tick new "Example issue" --priority p1 --owner codex --labels TASK
./tick list
./tick update 0001 --status doing --log "Started implementation"
```

## tick-report usage

Run report commands from any project root. `start` attaches that project to one global `tick-report` instance:

```sh
./tick-report -h
./tick-report start --host 127.0.0.1 --port 4174
./tick-report status
./tick-report stop
```

Behavior summary:

- Only one `tick-report` daemon runs at a time.
- Running `start` in another repo reuses the running daemon and attaches that repo.
- The same daemon serves updates for all attached project UIs.
- `tick-report` exposes a webpage per project that updates in real time as AI agents update tickets.
- Route behavior:
  - `/` shows attached projects only.
  - `/project/:projectId` shows tickets for one project only.
  - `/project/:projectId/ticket/:ticketId` shows the editable ticket detail view.
- Breadcrumbs are visible on every page (`tick-report` -> landing, project segment -> project page).
- Project page includes ticket filter controls (status toggles, label filter, min ticket id).
- Designed for Tailscale-first usage:
  - default host is your Tailscale IP when available,
  - any device on your tailnet can open the report URLs and see live updates.

## Tests

```sh
npm test
npm run test:tick-report
```

Equivalent direct command:

```sh
node test/tick/run.js
node test/tick-report/run.js
```

## Optional global usage

If you want to call `tick` globally, add this repo to your `PATH` or set an alias:

```sh
alias tick="/Users/<user>/_dev/ocecat/tick/tick"
alias tick-report="/Users/<user>/_dev/ocecat/tick/tick-report"
```

## Repository layout

- `tick`: zsh entrypoint
- `src/tick/tick`: command dispatcher
- `src/tick/*.js`: command implementation
- `src/tick/templates/`: issue file templates
- `test/tick/`: tool test scenarios and runner
- `tick-report`: root wrapper entrypoint
- `src/tick-report/`: `tick-report` implementation and web assets
- `test/tick-report/`: `tick-report` smoke tests
- `_ISSUES/`: local ticket data for this repo
