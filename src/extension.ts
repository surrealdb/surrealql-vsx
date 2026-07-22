import * as vscode from "vscode";
import {
	computeToggleEdits,
	selectionLineRange,
	TOGGLE_LINE_COMMENT_COMMAND,
} from "./comments/toggleLineComment";
import { SurQLLanguageClient } from "./lsp/client";
import { LanguageServerDownloader } from "./lsp/downloader";
import {
	RUN_STATEMENT_COMMAND,
	type RunStatementArgs,
	SurQLCodeLensProvider,
} from "./run/codeLens";
import { execute } from "./run/queryRunner";
import { RESULTS_VIEW_ID, SurQLResultsViewProvider } from "./run/resultsPanel";
import { affectsLanguageServer, affectsStatusBar, readSettings } from "./settings";
import { OPEN_SETTINGS_COMMAND, SurQLStatusBarItem } from "./statusbar/statusBarItem";

/**
 * Extension entry point. Wires together:
 *
 *  - the `surrealql-language-server` LSP client (downloaded on demand),
 *  - the "▶ Run" code lens above each top-level statement,
 *  - the SurrealQL Results webview panel,
 *  - the SurrealQL connection status bar widget,
 *  - the multi-token line-comment toggle bound to the standard toggle keys,
 *  - the commands they trigger.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await ensureStorageRoot(context);

	const downloader = new LanguageServerDownloader(context.globalStorageUri.fsPath);
	const lspClient = new SurQLLanguageClient(downloader);
	const resultsProvider = new SurQLResultsViewProvider(context.extensionUri);
	const statusBar = new SurQLStatusBarItem(context.extension.id);
	const codeLensProvider = new SurQLCodeLensProvider();

	context.subscriptions.push(
		statusBar,
		codeLensProvider,
		vscode.window.registerWebviewViewProvider(RESULTS_VIEW_ID, resultsProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.languages.registerCodeLensProvider(
			[
				{ scheme: "file", language: "surrealql" },
				{ scheme: "untitled", language: "surrealql" },
			],
			codeLensProvider,
		),
		vscode.commands.registerCommand(RUN_STATEMENT_COMMAND, (args: RunStatementArgs) =>
			handleRunStatement(args, resultsProvider),
		),
		vscode.commands.registerCommand("surrealql.restartLanguageServer", async () => {
			await lspClient.restart();
			vscode.window.setStatusBarMessage("SurrealQL: language server restarted", 2000);
		}),
		vscode.commands.registerCommand(OPEN_SETTINGS_COMMAND, () => {
			// Cursor 1.105.x crashes its renderer whenever
			// `workbench.action.openSettings` is invoked from an extension host
			// (the host gets terminated regardless of the query argument). Cursor
			// exposes its own `cursor.openVSCodeSettingsFromMenu` command, used
			// by its own menus, which opens the VS Code-style settings GUI
			// safely. Route through it on Cursor; keep the standard command with
			// the `@ext:` filter on VS Code so the existing behaviour is
			// preserved there.
			if (vscode.env.appName === "Cursor") {
				vscode.commands.executeCommand("cursor.openVSCodeSettingsFromMenu");
			} else {
				vscode.commands.executeCommand(
					"workbench.action.openSettings",
					`@ext:${statusBar.extensionId}`,
				);
			}
		}),
		vscode.commands.registerCommand("surrealql.clearResults", () => resultsProvider.clear()),
		vscode.commands.registerTextEditorCommand(TOGGLE_LINE_COMMENT_COMMAND, toggleLineComment),
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (!e.affectsConfiguration("surrealql")) return;
			if (affectsStatusBar(e)) statusBar.refresh();
			if (affectsLanguageServer(e)) {
				// Push a configuration update to the running server so that any
				// runtime-handled changes apply immediately, then restart so
				// changes that only take effect on `initialize` (binary path,
				// init options) are picked up.
				await lspClient.pushConfiguration();
				await lspClient.restart();
			}
		}),
	);

	// Fire-and-forget: starting the LSP can take a while (binary download on
	// first run); don't block activation on it.
	void lspClient.start().catch(() => {
		/* errors are surfaced to the user inside start() */
	});

	context.subscriptions.push({
		dispose: () => {
			void lspClient.stop();
		},
	});
}

export function deactivate(): Thenable<void> | undefined {
	return undefined;
}

async function ensureStorageRoot(context: vscode.ExtensionContext): Promise<void> {
	try {
		await vscode.workspace.fs.createDirectory(context.globalStorageUri);
	} catch {
		/* directory may already exist */
	}
}

/**
 * Toggle line comments across all selections. Replaces the built-in
 * `editor.action.commentLine` for SurrealQL files (rebound to the same keys
 * in `package.json`) because a language configuration can declare only one
 * line-comment token while SurrealQL accepts `--`, `//` and `#`.
 */
function toggleLineComment(editor: vscode.TextEditor, edit: vscode.TextEditorEdit): void {
	const insertSpace = vscode.workspace
		.getConfiguration("editor", editor.document)
		.get("comments.insertSpace", true);
	const ranges = editor.selections.map((selection) =>
		selectionLineRange(selection.start.line, selection.end.line, selection.end.character),
	);
	const edits = computeToggleEdits(
		(line) => editor.document.lineAt(line).text,
		ranges,
		insertSpace,
	);
	for (const change of edits) {
		if (change.kind === "insert") {
			edit.insert(new vscode.Position(change.line, change.character), change.text);
		} else {
			edit.delete(
				new vscode.Range(
					change.line,
					change.startCharacter,
					change.line,
					change.endCharacter,
				),
			);
		}
	}
}

async function handleRunStatement(
	args: RunStatementArgs,
	results: SurQLResultsViewProvider,
): Promise<void> {
	const settings = readSettings();
	if (settings.endpoint.length === 0) {
		const action = await vscode.window.showWarningMessage(
			"SurrealQL: no endpoint configured. Set surrealql.connection.endpoint to run queries.",
			"Open Settings",
		);
		if (action === "Open Settings") {
			vscode.commands.executeCommand(OPEN_SETTINGS_COMMAND);
		}
		return;
	}

	await results.reveal();

	try {
		const result = await execute({
			query: args.query,
			settings,
			fileNamespace: args.fileNamespace,
			fileDatabase: args.fileDatabase,
		});
		results.addResult(result);
	} catch (e) {
		const message = (e as Error).message ?? "Unknown error";
		results.addResult({
			query: args.query,
			status: "ERR",
			time: "",
			rows: [],
			error: message,
			rawJson: "",
		});
		vscode.window.showErrorMessage(`SurrealQL: query failed — ${message}`);
	}
}
