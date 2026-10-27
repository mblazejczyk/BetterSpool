import * as vscode from 'vscode';
import { BetterSpoolError, errorMessage, runSQL, startSqlJob } from '../sql/backend';
import { log } from '../log';
import { buildListQuery } from '../spool/queries';
import { describeFilter, rowToSpoolFile, SpoolFile, SpoolFilter } from '../spool/types';
import { StatusMonitor } from '../statusMonitor';

export class SpoolItem extends vscode.TreeItem {
	constructor(public readonly spool: SpoolFile) {
		super(spool.name, vscode.TreeItemCollapsibleState.None);
		this.description = `${spool.createDate} ${spool.createTime}`;
		this.contextValue = 'spoolFile';
		this.iconPath = new vscode.ThemeIcon(spool.status === 'HELD' ? 'debug-pause' : 'output');

		const md = new vscode.MarkdownString(undefined, true);
		md.appendMarkdown(`**${spool.name}** (#${spool.number})\n\n`);
		md.appendMarkdown([
			`| | |`,
			`|---|---|`,
			`| Created | ${spool.createDate} ${spool.createTime} |`,
			`| Job | ${spool.jobName} |`,
			`| User | ${spool.user} |`,
			`| User data | ${spool.userData || '-'} |`,
			`| Status | ${spool.status} |`,
			`| Pages | ${spool.pages} |`,
			`| Size | ${spool.size} |`,
			`| Output queue | ${spool.outqLibrary}/${spool.outq} |`,
			`| Form type | ${spool.formType} |`,
		].join('\n'));
		this.tooltip = md;
	}
}

export class SpoolTreeProvider implements vscode.TreeDataProvider<SpoolItem> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private items: SpoolItem[] = [];
	private running: Promise<void> | undefined;
	view?: vscode.TreeView<SpoolItem>;

	constructor(
		private readonly getFilter: () => SpoolFilter,
		private readonly monitor: StatusMonitor,
	) { }

	/**
	 * Re-reads the spool list from IBM i.
	 * @param interactive show notifications when the list cannot be loaded
	 */
	refresh(interactive = true): Promise<void> {
		// never run two list queries at the same time
		this.running ??= this.doRefresh(interactive).finally(() => { this.running = undefined; });
		return this.running;
	}

	/** Empties the list – the welcome content (connect / start SQL job) becomes visible. */
	clear() {
		this.items = [];
		if (this.view) {
			this.view.message = undefined;
		}
		this.updateDescription();
		this.changeEmitter.fire();
	}

	private async doRefresh(interactive: boolean): Promise<void> {
		const filter = this.getFilter();
		const status = this.monitor.check();
		if (!status.ready) {
			this.clear();
			if (interactive) {
				await this.reportNotReady(status.connected ? 'noSqlJob' : 'notConnected', status.reason);
			}
			return;
		}

		this.updateDescription('…');
		try {
			const rows = await vscode.window.withProgress(
				{ location: { viewId: 'betterspool.spools' }, title: 'Loading spooled files' },
				() => runSQL(buildListQuery(filter)),
			);
			this.items = rows.map(r => new SpoolItem(rowToSpoolFile(r)));
			if (this.view) {
				this.view.message = this.items.length ? undefined : 'No spooled files match the filter.';
			}
			this.updateDescription(String(this.items.length));
		} catch (e) {
			const msg = errorMessage(e);
			log.error(`Loading spooled files failed: ${msg}`);
			this.items = [];
			if (e instanceof BetterSpoolError && (e.code === 'notConnected' || e.code === 'noSqlJob')) {
				if (this.view) {
					this.view.message = undefined;
				}
				this.updateDescription();
				if (interactive) {
					void this.reportNotReady(e.code, msg);
				}
			} else {
				if (this.view) {
					this.view.message = `Error: ${msg}`;
				}
				this.updateDescription('error');
				if (interactive) {
					vscode.window.showErrorMessage(`BetterSpool: ${msg}`, 'Show log').then(choice => {
						if (choice) {
							log.show();
						}
					});
				}
			}
		}
		this.changeEmitter.fire();
	}

	private async reportNotReady(code: 'notConnected' | 'noSqlJob', reason?: string) {
		if (code === 'notConnected') {
			vscode.window.showWarningMessage(`BetterSpool: ${reason ?? 'Not connected to IBM i.'} Connect with Code for IBM i first.`);
			return;
		}
		const choice = await vscode.window.showWarningMessage(`BetterSpool: ${reason ?? 'No active Db2 for i SQL job.'}`, 'Start SQL Job');
		if (choice) {
			await startSqlJob();
		}
	}

	/** View title description: "<system> · <count> · <filter>" */
	updateDescription(count?: string) {
		if (!this.view) {
			return;
		}
		const parts = [this.monitor.describe()];
		if (this.monitor.status.ready) {
			if (count !== undefined) {
				parts.push(count);
			}
			parts.push(describeFilter(this.getFilter()));
		}
		this.view.description = parts.join(' · ');
	}

	getTreeItem(element: SpoolItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: SpoolItem): SpoolItem[] {
		// an empty root list shows the welcome content (viewsWelcome)
		return element ? [] : this.items;
	}
}
