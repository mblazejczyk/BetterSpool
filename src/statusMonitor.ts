import * as vscode from 'vscode';
import { ConnectionStatus, getConnectionStatus } from './sql/backend';
import { log } from './log';

const POLL_INTERVAL_MS = 2000;

/**
 * Watches the IBM i connection (Code for IBM i) and the selected SQL job (Db2 for i).
 * Neither extension offers a documented change event for both, so the in-memory
 * state is polled – it is cheap, nothing is sent to the server.
 *
 * Context keys (used in package.json `when` clauses):
 *   betterspool.connected     – connected to an IBM i
 *   betterspool.needsSqlJob   – connected, Db2 for i backend selected, but no active SQL job
 *   betterspool.ready         – SQL can be executed
 */
export class StatusMonitor implements vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<ConnectionStatus>();
	/** Fires when the readiness / connection / job changes. */
	readonly onDidChange = this.changeEmitter.event;

	private current: ConnectionStatus = getConnectionStatus();
	private timer: NodeJS.Timeout | undefined;

	constructor() {
		this.applyContext(this.current);
		this.timer = setInterval(() => this.check(), POLL_INTERVAL_MS);
	}

	get status(): ConnectionStatus {
		return this.current;
	}

	/** Re-reads the status immediately (also called by the poller). */
	check(): ConnectionStatus {
		const next = getConnectionStatus();
		if (this.key(next) !== this.key(this.current)) {
			log.info(`Status changed: ${next.ready ? 'ready' : 'not ready'} – ${this.describe(next)}`);
			this.current = next;
			this.applyContext(next);
			this.changeEmitter.fire(next);
		} else {
			this.current = next;
		}
		return next;
	}

	/** Short text for the view description, e.g. "MYSYS · job QZDASOINIT" */
	describe(status: ConnectionStatus = this.current): string {
		if (!status.connected) {
			return status.reason ?? 'Not connected';
		}
		const parts = [status.system ?? 'IBM i'];
		if (status.backend === 'db2i') {
			parts.push(status.sqlJobActive ? `SQL job ${status.sqlJobName ?? ''}`.trim() : 'no SQL job');
		}
		return parts.join(' · ');
	}

	private key(s: ConnectionStatus): string {
		return [s.connected, s.system, s.backend, s.sqlJobActive, s.sqlJobName, s.ready].join('|');
	}

	private applyContext(s: ConnectionStatus) {
		void vscode.commands.executeCommand('setContext', 'betterspool.connected', s.connected);
		void vscode.commands.executeCommand('setContext', 'betterspool.needsSqlJob', s.connected && s.backend === 'db2i' && !s.sqlJobActive);
		void vscode.commands.executeCommand('setContext', 'betterspool.ready', s.ready);
	}

	dispose() {
		if (this.timer) {
			clearInterval(this.timer);
		}
		this.changeEmitter.dispose();
	}
}
