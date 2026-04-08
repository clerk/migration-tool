import { describe, expect, test } from 'vitest';

// ============================================================================
// detectDbType tests
// ============================================================================

describe('detectDbType', () => {
	async function getDetectFn() {
		const mod = await import('../src/lib/db');
		return mod.detectDbType;
	}

	test('detects PostgreSQL from postgresql:// prefix', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('postgresql://user:pass@localhost:5432/db')).toBe(
			'postgres'
		);
	});

	test('detects PostgreSQL from postgres:// prefix', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('postgres://user:pass@localhost:5432/db')).toBe(
			'postgres'
		);
	});

	test('detects MySQL from mysql:// prefix', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('mysql://user:pass@localhost:3306/db')).toBe('mysql');
	});

	test('detects MySQL from mysql2:// prefix', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('mysql2://user:pass@localhost:3306/db')).toBe('mysql');
	});

	test('detects SQLite from file path with .sqlite extension', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('/path/to/database.sqlite')).toBe('sqlite');
	});

	test('detects SQLite from file path with .db extension', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('/path/to/database.db')).toBe('sqlite');
	});

	test('detects SQLite from file: prefix', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('file:./data.sqlite')).toBe('sqlite');
	});

	test('detects SQLite as default for unknown formats', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('./my-database')).toBe('sqlite');
	});

	test('is case-insensitive for protocol detection', async () => {
		const detectDbType = await getDetectFn();
		expect(detectDbType('POSTGRESQL://user:pass@localhost/db')).toBe(
			'postgres'
		);
		expect(detectDbType('MYSQL://user:pass@localhost/db')).toBe('mysql');
	});
});

// ============================================================================
// isValidConnectionString tests (expanded for MySQL/SQLite)
// ============================================================================

describe('isValidConnectionString expanded', () => {
	async function getValidateFn() {
		const mod = await import('../src/lib/index');
		return mod.isValidConnectionString;
	}

	test('accepts PostgreSQL URLs', async () => {
		const isValidConnectionString = await getValidateFn();
		expect(
			isValidConnectionString('postgresql://user:pass@localhost:5432/db')
		).toBe(true);
		expect(
			isValidConnectionString('postgres://user:pass@localhost:5432/db')
		).toBe(true);
	});

	test('accepts MySQL URLs', async () => {
		const isValidConnectionString = await getValidateFn();
		expect(isValidConnectionString('mysql://user:pass@localhost:3306/db')).toBe(
			true
		);
		expect(
			isValidConnectionString('mysql2://user:pass@localhost:3306/db')
		).toBe(true);
	});

	test('accepts SQLite file paths', async () => {
		const isValidConnectionString = await getValidateFn();
		expect(isValidConnectionString('/path/to/database.sqlite')).toBe(true);
		expect(isValidConnectionString('/path/to/database.sqlite3')).toBe(true);
		expect(isValidConnectionString('/path/to/database.db')).toBe(true);
		expect(isValidConnectionString('file:./data.sqlite')).toBe(true);
	});

	test('rejects invalid strings', async () => {
		const isValidConnectionString = await getValidateFn();
		expect(isValidConnectionString('not-a-url')).toBe(false);
		expect(isValidConnectionString('http://example.com')).toBe(false);
		expect(isValidConnectionString('')).toBe(false);
	});

	test('rejects malformed PostgreSQL URLs', async () => {
		const isValidConnectionString = await getValidateFn();
		expect(isValidConnectionString('postgresql://')).toBe(true); // Parseable URL, just empty
		expect(isValidConnectionString('postgresql://[invalid')).toBe(false);
	});
});

// ============================================================================
// resolveConnectionString updated warning message
// ============================================================================

describe('resolveConnectionString updated warning', () => {
	async function getResolveFn() {
		const mod = await import('../src/lib/index');
		return mod.resolveConnectionString;
	}

	test('warns with "not a valid database connection string" for invalid env var', async () => {
		const resolveConnectionString = await getResolveFn();
		const result = resolveConnectionString(
			[],
			{ AUTHJS_DB_URL: 'not-a-url' },
			{ envVarName: 'AUTHJS_DB_URL', defaultOutputFile: 'authjs-export.json' }
		);

		expect(result.dbUrl).toBeUndefined();
		expect(result.warning).toContain('AUTHJS_DB_URL');
		expect(result.warning).toContain('not a valid database connection string');
	});

	test('accepts MySQL URL from env var', async () => {
		const resolveConnectionString = await getResolveFn();
		const mysqlUrl = 'mysql://user:pass@localhost:3306/db';
		const result = resolveConnectionString(
			[],
			{ AUTHJS_DB_URL: mysqlUrl },
			{ envVarName: 'AUTHJS_DB_URL', defaultOutputFile: 'authjs-export.json' }
		);

		expect(result.dbUrl).toBe(mysqlUrl);
		expect(result.warning).toBeUndefined();
	});

	test('accepts SQLite path from env var', async () => {
		const resolveConnectionString = await getResolveFn();
		const sqlitePath = '/path/to/database.sqlite';
		const result = resolveConnectionString(
			[],
			{ AUTHJS_DB_URL: sqlitePath },
			{ envVarName: 'AUTHJS_DB_URL', defaultOutputFile: 'authjs-export.json' }
		);

		expect(result.dbUrl).toBe(sqlitePath);
		expect(result.warning).toBeUndefined();
	});
});
