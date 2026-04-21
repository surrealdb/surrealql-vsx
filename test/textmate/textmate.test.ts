import { describe, expect, test } from "bun:test";
import {
	lineTokenParts,
	scopeAtColumn,
	scopeForSubstring,
	tokenizeDocument,
	unscopedRatio,
} from "./harness";

describe("SurrealQL TextMate grammar", () => {
	test("statement keywords", () => {
		expect(scopeAtColumn("SELECT 1", 0)).toBe("keyword.control.surrealql");
		expect(scopeAtColumn("FROM person", 0)).toBe("keyword.control.surrealql");
		expect(scopeAtColumn("DEFINE TABLE x", 0)).toBe("keyword.control.surrealql");
		expect(scopeAtColumn("DEFINE TABLE x", 7)).toBe("keyword.control.surrealql");
	});

	test("identifiers (not reserved words)", () => {
		expect(scopeAtColumn("FROM person", 5)).toBe("variable.other.surrealql");
		expect(scopeForSubstring("DEFINE TABLE post SCHEMALESS", "post")).toBe(
			"variable.other.surrealql",
		);
	});

	test("comments", () => {
		expect(scopeAtColumn("-- hello", 0)).toBe("comment.line.double-dash");
		expect(scopeAtColumn("// x", 0)).toBe("comment.line.double-slash");
		expect(scopeAtColumn("# x", 0)).toBe("comment.line.number-sign");
		expect(scopeForSubstring("/* a */", "/*")).toBe("comment.block.surrealql");
	});

	test("DEFINE ANALYZER line (literals + tokenizer + filter)", () => {
		const line = "DEFINE ANALYZER english TOKENIZERS camel, class FILTERS snowball, uppercase;";
		expect(scopeForSubstring(line, "DEFINE")).toBe("keyword.control.surrealql");
		expect(scopeForSubstring(line, "ANALYZER")).toBe("keyword.control.surrealql");
		expect(scopeForSubstring(line, "english")).toBe("variable.other.surrealql");
		expect(scopeForSubstring(line, "TOKENIZERS")).toBe("keyword.control.surrealql");
		expect(scopeForSubstring(line, "camel")).toBe(
			"support.constant.analyzer-tokenizer.surrealql",
		);
		expect(scopeForSubstring(line, "class")).toBe(
			"support.constant.analyzer-tokenizer.surrealql",
		);
		expect(scopeForSubstring(line, "FILTERS")).toBe("keyword.control.surrealql");
		expect(scopeForSubstring(line, "snowball")).toBe("support.constant.filter.surrealql");
		expect(scopeForSubstring(line, "uppercase")).toBe("support.constant.filter.surrealql");
	});

	test("index types and vector index", () => {
		const line = "DEFINE INDEX i ON t FIELDS x HNSW DIMENSION 4 TYPE f64 DIST COSINE;";
		expect(scopeForSubstring(line, "HNSW")).toBe("keyword.control.surrealql");
		expect(scopeForSubstring(line, "f64")).toBe("constant.language.index-type.surrealql");
		expect(scopeForSubstring(line, "COSINE")).toBe("support.constant.distance.surrealql");
	});

	test("JWT algorithm token type", () => {
		const line = 'DEFINE ACCESS a ON JWT URL "x" WITH JWT ALGORITHM RS256;';
		expect(scopeForSubstring(line, "RS256")).toBe("support.constant.token-type.surrealql");
	});

	test("regex literal", () => {
		const line = "/pattern/i";
		expect(scopeForSubstring(line, "/pattern/i")).toBe("string.regexp.surrealql");
	});

	test("strings and numbers", () => {
		expect(scopeForSubstring('RETURN "hi"', '"hi"')).toBe("string.quoted.double");
		expect(scopeForSubstring("WHERE age > 18", "18")).toBe("constant.numeric.int");
	});

	test("multi-line block: LET binds in nested scope", () => {
		const src = `{
\tLET $x = 5;
\t$x + 1
}`;
		expect(scopeForSubstring(src, "LET")).toBe("keyword.control.surrealql");
		expect(scopeForSubstring(src, "$x")).toBe("variable.name");
		expect(scopeForSubstring(src, "5")).toBe("constant.numeric.int");
	});

	test("coverage: most of the line is not bare source.surrealql", () => {
		const chunk = `
DEFINE TABLE person SCHEMAFULL;
SELECT name FROM person WHERE age > 18;
INSERT INTO person { name: "Ada" };
/pattern/i;
`;
		expect(unscopedRatio(chunk)).toBeLessThan(0.35);
	});
});

describe("line tokenization (debug-friendly)", () => {
	test("exposes ordered spans for a single line", () => {
		const parts = lineTokenParts("SELECT 1");
		expect(
			parts.some((p) => p.text === "SELECT" && p.scope === "keyword.control.surrealql"),
		).toBe(true);
		expect(parts.some((p) => p.text === "1" && p.scope === "constant.numeric.int")).toBe(true);
	});
});

describe("multi-line document stack", () => {
	test("tokenizeDocument returns one row per line", () => {
		const rows = tokenizeDocument("A\nB");
		expect(rows).toHaveLength(2);
		expect(rows.at(0)?.text).toBe("A");
		expect(rows.at(1)?.text).toBe("B");
	});
});
