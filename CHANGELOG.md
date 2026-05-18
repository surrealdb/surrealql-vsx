# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-04-29

### Added

- **Language Server Integration**: Full Language Server Protocol (LSP) support for enhanced code intelligence
  - Diagnostics for syntax errors and warnings
  - Intelligent code completion
  - Hover information for language constructs
  - Go-to-definition navigation
  - Find all references functionality
  - Binary automatically downloaded from GitHub releases on first activation and cached locally

- **Run Query Feature**: Code lens (`▶ Run`) above every top-level statement in `.surql` and `.surrealql` files
  - Execute queries directly from the editor
  - Results displayed in dedicated SurrealQL Results panel
  - Support for `USE NS` / `USE DB` directives in files

- **SurrealQL Results Panel**: New bottom-panel view for query history and results
  - Display up to 50 executed queries
  - Toggle between table and JSON detail views
  - Easy query management and review

- **Status Bar Widget**: Quick access indicator showing active connection
  - Displays `endpoint | namespace/database`
  - Click to open SurrealQL settings page

- **Comprehensive Configuration Settings**: New `surrealql.*` settings for:
  - Language server control (`surrealql.lsp.enable`, `surrealql.lsp.version`, `surrealql.lsp.binaryPath`)
  - Database connection (`surrealql.connection.endpoint`, `surrealql.connection.namespace`, `surrealql.connection.database`, `surrealql.connection.username`, `surrealql.connection.password`)
  - Authentication context (`surrealql.connection.authContext`)
  - Schema inference mode (`surrealql.inference.mode`)

- **Build Improvements**: ESBuild configuration for optimized extension bundling
  - Improved build process with watch mode
  - Production-ready compilation

### Changed

- Updated minimum VS Code version requirement to 1.77.0
- Enhanced extension architecture for better maintainability

### Technical

- Implemented TypeScript for type-safe development
- Added Biome for code linting and formatting
- TextMate tests for syntax highlighting validation
- Bun as the package manager and build tool

## [0.3.0] - Previous Release

For changes in previous versions, please refer to the [GitHub releases page](https://github.com/surrealdb/surrealql-grammar/releases).
