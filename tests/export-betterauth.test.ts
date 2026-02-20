import { beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveConnectionString } from '../src/lib';

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
// resolveConnectionString with Better Auth options
// ============================================================================

describe('resolveConnectionString with Better Auth options', () => {
	const validUrl = 'postgresql://user:password@localhost:5432/betterauth_db';

	const options = {
		envVarName: 'BETTER_AUTH_DB_URL',
		defaultOutputFile: 'betterauth-export.json',
	};

	test('uses BETTER_AUTH_DB_URL env var', () => {
		const result = resolveConnectionString(
			[],
			{ BETTER_AUTH_DB_URL: validUrl },
			options
		);

		expect(result.dbUrl).toBe(validUrl);
		expect(result.warning).toBeUndefined();
	});

	test('defaults outputFile to betterauth-export.json', () => {
		const result = resolveConnectionString([], {}, options);

		expect(result.outputFile).toBe('betterauth-export.json');
	});

	test('--db-url flag takes priority over BETTER_AUTH_DB_URL', () => {
		const envUrl = 'postgresql://other:pass@localhost:5432/other_db';
		const result = resolveConnectionString(
			['--db-url', validUrl],
			{ BETTER_AUTH_DB_URL: envUrl },
			options
		);

		expect(result.dbUrl).toBe(validUrl);
	});

	test('returns warning when BETTER_AUTH_DB_URL is invalid', () => {
		const result = resolveConnectionString(
			[],
			{ BETTER_AUTH_DB_URL: 'not-a-url' },
			options
		);

		expect(result.dbUrl).toBeUndefined();
		expect(result.warning).toContain('BETTER_AUTH_DB_URL');
		expect(result.warning).toContain('not a valid database connection string');
	});

	test('does not use SUPABASE_DB_URL', () => {
		const result = resolveConnectionString(
			[],
			{ SUPABASE_DB_URL: validUrl },
			options
		);

		expect(result.dbUrl).toBeUndefined();
	});

	test('accepts MySQL URL from BETTER_AUTH_DB_URL', () => {
		const mysqlUrl = 'mysql://user:pass@localhost:3306/betterauth';
		const result = resolveConnectionString(
			[],
			{ BETTER_AUTH_DB_URL: mysqlUrl },
			options
		);

		expect(result.dbUrl).toBe(mysqlUrl);
		expect(result.warning).toBeUndefined();
	});

	test('accepts SQLite path from BETTER_AUTH_DB_URL', () => {
		const sqlitePath = '/path/to/betterauth.sqlite';
		const result = resolveConnectionString(
			[],
			{ BETTER_AUTH_DB_URL: sqlitePath },
			options
		);

		expect(result.dbUrl).toBe(sqlitePath);
		expect(result.warning).toBeUndefined();
	});
});

// ============================================================================
// buildExportQuery tests
// ============================================================================

describe('buildExportQuery', () => {
	async function getBuildFn() {
		const mod = await import('../src/export/betterauth');
		return mod.buildExportQuery;
	}

	test('includes only core columns when no plugins detected', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set());

		expect(query).toContain('"id"');
		expect(query).toContain('"email"');
		expect(query).toContain('"emailVerified"');
		expect(query).toContain('"name"');
		expect(query).toContain('"createdAt"');
		expect(query).toContain('"password"');
		expect(query).not.toContain('"username"');
		expect(query).not.toContain('"phoneNumber"');
		expect(query).not.toContain('"role"');
		expect(query).not.toContain('"twoFactorEnabled"');
	});

	test('includes username plugin columns when detected', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(
			new Set(['username', 'displayUsername'] as const)
		);

		expect(query).toContain('"username"');
		expect(query).toContain('"displayUsername"');
	});

	test('includes phone plugin columns when detected', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(
			new Set(['phoneNumber', 'phoneNumberVerified'] as const)
		);

		expect(query).toContain('"phoneNumber"');
		expect(query).toContain('"phoneNumberVerified"');
	});

	test('includes admin plugin columns when detected', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(
			new Set(['role', 'banned', 'banReason', 'banExpires'] as const)
		);

		expect(query).toContain('"role"');
		expect(query).toContain('"banned"');
		expect(query).toContain('"banReason"');
		expect(query).toContain('"banExpires"');
	});

	test('includes two-factor plugin column when detected', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set(['twoFactorEnabled'] as const));

		expect(query).toContain('"twoFactorEnabled"');
	});

	test('joins account table on credential provider', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set());

		expect(query).toContain('account');
		expect(query).toContain("'credential'");
	});

	test('orders by createdAt', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set());

		expect(query).toContain('"createdAt"');
		expect(query).toContain('ASC');
	});

	test('uses backticks for MySQL', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set(), 'mysql');

		expect(query).toContain('`id`');
		expect(query).toContain('`email`');
		expect(query).toContain('`user`');
		expect(query).toContain('`account`');
		expect(query).not.toContain('"id"');
	});

	test('uses double quotes for PostgreSQL (default)', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set());

		expect(query).toContain('"id"');
		expect(query).toContain('"email"');
		expect(query).not.toContain('`id`');
	});

	test('uses double quotes for SQLite', async () => {
		const buildExportQuery = await getBuildFn();
		const query = buildExportQuery(new Set(), 'sqlite');

		expect(query).toContain('"id"');
		expect(query).toContain('"email"');
		expect(query).not.toContain('`id`');
	});
});

