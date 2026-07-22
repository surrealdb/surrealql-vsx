# Makefile for the SurrealQL VS Code extension.
#
# Convenience wrapper around the bun-based build/lint/test scripts and
# packaging a local .vsix for manual testing (`make package`).

BUN     ?= bun
VSCE    := $(BUN)x @vscode/vsce
VSIX    := surrealql.vsix

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: install
install: ## Install dependencies
	$(BUN) install

.PHONY: build
build: ## Build the extension bundle (debug)
	$(BUN) run build

.PHONY: build-grammar
build-grammar: ## Regenerate the TextMate grammar keyword lists
	$(BUN) run build:grammar

.PHONY: typecheck
typecheck: ## Type-check without emitting
	$(BUN) run typecheck

.PHONY: lint
lint: ## Check lint/formatting rules
	$(BUN) run lint:check

.PHONY: test
test: ## Run the test suite
	$(BUN) run test

.PHONY: validate
validate: ## Run the full pre-publish validation (grammar, typecheck, lint, test, build)
	$(BUN) run validate

.PHONY: package
package: install ## Build a local .vsix for manual install/testing
	$(VSCE) package --no-dependencies --out $(VSIX)
	@echo "Built $(VSIX) — install with: code --install-extension $(VSIX)"

.PHONY: install-vsix
install-vsix: package ## Package and install the .vsix into the local VS Code
	code --install-extension $(VSIX)

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf dist $(VSIX)
