import { Buffer } from "node:buffer";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import type { SurQLSettings } from "../settings";

/**
 * The result of executing a single SurrealQL statement against SurrealDB's
 * HTTP `/sql` endpoint.
 *
 * `rows` is populated when `status` is `"OK"` and the result is a JSON array
 * of objects. `error` is populated when the server reports a query-level error
 * or the connection failed. `rawJson` contains the pretty-printed JSON of the
 * `result` field for display in a text view.
 */
export interface QueryResult {
	readonly query: string;
	readonly status: string;
	readonly time: string;
	readonly rows: ReadonlyArray<Record<string, unknown>>;
	readonly error: string | null;
	readonly rawJson: string;
}

/** Connection timeout for the HTTP request (matches the JetBrains plugin). */
const CONNECT_TIMEOUT_MS = 10_000;
/** Total request timeout (matches the JetBrains plugin). */
const REQUEST_TIMEOUT_MS = 30_000;

export interface ExecuteOptions {
	readonly query: string;
	readonly settings: SurQLSettings;
	readonly fileNamespace?: string | null;
	readonly fileDatabase?: string | null;
}

/**
 * Executes `query` and returns the parsed result. Rejects on network/IO
 * failure with a human-readable error message.
 *
 * `fileNamespace` and `fileDatabase` are values extracted from `USE NS` /
 * `USE DB` directives in the source file. When non-null they take precedence
 * over the namespace and database configured in {@link SurQLSettings}, so a
 * file that declares its own context works without the settings being
 * pre-filled.
 *
 * SurrealDB 3.x does not honour standalone `NS`/`DB` HTTP headers for session
 * context on `/sql`. Instead, `USE NS`/`USE DB` statements are prepended to
 * the query body so that all statements in the same HTTP request share the
 * correct session context. The response array includes results for those
 * preamble statements; `parseResponse` always surfaces the first error (if
 * any) or the last result (the actual user query).
 */
