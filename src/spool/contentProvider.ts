import * as vscode from 'vscode';
import { col, runSQL } from '../sql/backend';
import { buildContentQuery } from './queries';
import { SpoolFile } from './types';

export const SPOOL_SCHEME = 'betterspool';

/** Builds a virtual document URI for a spooled file, e.g. betterspool:/QSYSPRT_123456_5.splf?... */
export function spoolUri(spool: Pick<SpoolFile, 'jobName' | 'name' | 'number'>): vscode.Uri {
	const jobNumber = spool.jobName.split('/')[0] ?? '';
	const jobName = spool.jobName.split('/')[2] ?? '';
	const fileName = [spool.name, jobName, jobNumber, spool.number].filter(Boolean).join('_') + '.splf';
	const query = new URLSearchParams({ job: spool.jobName, name: spool.name, number: String(spool.number) }).toString();
	return vscode.Uri.from({ scheme: SPOOL_SCHEME, path: '/' + fileName, query });
}

/**
 * Read-only virtual documents with spooled file content.
 * Content is fetched from IBM i every time VS Code asks for the document.
 */
export class SpoolContentProvider implements vscode.TextDocumentContentProvider {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changeEmitter.event;

	refresh(uri: vscode.Uri) {
		this.changeEmitter.fire(uri);
	}

	async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
		const params = new URLSearchParams(uri.query);
		const spool = {
			jobName: params.get('job') ?? '',
			name: params.get('name') ?? '',
			number: Number(params.get('number') ?? '0'),
		};

		const rows = await runSQL(buildContentQuery(spool));
		if (token.isCancellationRequested) {
			return '';
		}

		const trim = vscode.workspace.getConfiguration('betterspool').get<boolean>('trimTrailingSpaces', true);
		const lines = rows.map(row => {
			// col() already trims trailing whitespace; keep raw value if trimming is disabled
			if (trim) {
				return col(row, 'SPOOLED_DATA');
			}
			const raw = row['SPOOLED_DATA'] ?? Object.values(row)[0];
			return raw === null || raw === undefined ? '' : String(raw);
		});
		return lines.join('\n');
	}
}
