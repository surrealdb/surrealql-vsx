import * as vscode from "vscode";
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";
import { buildInitializationOptions, readSettings } from "../settings";
import type { LanguageServerDownloader } from "./downloader";

const SERVER_ID = "surrealqlLanguageServer";
const SERVER_NAME = "SurrealQL Language Server";

/**
 * Lifecycle wrapper around a `vscode-languageclient` `LanguageClient` connected
 * to the `surrealql-language-server` binary.
 *
 * Mirrors the JetBrains LSP4IJ integration: the binary is resolved
 * (download/cache/override) on `start()`, the connection is opened over stdio,
 * and `initializationOptions` follow the exact `surrealql.*` shape consumed by
 * the server's `ServerSettings::from_sources`.
 */
export class SurQLLanguageClient {
	private client: LanguageClient | null = null;
	private starting: Promise<void> | null = null;

	constructor(private readonly downloader: LanguageServerDownloader) {}

	/**
	 * Returns true when the client is currently in the started/running state
	 * (i.e. requests can be sent to it).
	 */
	get isRunning(): boolean {
		return this.client?.isRunning() ?? false;
	}

	/**
	 * Starts the language client. If already starting, returns the same
	 * promise. If already running, resolves immediately.
	 */
	async start(): Promise<void> {
		if (this.starting) return this.starting;
		if (this.client?.isRunning()) return;
		const settings = readSettings();
		if (!settings.lspEnabled) return;

		this.starting = this.doStart(settings).finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async doStart(settings: ReturnType<typeof readSettings>): Promise<void> {
		const binary = await this.downloader.resolveBinary({
			binaryOverride: settings.lspBinaryPath,
			version: settings.lspVersion,
		});
		if (binary === null) {
			return;
		}

		const serverOptions: ServerOptions = {
			run: { command: binary, transport: TransportKind.stdio, args: [] },
			debug: { command: binary, transport: TransportKind.stdio, args: [] },
		};

		const clientOptions: LanguageClientOptions = {
			documentSelector: [
				{ scheme: "file", language: "surrealql" },
				{ scheme: "untitled", language: "surrealql" },
			],
			synchronize: {
				configurationSection: "surrealql",
				fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{surql,surrealql}"),
			},
			initializationOptions: buildInitializationOptions(settings),
			outputChannelName: SERVER_NAME,
		};

		const client = new LanguageClient(SERVER_ID, SERVER_NAME, serverOptions, clientOptions);
		this.client = client;

		try {
			await client.start();
		} catch (e) {
			vscode.window.showErrorMessage(
				`SurrealQL: failed to start language server: ${(e as Error).message}`,
			);
			this.client = null;
			throw e;
		}
	}

	/** Stops the language client. Safe to call when not running. */
	async stop(): Promise<void> {
		const client = this.client;
		this.client = null;
		if (client === null) return;
		try {
			if (client.isRunning()) {
				await client.stop();
			}
		} catch {
			/* swallow — already stopped or never started */
		}
	}

	/**
	 * Stops and re-starts the client, picking up the current settings snapshot
	 * (binary path, init options, etc.).
	 */
	async restart(): Promise<void> {
		await this.stop();
		await this.start();
	}

	/**
	 * Pushes a fresh `workspace/didChangeConfiguration` notification to the
	 * running server. Safe to call when not running (no-ops).
	 */
	async pushConfiguration(): Promise<void> {
		const client = this.client;
		if (client === null || !client.isRunning()) return;
		try {
			await client.sendNotification("workspace/didChangeConfiguration", {
				settings: buildInitializationOptions(readSettings()),
			});
		} catch {
			/* server might be shutting down — ignore */
		}
	}
}
