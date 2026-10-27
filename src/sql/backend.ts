import * as vscode from 'vscode';
import { log } from '../log';

/**
 * Row as returned by the underlying SQL engine. Column names are usually
 * upper-case (e.g. SPOOLED_FILE_NAME) but we never rely on that – use `col()`.
 */
export type Row = Record<string, unknown>;

export interface SqlBackend {
	/** Human readable name, shown in logs / diagnostics. */
	readonly name: string;
	readonly kind: 'db2i' | 'codeForIBMi';
	runSQL(sql: string): Promise<Row[]>;
}

export type BackendPreference = 'auto' | 'db2i' | 'codeForIBMi';

export const DB2I_EXTENSION_ID = 'halcyontechltd.vscode-db2i';
export const CODE_FOR_IBMI_EXTENSION_ID = 'halcyontechltd.code-for-ibmi';

/** Error with a machine readable reason, so the UI can react (e.g. offer "Start SQL job"). */
export class BetterSpoolError extends Error {
	constructor(public readonly code: 'notConnected' | 'noSqlJob' | 'timeout' | 'noBackend', message: string) {
		super(message);
	}
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

/** Case-insensitive column accessor, always returns a string without trailing blanks. */
export function col(row: Row, name: string): string {
	let value = row[name];
	if (value === undefined) {
		const key = Object.keys(row).find(k => k.toUpperCase() === name.toUpperCase());
		value = key ? row[key] : undefined;
	}
	if (value === undefined || value === null) {
		return '';
	}
	return String(value).trimEnd();
}

/** Different extensions return either `Row[]` or `{ data: Row[] }`. Normalise it. */
function normaliseResult(result: unknown): Row[] {
	if (Array.isArray(result)) {
		return result as Row[];
	}
	if (result && typeof result === 'object') {
		const obj = result as Record<string, unknown>;
		if (Array.isArray(obj.data)) {
			return obj.data as Row[];
		}
		if (obj.success === false) {
			throw new Error(String(obj.error ?? 'SQL request failed'));
		}
	}
	log.warn(`Unexpected SQL result shape: ${safeStringify(result)}`);
	return [];
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value)?.substring(0, 500) ?? String(value);
	} catch {
		return String(value);
	}
}

export function errorMessage(e: unknown): string {
	if (e instanceof Error) {
		return e.message;
	}
	if (e && typeof e === 'object') {
		const obj = e as Record<string, unknown>;
		if (typeof obj.message === 'string') {
			return obj.message;
		}
		if (typeof obj.error === 'string') {
			return obj.error;
		}
	}
	return safeStringify(e);
}

/** Activates the extension if needed and returns its exports. */
async function getExports(extensionId: string): Promise<any | undefined> {
	const ext = vscode.extensions.getExtension(extensionId);
	if (!ext) {
		return undefined;
	}
	return ext.isActive ? ext.exports : await ext.activate();
}

/** Returns exports only if the extension is already active (never triggers activation – safe for polling). */
function getExportsIfActive(extensionId: string): any | undefined {
	const ext = vscode.extensions.getExtension(extensionId);
	return ext?.isActive ? ext.exports : undefined;
}

function getDb2iJobManager(api: any): any | undefined {
	return api?.sqlJobManager ?? api?.jobManager ?? api?.JobManager;
}

function getPreference(): BackendPreference {
	return vscode.workspace.getConfiguration('betterspool').get<BackendPreference>('sqlBackend', 'auto');
}

function getTimeoutMs(): number {
	const seconds = vscode.workspace.getConfiguration('betterspool').get<number>('queryTimeout', 60);
	return Math.max(0, seconds) * 1000;
}

/* ------------------------------------------------------------------------- */
/* Connection / SQL job status                                               */
/* ------------------------------------------------------------------------- */

