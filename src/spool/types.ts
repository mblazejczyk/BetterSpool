import { col, Row } from '../sql/backend';

export interface SpoolFilter {
	/** `*CURRENT` (default), `*ALL`, a user profile or a generic name like `ABC*`. */
	user: string;
	outqLibrary: string;
	outq: string;
	/** Spooled file name, e.g. QSYSPRT. Generic `*` allowed. */
	spoolName: string;
	userData: string;
	/** Qualified job name 123456/USER/JOBNAME or a part of it. Generic `*` allowed. */
	jobName: string;
	/** Empty = any status. Otherwise READY, HELD, SAVED, WRITING, ... */
	status: string;
	/** yyyy-mm-dd */
	dateFrom: string;
	/** yyyy-mm-dd */
	dateTo: string;
	maxRows: number;
}

export const DEFAULT_FILTER: SpoolFilter = {
	user: '*CURRENT',
	outqLibrary: '',
	outq: '',
	spoolName: '',
	userData: '',
	jobName: '',
	status: '',
	dateFrom: '',
	dateTo: '',
	maxRows: 500,
};

export interface SpoolFile {
	name: string;
	number: number;
	jobName: string;
	user: string;
	userData: string;
	status: string;
	pages: number;
	size: string;
	outqLibrary: string;
	outq: string;
	formType: string;
	createDate: string;
	createTime: string;
}

export function rowToSpoolFile(row: Row): SpoolFile {
	return {
		name: col(row, 'SPOOLED_FILE_NAME'),
		number: Number(col(row, 'FILE_NUMBER')) || 0,
		jobName: col(row, 'JOB_NAME'),
		user: col(row, 'USER_NAME'),
		userData: col(row, 'USER_DATA'),
		status: col(row, 'STATUS'),
		pages: Number(col(row, 'TOTAL_PAGES')) || 0,
		size: col(row, 'SIZE'),
		outqLibrary: col(row, 'OUTPUT_QUEUE_LIBRARY_NAME'),
		outq: col(row, 'OUTPUT_QUEUE_NAME'),
		formType: col(row, 'FORM_TYPE'),
		createDate: col(row, 'CREATE_DATE'),
		createTime: col(row, 'CREATE_TIME'),
	};
}

/** Human readable one-line summary of the active filter. */
export function describeFilter(f: SpoolFilter): string {
	const parts: string[] = [`User: ${f.user || '*ALL'}`];
	if (f.outq) {
		parts.push(`OutQ: ${f.outqLibrary ? f.outqLibrary + '/' : ''}${f.outq}`);
	}
	if (f.spoolName) {
		parts.push(`File: ${f.spoolName}`);
	}
	if (f.userData) {
		parts.push(`UsrDta: ${f.userData}`);
	}
	if (f.jobName) {
		parts.push(`Job: ${f.jobName}`);
	}
	if (f.status) {
		parts.push(`Status: ${f.status}`);
	}
	if (f.dateFrom || f.dateTo) {
		parts.push(`Date: ${f.dateFrom || '…'} – ${f.dateTo || '…'}`);
	}
	return parts.join(' · ');
}
