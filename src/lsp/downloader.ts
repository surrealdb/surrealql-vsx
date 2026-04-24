import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { URL } from "node:url";
import * as vscode from "vscode";

const RELEASES_URL = "https://api.github.com/repos/surrealdb/surrealql-language-server/releases";
const DOWNLOAD_BASE = "https://github.com/surrealdb/surrealql-language-server/releases/download";
const TAGS_TTL_MS = 24 * 60 * 60 * 1000;

const CONNECT_TIMEOUT_MS = 8_000;
const READ_TIMEOUT_MS = 30_000;
const RELEASES_LIST_TIMEOUT_MS = 8_000;

const TAGS_CACHE_FILE = "release-tags.json";

/**
 * Identifies the GitHub-released asset to fetch for the host platform.
 *
 * `macX64Fallback` is true when the host is an x86_64 Mac and we're falling
 * back to the arm64 build (no x86_64 macOS asset is published in the LS CI
 * matrix). The user is expected to have Rosetta 2 installed.
 */
interface PlatformAsset {
	readonly fileName: string;
	readonly resourceDir: string;
	readonly macX64Fallback: boolean;
}

/**
 * Resolves the platform-specific asset name. Mirrors `resolvePlatformAsset()`
 * in `SurQLLanguageServerService.kt`.
 *
 * Returns `null` if no published binary is available for the host platform.
 */
export function resolvePlatformAsset(
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch,
): PlatformAsset | null {
	const isArm64 = arch === "arm64";
	const isX64 = arch === "x64";

	if (platform === "win32" && isX64) {
		return {
			fileName: "surrealql-language-server-windows-amd64.exe",
			resourceDir: "windows-amd64",
			macX64Fallback: false,
		};
	}
	if (platform === "darwin" && isArm64) {
		return {
			fileName: "surrealql-language-server-macos-arm64",
			resourceDir: "macos-arm64",
			macX64Fallback: false,
		};
	}
	if (platform === "darwin" && isX64) {
		return {
			fileName: "surrealql-language-server-macos-arm64",
			resourceDir: "macos-arm64",
			macX64Fallback: true,
		};
	}
	if (platform === "linux" && isArm64) {
		return {
			fileName: "surrealql-language-server-linux-arm64",
			resourceDir: "linux-arm64",
			macX64Fallback: false,
		};
	}
	if (platform === "linux" && isX64) {
		return {
			fileName: "surrealql-language-server-linux-amd64",
			resourceDir: "linux-amd64",
			macX64Fallback: false,
		};
	}
	return null;
}

interface CachedTags {
	tags: string[];
	fetchedAtMs: number;
}

/**
 * Service that resolves and (when needed) downloads the
 * `surrealql-language-server` binary, caching it under the extension's
 * `globalStorageUri`.
 *
 * Mirrors the resolution order from `SurQLLanguageServerService.kt`:
 *
 *  1. If the user supplied an absolute binary path via settings, use it.
 *  2. If a release tag is pinned (or we resolved "latest" against the cache),
 *     download the matching asset (or reuse the on-disk copy).
 *
 * The releases-list response is cached for 24 hours under the extension's
 * global storage so a user without network can still launch the LSP they
 * downloaded earlier.
 */
export class LanguageServerDownloader {
	private notifiedMacIntelFallback = false;
	private readonly inFlight = new Map<string, Promise<string | null>>();

	constructor(private readonly storageRoot: string) {}

