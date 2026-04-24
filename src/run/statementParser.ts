/**
 * A single SurrealQL statement extracted from a document.
 *
 * `startOffset` and `endOffset` are character offsets into the original document
 * text (endOffset is exclusive — one past the last character of the statement
 * including the trailing `;`).
 */
export interface StatementRange {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly queryText: string;
}

/**
 * Splits `text` into individual SurrealQL statements by locating `;` delimiters
 * at depth 0 (i.e. not inside `()`, `[]`, `{}`, string literals, or comments).
 *
 * Handles:
 *  - Single-quoted, double-quoted, and backtick-quoted strings with backslash escapes
 *  - `--` and `#` single-line comments
 *  - Block comments
 *  - Nested bracket depth
 *
 * A trailing statement without a terminating `;` is also returned. This is a
 * direct port of `StatementParser.kt` from the JetBrains plugin.
 */
export function findStatements(text: string): StatementRange[] {
	const results: StatementRange[] = [];
	let depth = 0;
	let inString: string | null = null;
	let inLineComment = false;
	let inBlockComment = false;
	let statementStart = skipWhitespace(text, 0);
	let i = 0;

	while (i < text.length) {
		const ch = text[i];
		const next = i + 1 < text.length ? text[i + 1] : "\u0000";

		if (inString !== null) {
			if (ch === "\\" && inString !== "`") {
				i++;
			} else if (ch === inString) {
				inString = null;
			}
		} else if (inLineComment) {
			if (ch === "\n") inLineComment = false;
		} else if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i++;
			}
		} else if (ch === "-" && next === "-") {
			inLineComment = true;
			i++;
		} else if (ch === "#") {
			inLineComment = true;
		} else if (ch === "/" && next === "*") {
			inBlockComment = true;
			i++;
		} else if (ch === "'" || ch === '"' || ch === "`") {
			inString = ch;
		} else if (ch === "(" || ch === "[" || ch === "{") {
			depth++;
		} else if (ch === ")" || ch === "]" || ch === "}") {
			if (depth > 0) depth--;
		} else if (ch === ";" && depth === 0) {
			const endOffset = i + 1;
			const stmtText = text.substring(statementStart, endOffset).trim();
			if (stmtText.length > 0 && stmtText !== ";") {
				results.push({ startOffset: statementStart, endOffset, queryText: stmtText });
			}
			statementStart = skipWhitespace(text, endOffset);
		}

		i++;
	}

	if (statementStart < text.length) {
		const trailing = text.substring(statementStart).trim();
		if (trailing.length > 0) {
			results.push({
				startOffset: statementStart,
				endOffset: text.length,
				queryText: trailing,
			});
		}
	}

	return results;
}

function skipWhitespace(text: string, from: number): number {
	let i = from;
	while (i < text.length && /\s/.test(text[i] ?? "")) i++;
	return i;
}

const NS_REGEX = /\bUSE\s+(?:NS|NAMESPACE)\s+(`[^`]+`|"[^"]+"|'[^']+'|[\w-]+)/gi;
const DB_REGEX = /\bUSE\s+(?:DB|DATABASE)\s+(`[^`]+`|"[^"]+"|'[^']+'|[\w-]+)/gi;

/**
 * Result of scanning the document for `USE NS` / `USE DB` directives.
 *
 * Each value is either a non-empty unquoted string, or `null` when no
 * directive of that kind is present in the document.
 */
export interface UseDirectives {
	readonly namespace: string | null;
	readonly database: string | null;
}

/**
 * Scans `text` for `USE NS <value>` / `USE NAMESPACE <value>` and
 * `USE DB <value>` / `USE DATABASE <value>` directives (case-insensitive).
 *
 * Returns the **last** occurrence of each so that a file which re-selects
 * the namespace or database mid-way still produces a consistent value. The
 * returned strings have surrounding quotes/backticks stripped.
 */
export function extractUseDirectives(text: string): UseDirectives {
	return {
		namespace: lastMatch(text, NS_REGEX),
		database: lastMatch(text, DB_REGEX),
	};
}

function lastMatch(text: string, regex: RegExp): string | null {
	regex.lastIndex = 0;
	let last: string | null = null;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec() loop
	while ((m = regex.exec(text)) !== null) {
		last = (m[1] ?? "").replace(/^[`"']|[`"']$/g, "");
	}
	if (last === null) return null;
	const trimmed = last.trim();
	return trimmed.length > 0 ? trimmed : null;
}
