import * as vscode from "vscode";
import { readSettings } from "../settings";

/** Command id fired when the user clicks the status bar item. */
export const OPEN_SETTINGS_COMMAND = "surrealql.openSettings";

/**
 * Status bar widget that displays the currently configured SurrealDB
 * connection.
 *
 * Mirrors `SurQLStatusBarWidget` from the JetBrains plugin: the text format is
 * `SurrealQL: <endpoint> | <namespace>/<database>` when an endpoint is
 * configured, and `SurrealQL: not configured` otherwise. Clicking the widget
 * opens VS Code's Settings UI filtered to this extension.
 */
export class SurQLStatusBarItem {
	private readonly item: vscode.StatusBarItem;

	constructor(extensionId: string) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.command = OPEN_SETTINGS_COMMAND;
		this.item.name = "SurrealQL Connection";
		this.refresh();
		this.item.show();

		// Persist `extensionId` for the open-settings command (registered by
		// the extension host with this exact target).
		this.extensionId = extensionId;
	}

	readonly extensionId: string;

	/** Recomputes the text and tooltip from the current settings snapshot. */
	refresh(): void {
		const s = readSettings();
		if (s.endpoint.length === 0) {
			this.item.text = "$(database) SurrealQL: not configured";
			this.item.tooltip = "SurrealQL: no connection configured — click to open settings";
			return;
		}
		const endpointText = s.endpoint;
		const ctx =
			s.namespace.length > 0 && s.database.length > 0 ? `${s.namespace}/${s.database}` : null;
		this.item.text = ctx
			? `$(database) SurrealQL: ${endpointText} | ${ctx}`
			: `$(database) SurrealQL: ${endpointText}`;
		const tooltipLines = ["SurrealQL connection", `Endpoint: ${s.endpoint}`];
		if (s.namespace) tooltipLines.push(`Namespace: ${s.namespace}`);
		if (s.database) tooltipLines.push(`Database: ${s.database}`);
		if (s.authContext) tooltipLines.push(`Auth context: ${s.authContext}`);
		tooltipLines.push("", "Click to open settings");
		this.item.tooltip = tooltipLines.join("\n");
	}

	dispose(): void {
		this.item.dispose();
	}
}
