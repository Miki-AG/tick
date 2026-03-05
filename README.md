# tick

Local file-based issue tracker that stores tickets in `./_ISSUES`.

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

## Tests

```sh
npm test
```

Equivalent direct command:

```sh
node test/tick/run.js
```

## Optional global usage

If you want to call `tick` globally, add this repo to your `PATH` or set an alias:

```sh
alias tick="/Users/miguelarmengol/_dev/ocecat/tick/tick"
```

## Repository layout

- `tick`: zsh entrypoint
- `src/tick/tick`: command dispatcher
- `src/tick/*.js`: command implementation
- `src/tick/templates/`: issue file templates
- `test/tick/`: tool test scenarios and runner
- `_ISSUES/`: local ticket data for this repo
