import * as vscode from "vscode";

/** Configuration root key. All settings live under this prefix. */
export const CONFIG_SECTION = "surrealql";

export type AuthContext = "root" | "namespace" | "database" | "record";
export type InferenceMode = "both" | "workspace" | "db";

/**
 * Snapshot of the SurrealQL extension settings, taken from
 * `vscode.workspace.getConfiguration("surrealql")` at the time of the call.
 *
 * All getters trim/normalise values where appropriate so call sites can rely
 * on the documented invariants (e.g. `endpoint` is either a non-empty trimmed
 * string or empty when unconfigured).
 */
export interface SurQLSettings {
	readonly lspEnabled: boolean;
	readonly lspVersion: string;
	readonly lspBinaryPath: string;
	readonly endpoint: string;
	readonly namespace: string;
	readonly database: string;
	readonly username: string;
	readonly password: string;
	readonly authContext: AuthContext;
	readonly inferenceMode: InferenceMode;
}

const VALID_AUTH_CONTEXTS: ReadonlySet<AuthContext> = new Set([
	"root",
	"namespace",
	"database",
	"record",
]);

const VALID_INFERENCE_MODES: ReadonlySet<InferenceMode> = new Set(["both", "workspace", "db"]);

/** Reads the current SurrealQL settings as a typed snapshot. */
export function readSettings(): SurQLSettings {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

	const authRaw = String(cfg.get<string>("connection.authContext") ?? "root");
	const authContext: AuthContext = VALID_AUTH_CONTEXTS.has(authRaw as AuthContext)
		? (authRaw as AuthContext)
		: "root";

	const modeRaw = String(cfg.get<string>("inference.mode") ?? "both");
	const inferenceMode: InferenceMode = VALID_INFERENCE_MODES.has(modeRaw as InferenceMode)
		? (modeRaw as InferenceMode)
		: "both";

	return {
		lspEnabled: cfg.get<boolean>("lsp.enable") ?? true,
		lspVersion: (cfg.get<string>("lsp.version") ?? "latest").trim(),
		lspBinaryPath: (cfg.get<string>("lsp.binaryPath") ?? "").trim(),
		endpoint: (cfg.get<string>("connection.endpoint") ?? "").trim(),
		namespace: (cfg.get<string>("connection.namespace") ?? "").trim(),
		database: (cfg.get<string>("connection.database") ?? "").trim(),
		username: cfg.get<string>("connection.username") ?? "",
		password: cfg.get<string>("connection.password") ?? "",
		authContext,
		inferenceMode,
	};
}

/**
 * Builds the JSON-serialisable initialization options sent to the language
 * server on `initialize`.
 *
 * Shape mirrors the JetBrains plugin's `buildInitializationOptions()` and
 * matches the `surrealql.*` keys consumed by `surrealql-language-server`'s
 * `ServerSettings::from_sources`.
 */
export function buildInitializationOptions(s: SurQLSettings): Record<string, unknown> {
	const connection: Record<string, string> = {};
	if (s.endpoint) connection.endpoint = s.endpoint;
	if (s.namespace) connection.namespace = s.namespace;
	if (s.database) connection.database = s.database;
	if (s.username) connection.username = s.username;
	if (s.password) connection.password = s.password;

	const surrealql: Record<string, unknown> = {};
	if (Object.keys(connection).length > 0) surrealql.connection = connection;
	if (s.authContext) surrealql.activeAuthContext = s.authContext;
	surrealql.metadata = { mode: s.inferenceMode };

	return { surrealql };
}

/** Setting keys that, when changed, require the language server to be restarted. */
export const RESTART_TRIGGERING_KEYS = [
	"surrealql.lsp.enable",
	"surrealql.lsp.version",
	"surrealql.lsp.binaryPath",
	"surrealql.connection.endpoint",
	"surrealql.connection.namespace",
	"surrealql.connection.database",
	"surrealql.connection.username",
	"surrealql.connection.password",
	"surrealql.connection.authContext",
	"surrealql.inference.mode",
] as const;

/**
 * Returns true when `event` reports a change to any setting that requires the
 * language server to be restarted (init options are sent on `initialize`, so
 * changes to them only take effect on the next start).
 */
export function affectsLanguageServer(event: vscode.ConfigurationChangeEvent): boolean {
	return RESTART_TRIGGERING_KEYS.some((key) => event.affectsConfiguration(key));
}

/**
 * Returns true when `event` reports a change to any of the connection or
 * status-bar-visible settings (used to refresh the status bar widget).
 */
export function affectsStatusBar(event: vscode.ConfigurationChangeEvent): boolean {
	return (
		event.affectsConfiguration("surrealql.connection.endpoint") ||
		event.affectsConfiguration("surrealql.connection.namespace") ||
		event.affectsConfiguration("surrealql.connection.database") ||
		event.affectsConfiguration("surrealql.connection.authContext")
	);
}