// ============================================================================
// getDetectedPluginNames tests
// ============================================================================

describe('getDetectedPluginNames', () => {
	async function getDetectFn() {
		const mod = await import('../src/export/betterauth');
		return mod.getDetectedPluginNames;
	}

	test('returns empty array when no plugin columns', async () => {
		const getDetectedPluginNames = await getDetectFn();
		expect(getDetectedPluginNames(new Set())).toEqual([]);
	});

	test('detects username plugin', async () => {
		const getDetectedPluginNames = await getDetectFn();
		const result = getDetectedPluginNames(new Set(['username'] as const));
		expect(result).toContain('username');
	});

	test('detects phone number plugin', async () => {
		const getDetectedPluginNames = await getDetectFn();
		const result = getDetectedPluginNames(new Set(['phoneNumber'] as const));
		expect(result).toContain('phone number');
	});

	test('detects admin plugin from any admin column', async () => {
		const getDetectedPluginNames = await getDetectFn();
		expect(getDetectedPluginNames(new Set(['banned'] as const))).toContain(
			'admin'
		);
		expect(getDetectedPluginNames(new Set(['role'] as const))).toContain(
			'admin'
		);
	});

	test('detects two-factor plugin', async () => {
		const getDetectedPluginNames = await getDetectFn();
		const result = getDetectedPluginNames(
			new Set(['twoFactorEnabled'] as const)
		);
		expect(result).toContain('two-factor');
	});

	test('detects multiple plugins', async () => {
		const getDetectedPluginNames = await getDetectFn();
		const result = getDetectedPluginNames(
			new Set([
				'username',
				'phoneNumber',
				'banned',
				'twoFactorEnabled',
			] as const)
		);
		expect(result).toEqual(['username', 'phone number', 'admin', 'two-factor']);
	});
});

// ============================================================================
// exportBetterAuthUsers tests
// ============================================================================

