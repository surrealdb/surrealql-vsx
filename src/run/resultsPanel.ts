import * as vscode from "vscode";
import type { QueryResult } from "./queryRunner";

/** View id registered in `package.json` under `contributes.views`. */
export const RESULTS_VIEW_ID = "surrealqlResultsView";

/** History capacity (matches the JetBrains plugin). */
const MAX_HISTORY = 50;

/**
 * One persisted entry in the query history. The `id` is monotonically
 * increasing within a session and used by the webview to identify selections.
 */
interface HistoryEntry {
	readonly id: number;
	readonly result: QueryResult;
	readonly timestamp: string;
}

type ExtensionToWebview =
	| { type: "init"; entries: HistoryEntry[]; selectedId: number | null }
	| { type: "addResult"; entry: HistoryEntry }
	| { type: "clear" };

type WebviewToExtension =
	| { type: "ready" }
	| { type: "copyJson"; text: string }
	| { type: "clear" };

function nowTimestamp(): string {
	return new Date().toLocaleTimeString(undefined, { hour12: false });
}

/**
 * `WebviewViewProvider` for the "SurrealQL Results" panel. Holds the in-memory
 * query history (max 50 entries, not persisted across reloads) and renders a
 * theme-aware history-plus-detail layout.
 *
 * The provider keeps the canonical history. The webview is recreated whenever
 * the user collapses/expands the panel, so we re-send the history on each
 * `resolveWebviewView` to keep the UI in sync.
 */
export class SurQLResultsViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | null = null;
	private readonly history: HistoryEntry[] = [];
	private nextId = 1;
	private selectedId: number | null = null;

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};
		webviewView.webview.html = this.renderHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
			if (msg.type === "ready") {
				this.post({ type: "init", entries: this.history, selectedId: this.selectedId });
				return;
			}
			if (msg.type === "copyJson") {
				vscode.env.clipboard.writeText(msg.text);
				vscode.window.setStatusBarMessage("SurrealQL: result JSON copied", 2000);
				return;
			}
			if (msg.type === "clear") {
				this.clear();
			}
		});

		webviewView.onDidDispose(() => {
			if (this.view === webviewView) this.view = null;
		});
	}

	/** Adds `result` to the history and surfaces it in the panel. */
	addResult(result: QueryResult): void {
		const entry: HistoryEntry = {
			id: this.nextId++,
			result,
			timestamp: nowTimestamp(),
		};
		this.history.unshift(entry);
		while (this.history.length > MAX_HISTORY) this.history.pop();
		this.selectedId = entry.id;
		this.post({ type: "addResult", entry });
	}

	/** Clears the in-memory history and notifies the webview. */
	clear(): void {
		this.history.length = 0;
		this.selectedId = null;
		this.post({ type: "clear" });
	}

	/** Reveals the panel (if hidden) and focuses it. */
	async reveal(): Promise<void> {
		if (this.view !== null) {
			this.view.show(true);
			return;
		}
		await vscode.commands.executeCommand(`${RESULTS_VIEW_ID}.focus`);
	}

	private post(message: ExtensionToWebview): void {
		this.view?.webview.postMessage(message);
	}

	private renderHtml(webview: vscode.Webview): string {
		const nonce = randomNonce();
		const cspSource = webview.cspSource;
		// Pre-compose the meta CSP because templating it inside the literal
		// makes the line uncomfortably long for biome's lineWidth.
		const csp =
			`default-src 'none'; ` +
			`style-src ${cspSource} 'unsafe-inline'; ` +
			`script-src 'nonce-${nonce}';`;

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<title>SurrealQL Results</title>
	<style>${PANEL_STYLES}</style>
</head>
<body>
	<div class="toolbar">
		<button id="copy-json" type="button" title="Copy raw JSON to clipboard">Copy JSON</button>
		<button id="toggle-json" type="button" title="Toggle between table and raw JSON view">Show JSON</button>
		<span class="spacer"></span>
		<button id="clear" type="button" title="Clear query history">Clear</button>
	</div>
	<div class="layout">
		<aside class="history">
			<ul id="history-list" role="listbox" aria-label="Query history"></ul>
			<div id="history-empty" class="empty">No queries run yet.</div>
		</aside>
		<section class="detail">
			<header id="status" class="status"></header>
			<div id="content" class="content">
				<p class="placeholder">Run a query using the ▶ Run button in the editor.</p>
			</div>
		</section>
	</div>
	<script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
	}
}

