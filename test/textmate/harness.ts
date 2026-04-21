/**
 * vscode-textmate + Oniguruma: tokenize SurrealQL like VS Code and query scopes.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vscodeOniguruma from "vscode-oniguruma";
import type { IGrammar } from "vscode-textmate";
import vscodeTextmate from "vscode-textmate";

const { Registry, INITIAL, parseRawGrammar } = vscodeTextmate;
const { loadWASM, createOnigScanner, createOnigString } = vscodeOniguruma;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
await loadWASM(readFileSync(wasmPath).buffer);

const onigLib = Promise.resolve({
	createOnigScanner: (patterns: string[]) => createOnigScanner(patterns),
	createOnigString: (str: string) => createOnigString(str),
});

const registry = new Registry({
	onigLib,
	loadGrammar: async (scopeName: string) => {
		if (scopeName === "source.surrealql") {
			return parseRawGrammar(
				readFileSync(join(repoRoot, "syntaxes/surrealql.tmLanguage.json"), "utf8"),
				"surrealql.tmLanguage.json",
			);
		}
		if (scopeName === "source.js") {
			return parseRawGrammar(
				readFileSync(join(__dirname, "stub-js.tmLanguage.json"), "utf8"),
				"stub-js.tmLanguage.json",
			);
		}
		return null;
	},
});

const loaded = await registry.loadGrammar("source.surrealql");
if (!loaded) {
	throw new Error("Failed to load source.surrealql grammar");
}

/** Loaded SurrealQL grammar (same engine as VS Code). */
export const grammar: IGrammar = loaded;

export type TokenRow = {
	line: number;
	text: string;
	tokens: { startIndex: number; endIndex: number; scopes: string[] }[];
};

/** Deepest scope on a span (what you usually care about for highlighting). */
export function deepestScope(scopes: string[]): string {
	return scopes[scopes.length - 1] ?? "source.surrealql";
}

/** Tokenize a full document; rule stack carries across lines (blocks, strings, etc.). */
export function tokenizeDocument(source: string): TokenRow[] {
	const lines = source.split(/\r?\n/);
	let ruleStack = INITIAL;
	const out: TokenRow[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const { tokens, ruleStack: next } = grammar.tokenizeLine(line, ruleStack);
		ruleStack = next;
		out.push({ line: i + 1, text: line, tokens });
	}
	return out;
}

/** Scope at 0-based column on a single line (use for one-line snippets). */
export function scopeAtColumn(line: string, column: number): string {
	const { tokens } = grammar.tokenizeLine(line, INITIAL);
	for (const t of tokens) {
		if (t.startIndex <= column && column < t.endIndex) {
			return deepestScope(t.scopes);
		}
	}
	return "source.surrealql";
}

/**
 * Scope at the start of the `occurrence`th match of `needle` in `source`.
 * `source` may be multi-line; stack is carried between lines.
 */
export function scopeForSubstring(source: string, needle: string, occurrence = 0): string {
	let start = 0;
	let found = -1;
	for (let i = 0; i <= occurrence; i++) {
		found = source.indexOf(needle, start);
		if (found < 0) {
			throw new Error(
				`Substring not found: ${JSON.stringify(needle)} (occurrence ${occurrence})`,
			);
		}
		start = found + 1;
	}
	return scopeAtOffset(source, found);
}

/**
 * Map byte offset in `source` to line index + column (for `\n` / `\r\n` line endings).
 */
function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
	if (offset < 0 || offset > source.length) {
		throw new Error(`Offset ${offset} out of range (length ${source.length})`);
	}
	const before = source.slice(0, offset);
	const lines = before.split(/\r\n|\n|\r/);
	const last = lines.at(-1) ?? "";
	return { line: lines.length - 1, col: last.length };
}

/** Scope at 0-based byte offset in `source` (multi-line; stack carried across lines). */
export function scopeAtOffset(source: string, offset: number): string {
	const { line: lineIdx, col } = offsetToLineCol(source, offset);
	const allLines = source.split(/\r\n|\n|\r/);
	let ruleStack = INITIAL;
	for (let i = 0; i < lineIdx; i++) {
		const line = allLines[i] ?? "";
		const { ruleStack: next } = grammar.tokenizeLine(line, ruleStack);
		ruleStack = next;
	}
	const line = allLines[lineIdx] ?? "";
	const { tokens } = grammar.tokenizeLine(line, ruleStack);
	for (const t of tokens) {
		if (t.startIndex <= col && col < t.endIndex) {
			return deepestScope(t.scopes);
		}
	}
	return "source.surrealql";
}

/** Non-overlapping spans for one line: text + deepest scope. */
export function lineTokenParts(line: string): { text: string; scope: string }[] {
	const { tokens } = grammar.tokenizeLine(line, INITIAL);
	return tokens.map((t) => ({
		text: line.slice(t.startIndex, t.endIndex),
		scope: deepestScope(t.scopes),
	}));
}

/**
 * Share of characters that only have the root `source.surrealql` scope
 * (rough “unhighlighted” metric for regression guarding).
 */
export function unscopedRatio(source: string): number {
	const rows = tokenizeDocument(source);
	let total = 0;
	let unscoped = 0;
	for (const row of rows) {
		for (const t of row.tokens) {
			const len = t.endIndex - t.startIndex;
			total += len;
			if (deepestScope(t.scopes) === "source.surrealql" && len > 0) {
				unscoped += len;
			}
		}
	}
	return total ? unscoped / total : 0;
}
