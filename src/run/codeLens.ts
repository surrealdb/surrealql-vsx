import * as vscode from "vscode";
import { extractUseDirectives, findStatements } from "./statementParser";
import { readSettings } from "../settings";

/** Command id fired when the user clicks the "▶ Run" lens. */
export const RUN_STATEMENT_COMMAND = "surrealql.runStatement";

/**
 * Payload passed to the {@link RUN_STATEMENT_COMMAND} command when a code lens
 * is clicked. Captured at lens-creation time so the command handler doesn't
 * need to re-parse the document.
 */
export interface RunStatementArgs {
	readonly query: string;
	readonly fileNamespace: string | null;
	readonly fileDatabase: string | null;
	readonly documentUri: string;
}

/**
 * Renders a clickable "▶ Run" code lens above the first line of every
 * top-level SurrealQL statement in `.surql` / `.surrealql` files.
 *
 * Mirrors `SurQLCodeVisionProvider` from the JetBrains plugin.
 */
export class SurQLCodeLensProvider implements vscode.CodeLensProvider {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.emitter.event;

	constructor() {
		// Re-emit when settings change so that adding/removing an endpoint
		// can affect lens visibility in the future without a reload.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("surrealql")) this.emitter.fire();
		});
	}

	provideCodeLenses(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): vscode.CodeLens[] {
		if (token.isCancellationRequested) return [];
		if (document.languageId !== "surrealql") return [];

		const settings = readSettings();
		if (!settings.runQueryEnabled) return [];

		const text = document.getText();
		const directives = extractUseDirectives(text);
		const statements = findStatements(text);

		return statements.map((stmt) => {
			const start = document.positionAt(stmt.startOffset);
			const range = new vscode.Range(start, start);
			const args: RunStatementArgs = {
				query: stmt.queryText,
				fileNamespace: directives.namespace,
				fileDatabase: directives.database,
				documentUri: document.uri.toString(),
			};
			return new vscode.CodeLens(range, {
				title: "▶ Run",
				command: RUN_STATEMENT_COMMAND,
				tooltip: "Run this statement against the configured SurrealDB endpoint",
				arguments: [args],
			});
		});
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