	/**
	 * Resolves the binary path that should be launched.
	 *
	 * - When `binaryOverride` is non-empty, returns that path verbatim if the
	 *   file exists.
	 * - When `version` is `"latest"` (or empty), the latest GitHub release tag
	 *   is fetched (with a 24h cache fallback) and the matching asset is
	 *   downloaded.
	 * - When `version` is a pinned tag, that release is downloaded.
	 */
	async resolveBinary(opts: {
		readonly binaryOverride: string;
		readonly version: string;
	}): Promise<string | null> {
		const override = opts.binaryOverride.trim();
		if (override.length > 0) {
			try {
				const stat = await fsp.stat(override);
				if (stat.isFile()) return override;
			} catch {
				/* fall through */
			}
			vscode.window.showErrorMessage(
				`SurrealQL: language server override path does not exist: ${override}`,
			);
			return null;
		}

		const asset = resolvePlatformAsset();
		if (asset === null) {
			vscode.window.showWarningMessage(
				`SurrealQL: no prebuilt language-server binary is published for ${process.platform} ${process.arch}. Set surrealql.lsp.binaryPath to use a custom build.`,
			);
			return null;
		}

		let tag: string | null = opts.version.trim();
		if (tag.length === 0 || tag.toLowerCase() === "latest") {
			tag = await this.resolveLatestTag();
		}
		if (tag === null) {
			vscode.window.showWarningMessage(
				"SurrealQL: could not resolve the latest language-server release. Check your network connection or pin a version under settings.",
			);
			return null;
		}

		return this.getOrDownload(tag, asset);
	}

	private async resolveLatestTag(): Promise<string | null> {
		const cached = await this.readTagsCache();
		const isFresh =
			cached !== null &&
			Date.now() - cached.fetchedAtMs < TAGS_TTL_MS &&
			cached.tags.length > 0;
		if (isFresh) {
			return cached.tags[0] ?? null;
		}
		const fetched = await this.fetchTags();
		if (fetched !== null && fetched.length > 0) {
			await this.writeTagsCache({ tags: fetched, fetchedAtMs: Date.now() });
			return fetched[0] ?? null;
		}
		return cached?.tags[0] ?? null;
	}

	private async fetchTags(): Promise<string[] | null> {
		try {
			const body = await httpGetText(RELEASES_URL, {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "surrealql-vsx",
			});
			if (body === null) return null;
			const tags: string[] = [];
			const re = /"tag_name"\s*:\s*"([^"]+)"/g;
			let m: RegExpExecArray | null;
			// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec() loop
			while ((m = re.exec(body)) !== null) {
				if (m[1]) tags.push(m[1]);
			}
			return tags;
		} catch {
			return null;
		}
	}

	private async readTagsCache(): Promise<CachedTags | null> {
		try {
			const text = await fsp.readFile(path.join(this.storageRoot, TAGS_CACHE_FILE), "utf8");
			const parsed = JSON.parse(text);
			if (
				parsed &&
				Array.isArray(parsed.tags) &&
				typeof parsed.fetchedAtMs === "number" &&
				parsed.tags.every((t: unknown): t is string => typeof t === "string")
			) {
				return { tags: parsed.tags, fetchedAtMs: parsed.fetchedAtMs };
			}
		} catch {
			/* no cached data yet */
		}
		return null;
	}

	private async writeTagsCache(data: CachedTags): Promise<void> {
		await fsp.mkdir(this.storageRoot, { recursive: true });
		await fsp.writeFile(
			path.join(this.storageRoot, TAGS_CACHE_FILE),
			JSON.stringify(data),
			"utf8",
		);
	}

	private getOrDownload(tag: string, asset: PlatformAsset): Promise<string | null> {
		const cacheKey = `${tag}:${asset.fileName}`;
		const existing = this.inFlight.get(cacheKey);
		if (existing) return existing;
		const promise = this.downloadVersion(tag, asset).finally(() => {
			this.inFlight.delete(cacheKey);
		});
		this.inFlight.set(cacheKey, promise);
		return promise;
	}

	private async downloadVersion(tag: string, asset: PlatformAsset): Promise<string | null> {
		const dir = path.join(this.storageRoot, "lsp", tag);
		const dest = path.join(dir, asset.fileName);
		try {
			await fsp.mkdir(dir, { recursive: true });
			let needDownload = true;
			try {
				const stat = await fsp.stat(dest);
				needDownload = !stat.isFile() || stat.size === 0;
			} catch {
				/* not yet cached */
			}
			if (needDownload) {
				await downloadFileTo(`${DOWNLOAD_BASE}/${tag}/${asset.fileName}`, dest);
				await makeExecutable(dest);
			}
			if (asset.macX64Fallback && !this.notifiedMacIntelFallback) {
				this.notifiedMacIntelFallback = true;
				vscode.window.showInformationMessage(
					`SurrealQL: no native x86_64 macOS build is published for ${tag}. Running the arm64 binary through Rosetta — install Rosetta 2 if you have not already.`,
				);
			}
			return dest;
		} catch (e) {
			vscode.window.showErrorMessage(
				`SurrealQL: failed to download language-server release ${tag}: ${(e as Error).message}`,
			);
			return null;
		}
	}
}

