/**
 * Multi-token line-comment toggling for SurrealQL.
 *
 * SurrealQL accepts three line-comment markers (`--`, `//` and `#`), but a VS
 * Code language configuration can declare only a single `lineComment` token,
 * so the built-in "Toggle Line Comment" action recognises `--` alone and
 * stacks a second marker on top of `//` or `#` comments instead of removing
 * them. The `surrealql.toggleLineComment` command (bound to the same keys as
 * the built-in action in `package.json`) uncomments any of the three markers
 * and comments with the canonical `--`.
 *
 * This module is deliberately free of `vscode` imports so the edit
 * computation can be unit-tested outside the extension host; the thin editor
 * wiring lives in `extension.ts`.
 */

export const TOGGLE_LINE_COMMENT_COMMAND = "surrealql.toggleLineComment";

/** Line-comment markers SurrealQL accepts. */
export const LINE_COMMENT_TOKENS = ["--", "//", "#"] as const;

/** Marker inserted when commenting, matching `language-configuration.json`. */
export const DEFAULT_LINE_COMMENT = "--";

/** A run of consecutive lines covered by one selection, 0-based inclusive. */
export interface LineRange {
	startLine: number;
	endLine: number;
}

export type ToggleEdit =
	| { kind: "insert"; line: number; character: number; text: string }
	| { kind: "delete"; line: number; startCharacter: number; endCharacter: number };

/**
 * Lines a selection toggles. A multi-line selection whose end sits at column
 * 0 excludes that final line, matching the built-in action.
 */
export function selectionLineRange(
	startLine: number,
	endLine: number,
	endCharacter: number,
): LineRange {
	if (endLine > startLine && endCharacter === 0) {
		return { startLine, endLine: endLine - 1 };
	}
	return { startLine, endLine };
}

interface AnalyzedLine {
	line: number;
	text: string;
	/** Offset of the first non-whitespace character, or -1 for blank lines. */
	indent: number;
	/** The comment marker the line starts with, if any. */
	token: string | undefined;
}

function analyzeLine(line: number, text: string): AnalyzedLine {
	const indent = text.search(/\S/);
	const token =
		indent === -1
			? undefined
			: LINE_COMMENT_TOKENS.find((candidate) => text.startsWith(candidate, indent));
	return { line, text, indent, token };
}

/**
 * Compute the edits that toggle line comments across the given ranges.
 *
 * Mirrors the built-in "Toggle Line Comment" semantics, per range: when every
 * non-blank line already starts with one of the SurrealQL markers the markers
 * are removed (each line keeps its own style), otherwise every non-blank line
 * gains a `--` marker aligned at the block's minimum indentation — including
 * already-commented lines, so toggling twice restores the original text.
 * Blank lines are skipped unless the range contains nothing else, in which
 * case they are commented so a lone cursor on an empty line still produces a
 * marker. Lines claimed by an earlier range are skipped so overlapping
 * multi-cursor selections never produce conflicting edits.
 */
export function computeToggleEdits(
	getLineText: (line: number) => string,
	ranges: readonly LineRange[],
	insertSpace = true,
): ToggleEdit[] {
	const edits: ToggleEdit[] = [];
	const marker = insertSpace ? `${DEFAULT_LINE_COMMENT} ` : DEFAULT_LINE_COMMENT;
	const claimed = new Set<number>();

	for (const range of ranges) {
		const lines: AnalyzedLine[] = [];
		for (let line = range.startLine; line <= range.endLine; line++) {
			if (claimed.has(line)) continue;
			claimed.add(line);
			lines.push(analyzeLine(line, getLineText(line)));
		}

		const content = lines.filter((entry) => entry.indent !== -1);
		if (content.length === 0) {
			for (const entry of lines) {
				edits.push({
					kind: "insert",
					line: entry.line,
					character: entry.text.length,
					text: marker,
				});
			}
			continue;
		}

		if (content.every((entry) => entry.token !== undefined)) {
			for (const entry of content) {
				if (entry.token === undefined) continue;
				const startCharacter = entry.indent;
				let endCharacter = startCharacter + entry.token.length;
				if (insertSpace && entry.text.charAt(endCharacter) === " ") {
					endCharacter += 1;
				}
				edits.push({ kind: "delete", line: entry.line, startCharacter, endCharacter });
			}
		} else {
			const character = Math.min(...content.map((entry) => entry.indent));
			for (const entry of content) {
				edits.push({ kind: "insert", line: entry.line, character, text: marker });
			}
		}
	}

	return edits;
}