function randomNonce(): string {
	let s = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
	return s;
}

const PANEL_STYLES = `
:root { color-scheme: var(--vscode-color-scheme, light dark); }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; padding: 0; }
body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-foreground);
	background: var(--vscode-sideBar-background, var(--vscode-editor-background));
	display: flex;
	flex-direction: column;
}
.toolbar {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 8px;
	border-bottom: 1px solid var(--vscode-panel-border, transparent);
	background: var(--vscode-sideBarSectionHeader-background, transparent);
}
.toolbar .spacer { flex: 1; }
.toolbar button {
	background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
	color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
	border: 1px solid transparent;
	padding: 3px 10px;
	border-radius: 2px;
	font: inherit;
	cursor: pointer;
}
.toolbar button:hover {
	background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
}
.toolbar button:focus-visible {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: 1px;
}
.layout {
	display: grid;
	grid-template-columns: minmax(160px, 28%) 1fr;
	flex: 1;
	min-height: 0;
}
.history {
	border-right: 1px solid var(--vscode-panel-border, transparent);
	overflow-y: auto;
	min-height: 0;
}
#history-list {
	list-style: none;
	margin: 0;
	padding: 0;
}
#history-list li {
	padding: 6px 10px;
	cursor: pointer;
	border-bottom: 1px solid var(--vscode-panel-border, transparent);
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
#history-list li.err { color: var(--vscode-errorForeground, #f48771); }
#history-list li:hover { background: var(--vscode-list-hoverBackground); }
#history-list li.selected {
	background: var(--vscode-list-activeSelectionBackground);
	color: var(--vscode-list-activeSelectionForeground);
}
#history-list li .meta {
	color: var(--vscode-descriptionForeground);
	margin-left: 8px;
	font-size: 0.9em;
}
#history-list li.selected .meta {
	color: inherit;
	opacity: 0.85;
}
.empty {
	color: var(--vscode-descriptionForeground);
	padding: 10px;
	font-style: italic;
}
.detail {
	display: flex;
	flex-direction: column;
	min-height: 0;
	min-width: 0;
}
.status {
	padding: 6px 10px;
	border-bottom: 1px solid var(--vscode-panel-border, transparent);
	color: var(--vscode-descriptionForeground);
	font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
	font-size: 0.95em;
	min-height: 1.6em;
}
.status.err { color: var(--vscode-errorForeground, #f48771); }
.content {
	flex: 1;
	overflow: auto;
	padding: 10px;
	min-height: 0;
}
.placeholder {
	color: var(--vscode-descriptionForeground);
	font-style: italic;
}
table.results {
	border-collapse: collapse;
	width: max-content;
	min-width: 100%;
	font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
	font-size: var(--vscode-editor-font-size, inherit);
}
table.results th, table.results td {
	border: 1px solid var(--vscode-panel-border, transparent);
	padding: 4px 8px;
	text-align: left;
	vertical-align: top;
	white-space: pre-wrap;
	word-break: break-word;
}
table.results th {
	background: var(--vscode-editorHoverWidget-background, transparent);
	font-weight: 600;
	position: sticky;
	top: 0;
}
table.results tr:nth-child(even) td {
	background: var(--vscode-list-hoverBackground, transparent);
}
pre.json, pre.error {
	margin: 0;
	white-space: pre-wrap;
	word-wrap: break-word;
	font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
	font-size: var(--vscode-editor-font-size, inherit);
}
pre.error { color: var(--vscode-errorForeground, #f48771); }
`;

