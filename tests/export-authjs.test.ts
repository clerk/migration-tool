import { beforeEach, describe, expect, test, vi } from 'vitest';

// Use vi.hoisted so variables are available when vi.mock factories run
const {
	mockCreateDbClient,
	mockWriteFileSync,
	mockMkdirSync,
	mockExportLogger,
} = vi.hoisted(() => ({
	mockCreateDbClient: vi.fn(),
	mockWriteFileSync: vi.fn(),
	mockMkdirSync: vi.fn(),
	mockExportLogger: vi.fn(),
}));

// Mock the db module
vi.mock('../src/lib/db', () => ({
	createDbClient: mockCreateDbClient,
}));

// Mock fs to avoid writing files during tests
vi.mock('fs', async () => {
	const actual = await vi.importActual('fs');
	return {
		...actual,
		default: {
			...(actual as Record<string, unknown>),
			writeFileSync: mockWriteFileSync,
			mkdirSync: mockMkdirSync,
			appendFileSync: vi.fn(),
		},
	};
});

// Mock logger
vi.mock('../src/logger', () => ({
	exportLogger: mockExportLogger,
	closeAllStreams: vi.fn(),
}));

// ============================================================================
// exportAuthJSUsers tests
// ============================================================================

describe('exportAuthJSUsers', () => {
	const dbUrl = 'postgresql://user:password@localhost:5432/authjs_db';

	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function getExportFn() {
		const mod = await import('../src/export/authjs');
		return mod.exportAuthJSUsers;
	}

	function makeMockClient(
		dbType: 'postgres' | 'mysql' | 'sqlite' = 'postgres'
	) {
		const mockQuery = vi.fn();
		const mockEnd = vi.fn();
		const client = {
			dbType,
			query: mockQuery,
			end: mockEnd,
		};
		mockCreateDbClient.mockResolvedValue(client);
		return { client, mockQuery, mockEnd };
	}

	test('exports users with correct field coverage (PostgreSQL)', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: 'user_1',
					name: 'Test User',
					email: 'test@example.com',
					email_verified: '2025-01-01T00:00:00.000Z',
				},
				{
					id: 'user_2',
					name: null,
					email: 'other@example.com',
					email_verified: null,
				},
			],
		});

		const exportAuthJSUsers = await getExportFn();
		const result = await exportAuthJSUsers(dbUrl, 'test-output.json');

		expect(result.userCount).toBe(2);
		expect(result.fieldCoverage.email).toBe(2);
		expect(result.fieldCoverage.emailVerified).toBe(1);
		expect(result.fieldCoverage.name).toBe(1);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('uses correct quoting for PostgreSQL', async () => {
		const { mockQuery } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const exportAuthJSUsers = await getExportFn();
		await exportAuthJSUsers(dbUrl, 'test-output.json');

		const query = mockQuery.mock.calls[0][0] as string;
		expect(query).toContain('"User"');
		expect(query).toContain('"emailVerified"');
	});

	test('uses correct quoting for MySQL', async () => {
		const { mockQuery } = makeMockClient('mysql');
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const exportAuthJSUsers = await getExportFn();
		await exportAuthJSUsers(
			'mysql://user:pass@localhost/db',
			'test-output.json'
		);

		const query = mockQuery.mock.calls[0][0] as string;
		expect(query).toContain('`User`');
		expect(query).toContain('`emailVerified`');
	});

	test('uses correct quoting for SQLite', async () => {
		const { mockQuery } = makeMockClient('sqlite');
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const exportAuthJSUsers = await getExportFn();
		await exportAuthJSUsers('/path/to/db.sqlite', 'test-output.json');

		const query = mockQuery.mock.calls[0][0] as string;
		expect(query).toContain('"User"');
		expect(query).toContain('"emailVerified"');
	});

	test('retries with lowercase table names on table not found', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		// First query fails with "does not exist"
		mockQuery.mockRejectedValueOnce(
			new Error('relation "User" does not exist')
		);
		// Retry with lowercase succeeds
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: 'user_1',
					name: 'Test',
					email: 'test@example.com',
					email_verified: null,
				},
			],
		});

		const exportAuthJSUsers = await getExportFn();
		const result = await exportAuthJSUsers(dbUrl, 'test-output.json');

		expect(result.userCount).toBe(1);
		expect(mockQuery).toHaveBeenCalledTimes(2);
		// Second query should use lowercase
		const secondQuery = mockQuery.mock.calls[1][0] as string;
		expect(secondQuery).toContain('"user"');
		expect(mockEnd).toHaveBeenCalled();
	});

	test('throws helpful error when both PascalCase and lowercase fail', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		mockQuery.mockRejectedValueOnce(
			new Error('relation "User" does not exist')
		);
		mockQuery.mockRejectedValueOnce(
			new Error('relation "user" does not exist')
		);

		const exportAuthJSUsers = await getExportFn();
		await expect(exportAuthJSUsers(dbUrl, 'test-output.json')).rejects.toThrow(
			'Could not find AuthJS tables'
		);

		expect(mockEnd).toHaveBeenCalled();
	});

	test('shows connection error hints for authjs platform', async () => {
		mockCreateDbClient.mockRejectedValue(
			new Error('getaddrinfo ENOTFOUND localhost')
		);

		const exportAuthJSUsers = await getExportFn();
		await expect(exportAuthJSUsers(dbUrl, 'test-output.json')).rejects.toThrow(
			'hostname could not be resolved'
		);
	});

	test('writes JSON output to exports directory', async () => {
		const { mockQuery } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: 'user_1',
					name: 'Test',
					email: 'test@example.com',
					email_verified: null,
				},
			],
		});

		const exportAuthJSUsers = await getExportFn();
		await exportAuthJSUsers(dbUrl, 'test-output.json');

		expect(mockMkdirSync).toHaveBeenCalledWith(
			expect.stringContaining('exports'),
			{ recursive: true }
		);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('test-output.json'),
			expect.any(String)
		);

		const writtenJson = mockWriteFileSync.mock.calls[0][1] as string;
		const parsed = JSON.parse(writtenJson);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].id).toBe('user_1');
	});

	test('logs each user via exportLogger', async () => {
		const { mockQuery } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					id: 'user_1',
					name: 'A',
					email: 'a@example.com',
					email_verified: null,
				},
				{
					id: 'user_2',
					name: 'B',
					email: 'b@example.com',
					email_verified: '2025-01-01',
				},
			],
		});

		const exportAuthJSUsers = await getExportFn();
		await exportAuthJSUsers(dbUrl, 'test-output.json');

		expect(mockExportLogger).toHaveBeenCalledTimes(2);
		expect(mockExportLogger).toHaveBeenCalledWith(
			{ userId: 'user_1', status: 'success' },
			expect.any(String)
		);
		expect(mockExportLogger).toHaveBeenCalledWith(
			{ userId: 'user_2', status: 'success' },
			expect.any(String)
		);
	});
});

