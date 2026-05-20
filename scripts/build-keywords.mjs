#!/usr/bin/env node
/**
 * Regenerate TextMate keyword patterns from raw/keywords.txt.
 * Splits into smaller alternations (longest-first) for reliable Oniguruma matching.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const keywordsPath = join(root, "raw/keywords.txt");
const grammarPath = join(root, "syntaxes/surrealql.tmLanguage.json");

/** Keywords handled elsewhere or too ambiguous as case-insensitive reserved words. */
const EXCLUDE = new Set(["and", "or", "post"]);

const CHUNK_SIZE = 35;

const keywords = [
	...new Set([
		...readFileSync(keywordsPath, "utf8")
			.split("\n")
			.map((line) => line.trim().toLowerCase())
			.filter((word) => word && !EXCLUDE.has(word)),
	]),
].sort((a, b) => b.length - a.length);

const patterns = [];
for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
	const chunk = keywords.slice(i, i + CHUNK_SIZE);
	patterns.push({
		name: "keyword.control keyword.control.surrealql",
		match: `(?i)\\b(${chunk.join("|")})\\b`,
	});
}

const grammar = JSON.parse(readFileSync(grammarPath, "utf8"));
grammar.repository.keywords.patterns = patterns;

writeFileSync(grammarPath, `${JSON.stringify(grammar, null, "\t")}\n`);

console.log(
	`Updated ${grammarPath}: ${patterns.length} keyword patterns, ${keywords.length} keywords`,
);
