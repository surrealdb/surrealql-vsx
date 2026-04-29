# SurrealQL for Visual Studio Code

VS Code extension for [SurrealQL](https://surrealdb.com), the query language for SurrealDB.

## Features

- **Syntax highlighting** via a TextMate grammar (also injected into Markdown code fences and JS/TS template literals).
- **Snippets** for common SurrealQL constructs.
- **Language server** (`surrealql-language-server`) for diagnostics, completion, hover, go-to-definition, and references. The binary is downloaded from GitHub releases on first activation and cached under VS Code's global storage.
- **Run Query** — a `▶ Run` code lens above every top-level statement in `.surql` / `.surrealql` files. Clicking it executes that statement against the configured SurrealDB endpoint.
- **SurrealQL Results** panel — bottom-panel view that displays a history of executed queries (max 50) with a table or JSON detail view.
- **Status bar widget** — shows the active connection (`endpoint | namespace/database`); clicking opens the SurrealQL settings page.

## Settings

All settings live under the `surrealql.*` key.

| Setting | Default | Description |
|---|---|---|
| `surrealql.lsp.enable` | `true` | Enable the language server. |
| `surrealql.lsp.version` | `"latest"` | Pin a specific language-server release tag. |
| `surrealql.lsp.binaryPath` | `""` | Override the auto-downloaded binary with a local path. |
| `surrealql.connection.endpoint` | `"http://localhost:8000"` | SurrealDB HTTP endpoint. |
| `surrealql.connection.namespace` | `""` | Default namespace. |
| `surrealql.connection.database` | `""` | Default database. |
| `surrealql.connection.username` | `"root"` | HTTP Basic auth username. |
| `surrealql.connection.password` | `"root"` | HTTP Basic auth password. |
| `surrealql.connection.authContext` | `"root"` | One of `root`, `namespace`, `database`, `record`. |
| `surrealql.inference.mode` | `"both"` | Schema inference source: `both`, `workspace`, or `db`. |

`USE NS` / `USE DB` directives in the file override the namespace/database settings when running individual statements.

## Development

Install [Bun](https://bun.sh) (see `packageManager` in `package.json` for the pinned version). From the repo root:

```sh
bun install
bun run validate
```

`validate` runs TypeScript (`tsc --noEmit`), [Biome](https://biomejs.dev) (`biome check` on `src/**`, `test/**`, and a few config files), the TextMate tests, and the esbuild bundle. Lint-only (no formatter): `bun run lint:check` / `bun run lint:apply` / `bun run lint:apply:unsafe`. Use `bun run test` for tests only and `bun run build` (or `bun run build:watch`) to produce/refresh `dist/extension.js`.

To launch the extension in a development host, open the repo in VS Code and use the **Run Extension** launch configuration in `.vscode/launch.json`.

TextMate highlighting is covered by assertion-based tests under `test/textmate/` (`bun run test:textmate`), using the same `vscode-textmate` + Oniguruma stack as VS Code. Helpers live in `test/textmate/harness.ts`.

### Building a VSIX for Local Testing

To package the extension as a `.vsix` file that can be tested locally:

1. **Build the extension** (production-optimized):
   ```sh
   bun run vscode:prepublish
   ```

2. **Install `vsce`** (Visual Studio Code Extension CLI):
   ```sh
   npm install -g @vscode/vsce
   ```
   Or if you prefer Bun:
   ```sh
   bun add -g @vscode/vsce
   ```

3. **Package the extension**:
   ```sh
   vsce package
   ```
   This generates a `.vsix` file (e.g., `surrealql-0.4.0.vsix`) in the repo root.

4. **Install the extension locally** in VS Code:
   - Open VS Code
   - Go to the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
   - Click the **...** menu and select **Install from VSIX...**
   - Select the generated `.vsix` file
   - Reload VS Code if prompted

Alternatively, install from the command line:
```sh
code --install-extension ./surrealql-0.4.0.vsix
```

After installation, test the extension features:
- Open or create a `.surql` or `.surrealql` file
- Verify syntax highlighting works
- Check that code snippets are available (press `Ctrl+Space` / `Cmd+Space`)
- Ensure the language server runs (check the SurrealQL status bar indicator)
- Test the **Run Query** code lens on statements
- Connect to a SurrealDB instance and verify query execution in the results panel

To uninstall the local extension:
```sh
code --uninstall-extension surrealdb.surrealql
```

## Credits

This grammar was originally inspired by [Mathe42](https://github.com/mathe42)'s work. You can find his work [here on GitHub](https://github.com/surrealdb-community/surrealql_vscode).
