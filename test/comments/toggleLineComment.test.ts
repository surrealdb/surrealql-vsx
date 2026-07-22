import { describe, expect, test } from "bun:test";
import {
	computeToggleEdits,
	type LineRange,
	selectionLineRange,
	type ToggleEdit,
} from "../../src/comments/toggleLineComment";

/** Apply computed edits to a document held as an array of lines. */
function apply(lines: readonly string[], edits: readonly ToggleEdit[]): string[] {
	const result = [...lines];
	for (const edit of edits) {
		const text = result[edit.line];
		result[edit.line] =
			edit.kind === "insert"
				? text.slice(0, edit.character) + edit.text + text.slice(edit.character)
				: text.slice(0, edit.startCharacter) + text.slice(edit.endCharacter);
	}
	return result;
}

function toggle(lines: readonly string[], ranges?: readonly LineRange[], insertSpace = true) {
	const covered = ranges ?? [{ startLine: 0, endLine: lines.length - 1 }];
	return apply(
		lines,
		computeToggleEdits((line) => lines[line], covered, insertSpace),
	);
}

describe("computeToggleEdits", () => {
	test("comments an uncommented line with --", () => {
		expect(toggle(["SELECT * FROM person;"])).toEqual(["-- SELECT * FROM person;"]);
	});

	test("uncomments each SurrealQL marker", () => {
		expect(toggle(["-- SELECT 1;"])).toEqual(["SELECT 1;"]);
		expect(toggle(["// SELECT 1;"])).toEqual(["SELECT 1;"]);
		expect(toggle(["# SELECT 1;"])).toEqual(["SELECT 1;"]);
	});

	test("uncomments markers not followed by a space", () => {
		expect(toggle(["--SELECT 1;"])).toEqual(["SELECT 1;"]);
		expect(toggle(["//SELECT 1;"])).toEqual(["SELECT 1;"]);
		expect(toggle(["#SELECT 1;"])).toEqual(["SELECT 1;"]);
	});

	test("removes only one marker per toggle", () => {
		expect(toggle(["-- -- SELECT 1;"])).toEqual(["-- SELECT 1;"]);
		expect(toggle(["-- # SELECT 1;"])).toEqual(["# SELECT 1;"]);
	});

	test("uncomments a block of mixed marker styles", () => {
		expect(toggle(["-- a", "// b", "# c"])).toEqual(["a", "b", "c"]);
	});

	test("comments a partially commented block and round-trips", () => {
		const mixed = ["# a", "b"];
		const commented = toggle(mixed);
		expect(commented).toEqual(["-- # a", "-- b"]);
		expect(toggle(commented)).toEqual(mixed);
	});

	test("preserves leading whitespace when uncommenting", () => {
		expect(toggle(["    -- a"])).toEqual(["    a"]);
		expect(toggle(["\t# a"])).toEqual(["\ta"]);
	});

	test("aligns markers at the block's minimum indentation", () => {
		expect(toggle(["    a", "        b"])).toEqual(["    -- a", "    --     b"]);
	});

	test("skips blank lines when commenting a block", () => {
		expect(toggle(["a", "", "b"])).toEqual(["-- a", "", "-- b"]);
	});

	test("ignores blank lines when deciding to uncomment", () => {
		expect(toggle(["-- a", "", "-- b"])).toEqual(["a", "", "b"]);
	});

	test("comments blank lines when the range holds nothing else", () => {
		expect(toggle([""])).toEqual(["-- "]);
		expect(toggle(["    "])).toEqual(["    -- "]);
	});

	test("honours insertSpace = false", () => {
		expect(toggle(["a"], undefined, false)).toEqual(["--a"]);
		expect(toggle(["-- a"], undefined, false)).toEqual([" a"]);
	});

	test("decides comment vs uncomment per range", () => {
		const lines = ["-- a", "b"];
		const ranges = [
			{ startLine: 0, endLine: 0 },
			{ startLine: 1, endLine: 1 },
		];
		expect(toggle(lines, ranges)).toEqual(["a", "-- b"]);
	});

	test("edits a line claimed by several ranges only once", () => {
		const ranges = [
			{ startLine: 0, endLine: 0 },
			{ startLine: 0, endLine: 0 },
		];
		expect(toggle(["a"], ranges)).toEqual(["-- a"]);
	});
});

describe("selectionLineRange", () => {
	test("keeps single-line selections", () => {
		expect(selectionLineRange(3, 3, 0)).toEqual({ startLine: 3, endLine: 3 });
	});

	test("drops the final line when a multi-line selection ends at column 0", () => {
		expect(selectionLineRange(0, 2, 0)).toEqual({ startLine: 0, endLine: 1 });
	});

	test("keeps the final line when the selection ends past column 0", () => {
		expect(selectionLineRange(0, 2, 5)).toEqual({ startLine: 0, endLine: 2 });
	});
});
