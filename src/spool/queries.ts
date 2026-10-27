import { SpoolFile, SpoolFilter } from './types';

/** Escapes a value for use inside a single-quoted SQL literal. */
export function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** `ABC*` → `LIKE 'ABC%'`, `ABC` → `= 'ABC'` */
function matchCondition(column: string, rawValue: string, upperCase = true): string {
	let value = rawValue.trim();
	if (upperCase) {
		value = value.toUpperCase();
	}
	if (value.includes('*') || value.includes('%')) {
		return `${column} LIKE ${sqlString(value.replace(/\*/g, '%'))}`;
	}
	return `${column} = ${sqlString(value)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds the list query. Uses QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC (IBM i 7.2+).
 * Date / time are formatted on the server so the result does not depend on the
 * timestamp format of the SQL backend in use.
 */
export function buildListQuery(f: SpoolFilter): string {
	const where: string[] = [];

	const user = f.user.trim().toUpperCase();
	if (user === '' || user === '*CURRENT') {
		where.push('USER_NAME = USER');
	} else if (user !== '*ALL') {
		where.push(matchCondition('USER_NAME', user));
	}

	if (f.outqLibrary.trim()) {
		where.push(matchCondition('OUTPUT_QUEUE_LIBRARY_NAME', f.outqLibrary));
	}
	if (f.outq.trim()) {
		where.push(matchCondition('OUTPUT_QUEUE_NAME', f.outq));
	}
	if (f.spoolName.trim()) {
		where.push(matchCondition('SPOOLED_FILE_NAME', f.spoolName));
	}
	if (f.userData.trim()) {
		// user data is case sensitive
		where.push(matchCondition('USER_DATA', f.userData, false));
	}
	if (f.jobName.trim()) {
		const job = f.jobName.trim().toUpperCase();
		if (job.includes('/') || job.includes('*')) {
			where.push(matchCondition('JOB_NAME', job));
		} else {
			// just a job name or a job number
			where.push(`(JOB_NAME LIKE ${sqlString('%/' + job)} OR JOB_NAME LIKE ${sqlString(job + '/%')})`);
		}
	}
	if (f.status.trim()) {
		where.push(`STATUS = ${sqlString(f.status.trim().toUpperCase())}`);
	}
	if (DATE_RE.test(f.dateFrom)) {
		where.push(`CREATE_TIMESTAMP >= TIMESTAMP(${sqlString(f.dateFrom + ' 00:00:00')})`);
	}
	if (DATE_RE.test(f.dateTo)) {
		where.push(`CREATE_TIMESTAMP < TIMESTAMP(${sqlString(f.dateTo + ' 00:00:00')}) + 1 DAY`);
	}

	const maxRows = Math.max(1, Math.min(Number(f.maxRows) || 500, 100000));

	return [
		'SELECT SPOOLED_FILE_NAME, FILE_NUMBER, JOB_NAME, USER_NAME, USER_DATA, STATUS,',
		'       TOTAL_PAGES, SIZE, OUTPUT_QUEUE_LIBRARY_NAME, OUTPUT_QUEUE_NAME, FORM_TYPE,',
		"       VARCHAR_FORMAT(CREATE_TIMESTAMP, 'YYYY-MM-DD') AS CREATE_DATE,",
		"       VARCHAR_FORMAT(CREATE_TIMESTAMP, 'HH24:MI:SS') AS CREATE_TIME",
		'  FROM QSYS2.OUTPUT_QUEUE_ENTRIES_BASIC',
		where.length ? ` WHERE ${where.join('\n   AND ')}` : '',
		' ORDER BY CREATE_TIMESTAMP DESC',
		` FETCH FIRST ${maxRows} ROWS ONLY`,
	].filter(Boolean).join('\n');
}

/** Reads the content of a spooled file using SYSTOOLS.SPOOLED_FILE_DATA. */
export function buildContentQuery(spool: Pick<SpoolFile, 'jobName' | 'name' | 'number'>): string {
	return [
		'SELECT SPOOLED_DATA',
		'  FROM TABLE(SYSTOOLS.SPOOLED_FILE_DATA(',
		`         JOB_NAME => ${sqlString(spool.jobName)},`,
		`         SPOOLED_FILE_NAME => ${sqlString(spool.name)},`,
		`         SPOOLED_FILE_NUMBER => ${sqlString(String(spool.number))}))`,
		' ORDER BY ORDINAL_POSITION',
	].join('\n');
}
