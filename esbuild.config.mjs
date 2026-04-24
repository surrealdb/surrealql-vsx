import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: ["src/extension.ts"],
	outfile: "dist/extension.js",
	bundle: true,
	platform: "node",
	target: "node18",
	format: "cjs",
	sourcemap: !production,
	minify: production,
	external: ["vscode"],
	logLevel: "info",
	mainFields: ["module", "main"],
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log("[esbuild] watching for changes…");
} else {
	await esbuild.build(options);
}