export interface ConnectionStatus {
	/** Connected to an IBM i through Code for IBM i. */
	connected: boolean;
	/** Connection name / host for display. */
	system?: string;
	user?: string;
	/** Db2 for i extension is installed and its API looks usable. */
	db2iAvailable: boolean;
	/** Selected Db2 for i SQL job (if any). */
	sqlJobName?: string;
	sqlJobStatus?: string;
	/** A Db2 for i SQL job is selected and usable. */
	sqlJobActive: boolean;
	/** Which backend `runSQL` would use right now. */
	backend?: 'db2i' | 'codeForIBMi';
	/** True when the extension is able to run SQL right now. */
	ready: boolean;
	/** Short explanation when not ready. */
	reason?: string;
}

const ACTIVE_JOB_STATES = ['ready', 'busy'];

/**
 * Computes the current connection status. Synchronous and cheap – only reads
 * in-memory state of the already active IBM i extensions, so it can be polled.
 */
export function getConnectionStatus(): ConnectionStatus {
	const preference = getPreference();

	// --- Code for IBM i connection ---
	const cfi = getExportsIfActive(CODE_FOR_IBMI_EXTENSION_ID);
	let connection: any;
	try {
		connection = cfi?.instance?.getConnection?.();
	} catch {
		connection = undefined;
	}
	const connected = !!connection;
	const system = connected
		? String(connection.currentConnectionName ?? connection.currentHost ?? connection.currentConfig?.name ?? 'IBM i')
		: undefined;
	const user = connected ? (connection.currentUser ? String(connection.currentUser) : undefined) : undefined;

	// --- Db2 for i SQL job ---
	const manager = getDb2iJobManager(getExportsIfActive(DB2I_EXTENSION_ID));
	const db2iAvailable = !!manager && (typeof manager.runSQL === 'function' || typeof manager.getSelection === 'function');
	let sqlJobName: string | undefined;
	let sqlJobStatus: string | undefined;
	let sqlJobActive = false;
	if (db2iAvailable && typeof manager.getSelection === 'function') {
		try {
			const selection = manager.getSelection();
			if (selection) {
				sqlJobName = selection.name ? String(selection.name) : undefined;
				const job = selection.job;
				const status = typeof job?.getStatus === 'function' ? job.getStatus() : job?.status;
				sqlJobStatus = status !== undefined ? String(status) : undefined;
				// if the status cannot be read, trust the selection
				sqlJobActive = sqlJobStatus === undefined || ACTIVE_JOB_STATES.includes(sqlJobStatus.toLowerCase());
			}
		} catch (e) {
			log.debug(`Reading Db2 for i job selection failed: ${errorMessage(e)}`);
		}
	}

	// --- which backend would be used ---
	let backend: ConnectionStatus['backend'];
	if (preference === 'codeForIBMi') {
		backend = 'codeForIBMi';
	} else if (preference === 'db2i' || db2iAvailable) {
		backend = 'db2i';
	} else {
		backend = cfi ? 'codeForIBMi' : undefined;
	}

	let ready = true;
	let reason: string | undefined;
	if (!cfi && !getExportsIfActive(DB2I_EXTENSION_ID)) {
		ready = false;
		reason = 'Code for IBM i / Db2 for i extensions are not active.';
	} else if (!connected) {
		ready = false;
		reason = 'Not connected to IBM i.';
	} else if (backend === 'db2i' && !sqlJobActive) {
		ready = false;
		reason = sqlJobName
			? `Db2 for i SQL job "${sqlJobName}" is not ready (${sqlJobStatus}).`
			: 'No active Db2 for i SQL job.';
	}

	return { connected, system, user, db2iAvailable, sqlJobName, sqlJobStatus, sqlJobActive, backend, ready, reason };
}

/* ------------------------------------------------------------------------- */
/* Backends                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Uses the API exported by the "Db2 for IBM i" extension. Probed shapes:
 *   - exports.sqlJobManager.runSQL(sql)
 *   - exports.sqlJobManager.getSelection().job.execute(sql)
 */
