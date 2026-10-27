import * as vscode from 'vscode';
import { log } from './log';
import { diagnose, errorMessage, startSqlJob } from './sql/backend';
import { SPOOL_SCHEME, SpoolContentProvider, spoolUri } from './spool/contentProvider';
import { DEFAULT_FILTER, SpoolFilter } from './spool/types';
import { StatusMonitor } from './statusMonitor';
import { FilterViewProvider } from './views/filterView';
import { SpoolItem, SpoolTreeProvider } from './views/spoolTree';

const FILTER_STATE_KEY = 'betterspool.filter';

export function activate(context: vscode.ExtensionContext) {
	log.info('BetterSpool activated');

	const getFilter = (): SpoolFilter => ({
		...DEFAULT_FILTER,
		maxRows: vscode.workspace.getConfiguration('betterspool').get<number>('maxRows', DEFAULT_FILTER.maxRows),
		...context.globalState.get<Partial<SpoolFilter>>(FILTER_STATE_KEY, {}),
	});

	// --- Connection / SQL job status ---------------------------------------
	const monitor = new StatusMonitor();

	// --- Spool list -------------------------------------------------------
	const tree = new SpoolTreeProvider(getFilter, monitor);
	const treeView = vscode.window.createTreeView('betterspool.spools', { treeDataProvider: tree, showCollapseAll: false });
	tree.view = treeView;
	tree.updateDescription();

	// Load automatically as soon as the connection / SQL job becomes ready,
	// clear the list when it goes away. If the view is hidden, load when it is shown.
	let loadWhenVisible = monitor.status.ready && !treeView.visible;
	if (monitor.status.ready && treeView.visible) {
		void tree.refresh(false);
	}
	const onStatusChange = () => {
		if (monitor.status.ready) {
			if (treeView.visible) {
				loadWhenVisible = false;
				void tree.refresh(false);
			} else {
				loadWhenVisible = true;
			}
		} else {
			loadWhenVisible = false;
			tree.clear();
		}
	};

	// --- Filter -------------------------------------------------------------
	const applyFilter = async (filter: SpoolFilter) => {
		await context.globalState.update(FILTER_STATE_KEY, filter);
		await tree.refresh();
	};
	const filterView = new FilterViewProvider(getFilter, filter => { void applyFilter(filter); });

	// --- Spool content ------------------------------------------------------
	const contentProvider = new SpoolContentProvider();

	context.subscriptions.push(
		log,
		monitor,
		treeView,
		monitor.onDidChange(onStatusChange),
		treeView.onDidChangeVisibility(e => {
			if (e.visible && loadWhenVisible && monitor.status.ready) {
				loadWhenVisible = false;
				void tree.refresh(false);
			}
		}),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('betterspool.sqlBackend')) {
				monitor.check();
				tree.updateDescription();
			}
		}),
		vscode.window.registerWebviewViewProvider(FilterViewProvider.viewId, filterView),
		vscode.workspace.registerTextDocumentContentProvider(SPOOL_SCHEME, contentProvider),

		vscode.commands.registerCommand('betterspool.refresh', () => tree.refresh()),

		vscode.commands.registerCommand('betterspool.resetFilter', async () => {
			filterView.postFilter(DEFAULT_FILTER);
			await applyFilter({ ...DEFAULT_FILTER });
		}),

		vscode.commands.registerCommand('betterspool.startSqlJob', () => startSqlJob()),

		vscode.commands.registerCommand('betterspool.showSpool', async (item?: SpoolItem) => {
			const target = item ?? treeView.selection[0];
			if (!target) {
				vscode.window.showInformationMessage('Select a spooled file first.');
				return;
			}
			const status = monitor.check();
			if (!status.ready) {
				const actions = status.connected ? ['Start SQL Job'] : [];
				const choice = await vscode.window.showWarningMessage(`BetterSpool: ${status.reason ?? 'Not ready.'}`, ...actions);
				if (choice) {
					await startSqlJob();
				}
				return;
			}
			const uri = spoolUri(target.spool);
			try {
				const doc = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: `Loading spooled file ${target.spool.name}…` },
					async () => vscode.workspace.openTextDocument(uri),
				);
				await vscode.window.showTextDocument(doc, { preview: false });
			} catch (e) {
				const msg = errorMessage(e);
				log.error(`Opening spooled file failed: ${msg}`);
				vscode.window.showErrorMessage(`BetterSpool: ${msg}`, 'Show log').then(choice => {
					if (choice) {
						log.show();
					}
				});
			}
		}),

		vscode.commands.registerCommand('betterspool.reloadSpool', async () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (uri?.scheme === SPOOL_SCHEME) {
				contentProvider.refresh(uri);
			}
		}),

		vscode.commands.registerCommand('betterspool.diagnose', () => diagnose()),
	);
}

export function deactivate() { }
