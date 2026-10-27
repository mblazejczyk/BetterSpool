import * as vscode from 'vscode';

/** Shared log output channel ("Output" panel → "BetterSpool"). */
export const log = vscode.window.createOutputChannel('BetterSpool', { log: true });