async function getDb2iBackend(): Promise<SqlBackend | undefined> {
	const api = await getExports(DB2I_EXTENSION_ID);
	if (!api) {
		log.debug('Db2 for i extension not installed or has no exports.');
		return undefined;
	}
	const manager = getDb2iJobManager(api);
	if (!manager) {
		log.debug(`Db2 for i exports do not contain a job manager. Keys: ${Object.keys(api).join(', ')}`);
		return undefined;
	}

	if (typeof manager.runSQL === 'function') {
		return {
			name: 'Db2 for i (sqlJobManager.runSQL)',
			kind: 'db2i',
			runSQL: async (sql: string) => normaliseResult(await manager.runSQL(sql)),
		};
	}
	if (typeof manager.getSelection === 'function') {
		return {
			name: 'Db2 for i (selected job.execute)',
			kind: 'db2i',
			runSQL: async (sql: string) => {
				const job = manager.getSelection()?.job;
				if (!job || typeof job.execute !== 'function') {
					throw new BetterSpoolError('noSqlJob', 'No active Db2 for i SQL job.');
				}
				return normaliseResult(await job.execute(sql));
			},
		};
	}
	log.debug(`Db2 for i job manager has no usable method. Keys: ${Object.keys(manager).join(', ')}`);
	return undefined;
}

async function getCodeForIBMiBackend(): Promise<SqlBackend | undefined> {
	const api = await getExports(CODE_FOR_IBMI_EXTENSION_ID);
	const instance = api?.instance;
	if (!instance) {
		log.debug('Code for IBM i extension not installed or has no "instance" export.');
		return undefined;
	}
	return {
		name: 'Code for IBM i (connection.runSQL)',
		kind: 'codeForIBMi',
		runSQL: async (sql: string) => {
			const connection = instance.getConnection?.();
			if (connection && typeof connection.runSQL === 'function') {
				return normaliseResult(await connection.runSQL(sql));
			}
			// Older Code for IBM i versions exposed runSQL on IBMiContent
			const content = instance.getContent?.();
			if (content && typeof content.runSQL === 'function') {
				return normaliseResult(await content.runSQL(sql));
			}
			throw new BetterSpoolError('notConnected', 'Not connected to IBM i.');
		},
	};
}