const PANEL_SCRIPT = `
(function() {
	const vscode = acquireVsCodeApi();
	const historyList = document.getElementById("history-list");
	const historyEmpty = document.getElementById("history-empty");
	const statusEl = document.getElementById("status");
	const contentEl = document.getElementById("content");
	const copyBtn = document.getElementById("copy-json");
	const toggleBtn = document.getElementById("toggle-json");
	const clearBtn = document.getElementById("clear");

	let history = [];
	let selectedId = null;
	let showJson = false;

	copyBtn.addEventListener("click", () => {
		const entry = currentEntry();
		if (!entry) return;
		const text = entry.result.rawJson || JSON.stringify(entry.result.rows, null, 2);
		vscode.postMessage({ type: "copyJson", text });
	});
	toggleBtn.addEventListener("click", () => {
		showJson = !showJson;
		toggleBtn.textContent = showJson ? "Show table" : "Show JSON";
		render();
	});
	clearBtn.addEventListener("click", () => {
		vscode.postMessage({ type: "clear" });
	});

	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (!msg || typeof msg !== "object") return;
		if (msg.type === "init") {
			history = msg.entries.slice();
			selectedId = msg.selectedId ?? (history[0]?.id ?? null);
			render();
		} else if (msg.type === "addResult") {
			history.unshift(msg.entry);
			if (history.length > 50) history.pop();
			selectedId = msg.entry.id;
			render();
		} else if (msg.type === "clear") {
			history = [];
			selectedId = null;
			render();
		}
	});

	function currentEntry() {
		return history.find((e) => e.id === selectedId) || history[0] || null;
	}

	function render() {
		renderHistory();
		renderDetail();
	}

	function renderHistory() {
		historyList.innerHTML = "";
		if (history.length === 0) {
			historyEmpty.style.display = "block";
			return;
		}
		historyEmpty.style.display = "none";
		for (const entry of history) {
			const li = document.createElement("li");
			const firstLine = (entry.result.query.split(/\\r?\\n/)[0] || "").trim();
			const label = firstLine.length > 46 ? firstLine.slice(0, 43) + "…" : firstLine;
			const text = document.createElement("span");
			text.textContent = label || "(empty statement)";
			const meta = document.createElement("span");
			meta.className = "meta";
			meta.textContent = entry.timestamp;
			li.appendChild(text);
			li.appendChild(meta);
			if (entry.id === selectedId) li.classList.add("selected");
			if (entry.result.status === "ERR") li.classList.add("err");
			li.addEventListener("click", () => {
				selectedId = entry.id;
				render();
			});
			historyList.appendChild(li);
		}
	}

	function renderDetail() {
		const entry = currentEntry();
		if (!entry) {
			statusEl.textContent = "";
			statusEl.classList.remove("err");
			contentEl.innerHTML = "<p class=\\"placeholder\\">Run a query using the \u25B6 Run button in the editor.</p>";
			return;
		}
		const r = entry.result;
		const parts = [r.status];
		if (r.time) parts.push(r.time);
		if (r.rows && r.rows.length > 0) parts.push(r.rows.length + " row(s)");
		statusEl.textContent = parts.join("  ·  ");
		statusEl.classList.toggle("err", r.status === "ERR");

		contentEl.innerHTML = "";
		if (r.error) {
			const pre = document.createElement("pre");
			pre.className = "error";
			pre.textContent = r.error;
			contentEl.appendChild(pre);
			return;
		}
		if (!showJson && r.rows && r.rows.length > 0) {
			contentEl.appendChild(buildTable(r.rows));
			return;
		}
		const pre = document.createElement("pre");
		pre.className = "json";
		pre.textContent = r.rawJson && r.rawJson.length > 0 ? r.rawJson : "(no results)";
		contentEl.appendChild(pre);
	}

	function buildTable(rows) {
		const keys = [];
		const seen = new Set();
		for (const row of rows) {
			for (const k of Object.keys(row)) {
				if (!seen.has(k)) { seen.add(k); keys.push(k); }
			}
		}
		const table = document.createElement("table");
		table.className = "results";
		const thead = document.createElement("thead");
		const headRow = document.createElement("tr");
		for (const k of keys) {
			const th = document.createElement("th");
			th.textContent = k;
			headRow.appendChild(th);
		}
		thead.appendChild(headRow);
		table.appendChild(thead);
		const tbody = document.createElement("tbody");
		for (const row of rows) {
			const tr = document.createElement("tr");
			for (const k of keys) {
				const td = document.createElement("td");
				const v = row[k];
				td.textContent = v === null || v === undefined ? "" : String(v);
				tr.appendChild(td);
			}
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		return table;
	}

	vscode.postMessage({ type: "ready" });
})();
`;
