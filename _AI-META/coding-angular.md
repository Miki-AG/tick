# agents.md — Angular (Miguel)

## Mission
Ship clean, testable Angular 20 code with minimal ceremony and predictable structure.

## Non-negotiables
- **Angular 20 syntax**: use `@if`, `@for`, standalone APIs.
- **Standalone everywhere**: pages + components are standalone (no NgModules unless forced by a lib).
- **No corporate lingo.** Say what you mean.
- Stay **strictly within scope** of the ticket/task.

## Project structure conventions
- Pages live in `pages/`.
  - Each page has its own folder: `pages/<name>/<name>.page.ts` (and html/scss if used).
- Shared code:
  - `core/guards/` for guards
  - `core/models/` for models
  - Prefer `core/services/` for app-wide services

## State + reactivity
- Keep state changes explicit and debuggable.
- Use Signals when possible
- If building custom state management: keep it minimal and **avoid RxJS-heavy frameworks** (unless the task explicitly wants RxJS).

## UI patterns
- Keep templates clean; move logic to TS; avoid clever template hacks.

## PR quality bar
- Types are explicit.
- Tests prove behavior.
- No random refactors outside the ticket.