/** Picks the backend according to the `betterspool.sqlBackend` setting. */
async function selectBackend(): Promise<SqlBackend> {
	const preference = getPreference();
	const backend = preference === 'db2i' ? await getDb2iBackend()
		: preference === 'codeForIBMi' ? await getCodeForIBMiBackend()
			: (await getDb2iBackend()) ?? (await getCodeForIBMiBackend());
	if (!backend) {
		throw new BetterSpoolError('noBackend', 'No SQL backend available. Install "Db2 for IBM i" / "Code for IBM i".');
	}
	return backend;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	if (ms <= 0) {
		return promise;
	}
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new BetterSpoolError('timeout',
			`SQL request did not finish within ${ms / 1000} s. Check the IBM i connection / SQL job (setting: betterspool.queryTimeout).`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------------- */
/* Public API                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Runs SQL with the configured backend. Fails fast when not connected or when
 * Db2 for i has no active SQL job, and never waits longer than the configured timeout.
 */
export async function runSQL(sql: string): Promise<Row[]> {
	// make sure the IBM i extensions are active before reading their state
	await Promise.all([getExports(CODE_FOR_IBMI_EXTENSION_ID), getExports(DB2I_EXTENSION_ID)]).catch(() => undefined);

	const status = getConnectionStatus();
	if (!status.connected) {
		throw new BetterSpoolError('notConnected', status.reason ?? 'Not connected to IBM i.');
	}

	const backend = await selectBackend();
	if (backend.kind === 'db2i' && !status.sqlJobActive) {
		throw new BetterSpoolError('noSqlJob', status.reason ?? 'No active Db2 for i SQL job.');
	}

	log.info(`SQL> ${sql.replace(/\s+/g, ' ').trim()}`);
	const start = Date.now();
	try {
		const rows = await withTimeout(backend.runSQL(sql), getTimeoutMs());
		log.info(`  -> ${rows.length} row(s) via ${backend.name} in ${Date.now() - start} ms`);
		return rows;
	} catch (e) {
		log.warn(`  -> failed via ${backend.name} after ${Date.now() - start} ms: ${errorMessage(e)}`);
		throw e;
	}
}

/**
 * Finds the Db2 for i "new SQL job" command and runs it.
 * The command id is discovered at runtime so we do not depend on a hardcoded name.
 */
export async function startSqlJob(): Promise<boolean> {
	await getExports(DB2I_EXTENSION_ID).catch(() => undefined);
	const commands = await vscode.commands.getCommands(true);
	const commandId = ['vscode-db2i.jobManager.newJob'].find(c => commands.includes(c))
		?? commands.find(c => /db2i/i.test(c) && /newjob/i.test(c));
	if (!commandId) {
		log.warn(`Could not find a Db2 for i "new job" command. Db2 for i commands: ${commands.filter(c => /db2i/i.test(c)).join(', ')}`);
		vscode.window.showWarningMessage('BetterSpool: could not start an SQL job automatically. Start one in the Db2 for i "SQL Job Manager" view.');
		return false;
	}
	log.info(`Starting SQL job using command ${commandId}`);
	await vscode.commands.executeCommand(commandId);
	return true;
}

/**
 * Dumps what the dependent extensions export and tries a trivial query on each
 * backend. Meant for the "trial and error" phase – output goes to the log.
 */
export async function diagnose(): Promise<void> {
	log.show(true);
	log.info('===== BetterSpool diagnostics =====');

	for (const id of [DB2I_EXTENSION_ID, CODE_FOR_IBMI_EXTENSION_ID]) {
		const ext = vscode.extensions.getExtension(id);
		if (!ext) {
			log.info(`[${id}] NOT installed`);
			continue;
		}
		log.info(`[${id}] installed, version ${ext.packageJSON?.version}, active=${ext.isActive}`);
		try {
			const api = await getExports(id);
			describeObject(`[${id}] exports`, api);
			const manager = getDb2iJobManager(api);
			if (manager) {
				describeObject(`[${id}] job manager`, manager);
				const selection = manager.getSelection?.();
				log.info(`[${id}] selected job: ${selection ? `${selection.name} status=${selection.job?.getStatus?.() ?? selection.job?.status}` : 'none'}`);
			}
			if (api?.instance) {
				describeObject(`[${id}] exports.instance`, api.instance);
				const conn = api.instance.getConnection?.();
				log.info(`[${id}] instance.getConnection() -> ${conn ? 'connected' : 'not connected'}`);
				if (conn) {
					describeObject(`[${id}] connection`, conn);
				}
			}
		} catch (e) {
			log.error(`[${id}] failed to read exports: ${errorMessage(e)}`);
		}
	}

	log.info(`Status: ${safeStringify(getConnectionStatus())}`);

	const testSql = `SELECT CURRENT USER AS CUR_USER, CURRENT SERVER AS CUR_SERVER FROM SYSIBM.SYSDUMMY1`;
	for (const [label, getBackend] of [['Db2 for i', getDb2iBackend], ['Code for IBM i', getCodeForIBMiBackend]] as const) {
		try {
			const backend = await getBackend();
			if (!backend) {
				log.info(`[test ${label}] backend not available`);
				continue;
			}
			if (backend.kind === 'db2i' && !getConnectionStatus().sqlJobActive) {
				log.info(`[test ${label}] skipped – no active SQL job`);
				continue;
			}
			const rows = await withTimeout(backend.runSQL(testSql), 15000);
			log.info(`[test ${label}] OK via ${backend.name}: ${safeStringify(rows)}`);
		} catch (e) {
			log.error(`[test ${label}] FAILED: ${errorMessage(e)}`);
		}
	}
	log.info('===== end of diagnostics =====');
}

function describeObject(label: string, obj: unknown) {
	if (!obj || typeof obj !== 'object') {
		log.info(`${label}: ${String(obj)}`);
		return;
	}
	const own = Object.keys(obj);
	const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(obj) ?? {}).filter(k => k !== 'constructor');
	log.info(`${label}: own keys = [${own.join(', ')}]; prototype methods = [${proto.join(', ')}]`);
}