describe('exportBetterAuthUsers', () => {
	const dbUrl = 'postgresql://user:password@localhost:5432/betterauth_db';

	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function getExportFn() {
		const mod = await import('../src/export/betterauth');
		return mod.exportBetterAuthUsers;
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

	test('shows hostname hint for ENOTFOUND errors', async () => {
		mockCreateDbClient.mockRejectedValue(
			new Error('getaddrinfo ENOTFOUND localhost')
		);
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'hostname could not be resolved'
		);
	});

	test('shows unreachable hint for ETIMEDOUT errors', async () => {
		mockCreateDbClient.mockRejectedValue(
			new Error('connect ETIMEDOUT 127.0.0.1:5432')
		);
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'database server is unreachable'
		);
	});

	test('shows password hint for authentication errors', async () => {
		mockCreateDbClient.mockRejectedValue(
			new Error('password authentication failed for user "user"')
		);
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Check the password'
		);
	});

	test('shows generic hint for unknown connection errors', async () => {
		mockCreateDbClient.mockRejectedValue(new Error('some unexpected error'));
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Verify your connection string'
		);
	});

	test('shows table hint when user table does not exist', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		// First query is detectPluginColumns
		mockQuery.mockRejectedValue(new Error('relation "user" does not exist'));
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Better Auth has been set up'
		);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('shows permission hint when access is denied', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		mockQuery.mockRejectedValue(
			new Error('permission denied for table "user"')
		);
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Better Auth has been set up'
		);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('exports users with correct field coverage', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		// First query: detectPluginColumns
		mockQuery.mockResolvedValueOnce({
			rows: [{ column_name: 'username' }, { column_name: 'phoneNumber' }],
		});
		// Second query: actual export
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					user_id: 'user_1',
					email: 'test@example.com',
					email_verified: true,
					name: 'Test User',
					password_hash: '$2a$10$hash...',
					username: 'testuser',
					phone_number: null,
				},
				{
					user_id: 'user_2',
					email: 'other@example.com',
					email_verified: false,
					name: null,
					password_hash: null,
					username: null,
					phone_number: '+1234567890',
				},
			],
		});
		const exportBetterAuthUsers = await getExportFn();

		const result = await exportBetterAuthUsers(dbUrl, 'test-output.json');

		expect(result.userCount).toBe(2);
		expect(result.detectedPlugins).toContain('username');
		expect(result.detectedPlugins).toContain('phone number');
		expect(result.fieldCoverage.email).toBe(2);
		expect(result.fieldCoverage.emailVerified).toBe(1);
		expect(result.fieldCoverage.name).toBe(1);
		expect(result.fieldCoverage.password).toBe(1);
		expect(result.fieldCoverage.username).toBe(1);
		expect(result.fieldCoverage.phone).toBe(1);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('writes JSON output to exports directory', async () => {
		const { mockQuery } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({ rows: [] }); // detectPluginColumns
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					user_id: 'user_1',
					email: 'test@example.com',
					email_verified: true,
					name: 'Test',
					password_hash: null,
				},
			],
		});
		const exportBetterAuthUsers = await getExportFn();

		await exportBetterAuthUsers(dbUrl, 'test-output.json');

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
		expect(parsed[0].user_id).toBe('user_1');
	});

	test('logs each user via exportLogger', async () => {
		const { mockQuery } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({ rows: [] }); // detectPluginColumns
		mockQuery.mockResolvedValueOnce({
			rows: [
				{
					user_id: 'user_1',
					email: 'a@example.com',
					email_verified: true,
					name: 'A',
					password_hash: null,
				},
				{
					user_id: 'user_2',
					email: 'b@example.com',
					email_verified: false,
					name: 'B',
					password_hash: null,
				},
			],
		});
		const exportBetterAuthUsers = await getExportFn();

		await exportBetterAuthUsers(dbUrl, 'test-output.json');

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

	test('builds query with detected plugin columns', async () => {
		const { mockQuery } = makeMockClient('postgres');
		// Detect all plugin columns
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ column_name: 'username' },
				{ column_name: 'displayUsername' },
				{ column_name: 'banned' },
				{ column_name: 'role' },
				{ column_name: 'twoFactorEnabled' },
			],
		});
		mockQuery.mockResolvedValueOnce({ rows: [] });
		const exportBetterAuthUsers = await getExportFn();

		const result = await exportBetterAuthUsers(dbUrl, 'test-output.json');

		expect(result.detectedPlugins).toContain('username');
		expect(result.detectedPlugins).toContain('admin');
		expect(result.detectedPlugins).toContain('two-factor');

		// Verify the second query (export) was called with a query containing plugin columns
		const exportQuery = mockQuery.mock.calls[1][0] as string;
		expect(exportQuery).toContain('"username"');
		expect(exportQuery).toContain('"displayUsername"');
		expect(exportQuery).toContain('"banned"');
		expect(exportQuery).toContain('"role"');
		expect(exportQuery).toContain('"twoFactorEnabled"');
	});

	test('re-throws unrecognized query errors', async () => {
		const { mockQuery, mockEnd } = makeMockClient('postgres');
		mockQuery.mockResolvedValueOnce({ rows: [] }); // detectPluginColumns
		mockQuery.mockRejectedValueOnce(new Error('syntax error in SQL'));
		const exportBetterAuthUsers = await getExportFn();

		await expect(exportBetterAuthUsers(dbUrl, 'out.json')).rejects.toThrow(
			'syntax error in SQL'
		);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('uses MySQL quoting when client is MySQL', async () => {
		const { mockQuery, mockEnd } = makeMockClient('mysql');
		mockQuery.mockResolvedValueOnce({ rows: [] }); // detectPluginColumns
		mockQuery.mockResolvedValueOnce({ rows: [] }); // export query
		const exportBetterAuthUsers = await getExportFn();

		await exportBetterAuthUsers(
			'mysql://user:pass@localhost:3306/db',
			'test-output.json'
		);

		// Verify the export query uses backticks
		const exportQuery = mockQuery.mock.calls[1][0] as string;
		expect(exportQuery).toContain('`id`');
		expect(exportQuery).toContain('`user`');
		expect(exportQuery).toContain('`account`');
		expect(mockEnd).toHaveBeenCalled();
	});

	test('uses SQLite PRAGMA for plugin detection', async () => {
		const { mockQuery, mockEnd } = makeMockClient('sqlite');
		// PRAGMA table_info returns column names
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ name: 'id' },
				{ name: 'email' },
				{ name: 'emailVerified' },
				{ name: 'name' },
				{ name: 'createdAt' },
				{ name: 'updatedAt' },
				{ name: 'username' },
			],
		});
		mockQuery.mockResolvedValueOnce({ rows: [] }); // export query
		const exportBetterAuthUsers = await getExportFn();

		const result = await exportBetterAuthUsers(
			'/path/to/db.sqlite',
			'test-output.json'
		);

		expect(result.detectedPlugins).toContain('username');
		// Verify the first query was PRAGMA
		const detectQuery = mockQuery.mock.calls[0][0] as string;
		expect(detectQuery).toContain('PRAGMA table_info');
		expect(mockEnd).toHaveBeenCalled();
	});
});