// ============================================================================
// resolveConnectionString with AuthJS options
// ============================================================================

describe('resolveConnectionString with AuthJS options', () => {
	async function getResolveFn() {
		const mod = await import('../src/lib/index');
		return mod.resolveConnectionString;
	}

	const options = {
		envVarName: 'AUTHJS_DB_URL',
		defaultOutputFile: 'authjs-export.json',
	};

	test('uses AUTHJS_DB_URL env var', async () => {
		const resolveConnectionString = await getResolveFn();
		const validUrl = 'postgresql://user:password@localhost:5432/authjs_db';
		const result = resolveConnectionString(
			[],
			{ AUTHJS_DB_URL: validUrl },
			options
		);

		expect(result.dbUrl).toBe(validUrl);
		expect(result.warning).toBeUndefined();
	});

	test('defaults outputFile to authjs-export.json', async () => {
		const resolveConnectionString = await getResolveFn();
		const result = resolveConnectionString([], {}, options);

		expect(result.outputFile).toBe('authjs-export.json');
	});

	test('accepts MySQL URL from AUTHJS_DB_URL', async () => {
		const resolveConnectionString = await getResolveFn();
		const mysqlUrl = 'mysql://user:pass@localhost:3306/authjs';
		const result = resolveConnectionString(
			[],
			{ AUTHJS_DB_URL: mysqlUrl },
			options
		);

		expect(result.dbUrl).toBe(mysqlUrl);
	});

	test('accepts SQLite path from AUTHJS_DB_URL', async () => {
		const resolveConnectionString = await getResolveFn();
		const sqlitePath = '/path/to/authjs.sqlite';
		const result = resolveConnectionString(
			[],
			{ AUTHJS_DB_URL: sqlitePath },
			options
		);

		expect(result.dbUrl).toBe(sqlitePath);
	});
});