async function makeExecutable(filePath: string): Promise<void> {
	if (process.platform === "win32") return;
	try {
		await fsp.chmod(filePath, 0o755);
	} catch {
		/* best effort */
	}
}

function httpGetText(urlString: string, headers: Record<string, string>): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			const url = new URL(urlString);
			const transport = url.protocol === "https:" ? https : http;
			const req = transport.request(
				{
					method: "GET",
					protocol: url.protocol,
					hostname: url.hostname,
					port: url.port || (url.protocol === "https:" ? 443 : 80),
					path: `${url.pathname}${url.search}`,
					headers,
					timeout: CONNECT_TIMEOUT_MS,
				},
				(res) => {
					if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
						res.resume();
						resolve(null);
						return;
					}
					const chunks: Buffer[] = [];
					res.on("data", (c: Buffer) => chunks.push(c));
					res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
					res.on("error", () => resolve(null));
				},
			);
			const overall = setTimeout(
				() => req.destroy(new Error("Releases list request timed out")),
				RELEASES_LIST_TIMEOUT_MS,
			);
			req.on("close", () => clearTimeout(overall));
			req.on("timeout", () => req.destroy());
			req.on("error", () => resolve(null));
			req.end();
		} catch {
			resolve(null);
		}
	});
}

/**
 * Downloads `url` to `dest`, manually following up to 5 redirects (GitHub
 * release downloads redirect to a signed S3 URL).
 */
async function downloadFileTo(url: string, dest: string): Promise<void> {
	let current = url;
	for (let hops = 0; hops < 6; hops++) {
		const result = await singleDownload(current, dest);
		if (result.kind === "ok") return;
		if (result.kind === "redirect") {
			current = result.location;
			continue;
		}
		throw new Error(result.error);
	}
	throw new Error(`Too many redirects fetching ${url}`);
}

type DownloadResult =
	| { kind: "ok" }
	| { kind: "redirect"; location: string }
	| { kind: "error"; error: string };

function singleDownload(urlString: string, dest: string): Promise<DownloadResult> {
	return new Promise((resolve) => {
		try {
			const url = new URL(urlString);
			const transport = url.protocol === "https:" ? https : http;
			const req = transport.request(
				{
					method: "GET",
					protocol: url.protocol,
					hostname: url.hostname,
					port: url.port || (url.protocol === "https:" ? 443 : 80),
					path: `${url.pathname}${url.search}`,
					headers: { "User-Agent": "surrealql-vsx", Accept: "*/*" },
					timeout: CONNECT_TIMEOUT_MS,
				},
				async (res) => {
					const status = res.statusCode ?? 0;
					if (status >= 300 && status < 400) {
						res.resume();
						const location = res.headers.location;
						if (typeof location !== "string" || location.length === 0) {
							resolve({
								kind: "error",
								error: `Redirect without Location header from ${urlString}`,
							});
							return;
						}
						const next = location.startsWith("http")
							? location
							: new URL(location, url).toString();
						resolve({ kind: "redirect", location: next });
						return;
					}
					if (status < 200 || status >= 300) {
						res.resume();
						resolve({ kind: "error", error: `HTTP ${status} for ${urlString}` });
						return;
					}
					try {
						const tmp = `${dest}.partial`;
						const out = fs.createWriteStream(tmp);
						await pipeline(res, out);
						await fsp.rename(tmp, dest);
						resolve({ kind: "ok" });
					} catch (e) {
						resolve({ kind: "error", error: (e as Error).message });
					}
				},
			);
			const overall = setTimeout(
				() => req.destroy(new Error(`Download timed out after ${READ_TIMEOUT_MS}ms`)),
				READ_TIMEOUT_MS,
			);
			req.on("close", () => clearTimeout(overall));
			req.on("timeout", () => req.destroy());
			req.on("error", (err) => resolve({ kind: "error", error: err.message }));
			req.end();
		} catch (e) {
			resolve({ kind: "error", error: (e as Error).message });
		}
	});
}
