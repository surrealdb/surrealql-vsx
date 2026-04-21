# SurrealQL grammar

SurrealQL is the SQL-like language used by [SurrealDB](https://surrealdb.com). This repository holds its grammar definition, implementing the textmate-grammar specification.

## Getting started

The grammar is mainly written for the [Visual Studio Code](https://code.visualstudio.com/) editor. It is easiest to change the grammar there and to debug it. 

To get started:
- Clone this repository (https://github.com/surrealdb/surrealql-grammar)
- Open the cloned folder in VScode
- Open the debug panel from the left sidebar
- In the middle top of the opened pane, open the (green) start button
- A new window should pop up. Open a SurrealQL file to edit it and see the grammar in action.

## Development

Install [Bun](https://bun.sh) (see `packageManager` in `package.json` for the pinned version). From the repo root:

```sh
bun install
bun run validate
```

`validate` runs TypeScript (`tsc --noEmit`), full [Biome](https://biomejs.dev) (`biome check` on `test/**/*.ts` and a few config files), then the TextMate tests. Lint-only (no formatter), matching the CodeMirror repo: `bun run lint:check` / `bun run lint:apply` / `bun run lint:apply:unsafe`. Use `bun run test` for tests only.

TextMate highlighting is covered by assertion-based tests under `test/textmate/` (`bun run test:textmate`), using the same `vscode-textmate` + Oniguruma stack as VS Code. Helpers live in `test/textmate/harness.ts`.

## Credits

This grammar was originally inspired by [Mathe42](https://github.com/mathe42)'s work. You can find his work [here on GitHub](https://github.com/surrealdb-community/surrealql_vscode).
