import * as vscode from 'vscode';
import { DEFAULT_FILTER, SpoolFilter } from '../spool/types';

type FromWebview =
	| { type: 'ready' }
	| { type: 'apply'; filter: SpoolFilter }
	| { type: 'reset' };

const STATUSES = ['READY', 'HELD', 'SAVED', 'WRITING', 'PENDING', 'PRINTER', 'MESSAGE', 'OPEN', 'CLOSED', 'DEFERRED', 'SENDING', 'FINISHED'];

/** Sidebar webview with the spool filter form. */
export class FilterViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'betterspool.filter';
	private view?: vscode.WebviewView;

	constructor(
		private readonly getFilter: () => SpoolFilter,
		private readonly onApply: (filter: SpoolFilter) => void,
	) { }

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((msg: FromWebview) => {
			switch (msg.type) {
				case 'ready':
					this.postFilter(this.getFilter());
					break;
				case 'apply':
					this.onApply(sanitize(msg.filter));
					break;
				case 'reset':
					this.postFilter(DEFAULT_FILTER);
					this.onApply({ ...DEFAULT_FILTER, maxRows: defaultMaxRows() });
					break;
			}
		});
	}

	/** Pushes a filter into the form (e.g. after "reset" from the command palette). */
	postFilter(filter: SpoolFilter) {
		this.view?.webview.postMessage({ type: 'setFilter', filter });
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = makeNonce();
		const statusOptions = ['<option value="">(any)</option>', ...STATUSES.map(s => `<option value="${s}">${s}</option>`)].join('');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	body { padding: 4px 8px 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
	form { display: grid; gap: 6px; }
	label { display: grid; gap: 2px; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
	.row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	input, select {
		box-sizing: border-box; width: 100%; padding: 3px 6px;
		color: var(--vscode-input-foreground); background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
		font-family: inherit; font-size: inherit;
	}
	input:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
	input[type="date"] { color-scheme: light dark; }
	.buttons { display: flex; gap: 6px; margin-top: 6px; }
	button {
		flex: 1; padding: 4px 8px; border: none; border-radius: 2px; cursor: pointer;
		color: var(--vscode-button-foreground); background: var(--vscode-button-background);
		font-family: inherit; font-size: inherit;
	}
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
	button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
	.hint { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
</style>
</head>
<body>
<form id="filter" autocomplete="off">
	<label>User
		<input name="user" placeholder="*CURRENT, *ALL, USER or USR*" spellcheck="false">
	</label>
	<div class="row">
		<label>Output queue lib
			<input name="outqLibrary" placeholder="QUSRSYS" spellcheck="false">
		</label>
		<label>Output queue
			<input name="outq" placeholder="any" spellcheck="false">
		</label>
	</div>
	<div class="row">
		<label>Spooled file
			<input name="spoolName" placeholder="QSYSPRT" spellcheck="false">
		</label>
		<label>User data
			<input name="userData" placeholder="any" spellcheck="false">
		</label>
	</div>
	<label>Job
		<input name="jobName" placeholder="123456/USER/JOB, JOB or 123456" spellcheck="false">
	</label>
	<div class="row">
		<label>Status
			<select name="status">${statusOptions}</select>
		</label>
		<label>Max rows
			<input name="maxRows" type="number" min="1" max="100000" step="1">
		</label>
	</div>
	<div class="row">
		<label>From date
			<input name="dateFrom" type="date">
		</label>
		<label>To date
			<input name="dateTo" type="date">
		</label>
	</div>
	<div class="buttons">
		<button type="submit">Search</button>
		<button type="button" class="secondary" id="reset">Reset</button>
	</div>
	<div class="hint">Use * as a wildcard, e.g. QPJOB*.</div>
</form>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const form = document.getElementById('filter');

	function fill(filter) {
		for (const [key, value] of Object.entries(filter)) {
			const el = form.elements.namedItem(key);
			if (el) { el.value = value ?? ''; }
		}
	}

	function read() {
		const data = Object.fromEntries(new FormData(form).entries());
		data.maxRows = Number(data.maxRows) || 500;
		return data;
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		vscode.postMessage({ type: 'apply', filter: read() });
	});
	document.getElementById('reset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }));

	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (msg.type === 'setFilter') { fill(msg.filter); }
	});

	vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
	}
}

function defaultMaxRows(): number {
	return vscode.workspace.getConfiguration('betterspool').get<number>('maxRows', DEFAULT_FILTER.maxRows);
}

function sanitize(input: Partial<SpoolFilter>): SpoolFilter {
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	return {
		user: str(input.user) || '*CURRENT',
		outqLibrary: str(input.outqLibrary),
		outq: str(input.outq),
		spoolName: str(input.spoolName),
		userData: str(input.userData),
		jobName: str(input.jobName),
		status: str(input.status),
		dateFrom: str(input.dateFrom),
		dateTo: str(input.dateTo),
		maxRows: Number(input.maxRows) || defaultMaxRows(),
	};
}

function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}