export async function execute(opts: ExecuteOptions): Promise<QueryResult> {
	const { query, settings } = opts;
	const url = buildSqlUrl(settings.endpoint);
	const auth = buildAuthHeader(settings);

	const ns = nonBlank(opts.fileNamespace) ?? nonBlank(settings.namespace);
	const db = nonBlank(opts.fileDatabase) ?? nonBlank(settings.database);

	const safeNs = ns?.replace(/`/g, "\\`");
	const safeDb = db?.replace(/`/g, "\\`");
	let body = "";
	if (safeNs) body += `USE NS \`${safeNs}\`; `;
	if (safeDb) body += `USE DB \`${safeDb}\`; `;
	body += query;
	const preambleCount = (safeNs ? 1 : 0) + (safeDb ? 1 : 0);

	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "text/plain",
	};
	if (ns) headers.NS = ns;
	if (db) headers.DB = db;
	if (auth) headers.Authorization = auth;

	const { statusCode, body: responseBody } = await postString(url, headers, body);

	if (statusCode < 200 || statusCode >= 300) {
		return {
			query,
			status: "ERR",
			time: "",
			rows: [],
			error: `HTTP ${statusCode}: ${responseBody}`,
			rawJson: responseBody,
		};
	}

	return parseResponse(query, responseBody, preambleCount);
}

function nonBlank(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function buildAuthHeader(settings: SurQLSettings): string | null {
	if (!settings.username || !settings.password) return null;
	const credentials = `${settings.username}:${settings.password}`;
	return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

/**
 * Normalises an arbitrary endpoint URL into the absolute `/sql` URL.
 *
 * - `ws://` → `http://`, `wss://` → `https://`
 * - any path component is stripped (e.g. `/rpc`)
 * - `/sql` is always appended
 */
export function buildSqlUrl(endpoint: string): string {
	const withHttp = endpoint.replace(/^ws:\/\//i, "http://").replace(/^wss:\/\//i, "https://");
	try {
		const u = new URL(withHttp);
		const port = u.port ? `:${u.port}` : "";
		return `${u.protocol}//${u.hostname}${port}/sql`;
	} catch {
		return `${withHttp.replace(/\/+$/, "")}/sql`;
	}
}

interface HttpResponse {
	statusCode: number;
	body: string;
}

function postString(
	urlString: string,
	headers: Record<string, string>,
	body: string,
): Promise<HttpResponse> {
	return new Promise((resolve, reject) => {
		let url: URL;
		try {
			url = new URL(urlString);
		} catch (e) {
			reject(new Error(`Invalid endpoint URL '${urlString}': ${(e as Error).message}`));
			return;
		}

		const transport = url.protocol === "https:" ? https : http;
		const payload = Buffer.from(body, "utf8");

		const req = transport.request(
			{
				method: "POST",
				protocol: url.protocol,
				hostname: url.hostname,
				port: url.port || (url.protocol === "https:" ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				headers: {
					...headers,
					"Content-Length": payload.length.toString(),
				},
				timeout: CONNECT_TIMEOUT_MS,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					resolve({
						statusCode: res.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
				res.on("error", reject);
			},
		);

		const overallTimer = setTimeout(() => {
			req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);

		req.on("close", () => clearTimeout(overallTimer));
		req.on("timeout", () => req.destroy(new Error("Connection timed out")));
		req.on("error", (err) => {
			clearTimeout(overallTimer);
			reject(err);
		});

		req.write(payload);
		req.end();
	});
}

/** Parses the JSON array returned by SurrealDB's `/sql` endpoint. */
export function parseResponse(query: string, body: string, _preambleCount = 0): QueryResult {
	try {
		const parsed: unknown = JSON.parse(body);
		if (!Array.isArray(parsed)) {
			return {
				query,
				status: "OK",
				time: "",
				rows: [],
				error: null,
				rawJson: body,
			};
		}
		if (parsed.length === 0) {
			return {
				query,
				status: "OK",
				time: "",
				rows: [],
				error: null,
				rawJson: "[]",
			};
		}
		const firstErr = parsed.find(
			(e): e is Record<string, unknown> =>
				typeof e === "object" &&
				e !== null &&
				(e as Record<string, unknown>).status === "ERR",
		);
		const obj = (firstErr ?? parsed[parsed.length - 1]) as Record<string, unknown>;
		const status = typeof obj.status === "string" ? obj.status : "OK";
		const time = typeof obj.time === "string" ? obj.time : "";
		const result = obj.result;
		const { rows, error } = parseResult(status, result);
		const rawJson = result === undefined ? "" : JSON.stringify(result, null, 2);
		return { query, status, time, rows, error, rawJson };
	} catch (e) {
		const message = (e as Error).message ?? "Failed to parse response";
		return {
			query,
			status: "ERR",
			time: "",
			rows: [],
			error: message,
			rawJson: body,
		};
	}
}

function parseResult(
	status: string,
	element: unknown,
): { rows: ReadonlyArray<Record<string, unknown>>; error: string | null } {
	if (element === undefined || element === null) return { rows: [], error: null };
	if (status !== "OK") {
		const msg = typeof element === "string" ? element : JSON.stringify(element);
		return { rows: [], error: msg };
	}
	if (!Array.isArray(element)) return { rows: [], error: null };
	const rows: Record<string, unknown>[] = element.map((elem) => {
		if (elem !== null && typeof elem === "object" && !Array.isArray(elem)) {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(elem as Record<string, unknown>)) {
				out[k] = jsonToValue(v);
			}
			return out;
		}
		return { value: typeof elem === "string" ? elem : JSON.stringify(elem) };
	});
	return { rows, error: null };
}

function jsonToValue(v: unknown): unknown {
	if (v === null) return null;
	const t = typeof v;
	if (t === "boolean" || t === "number" || t === "string") return v;
	return JSON.stringify(v);
}
