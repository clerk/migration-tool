import { beforeEach, describe, expect, test, vi } from 'vitest';
import { isValidConnectionString, resolveConnectionString } from '../src/lib';

// Mock pg Client
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
	return {
		Client: class MockClient {
			connect = mockConnect;
			query = mockQuery;
			end = mockEnd;
		},
	};
});

// Mock fs.writeFileSync to avoid writing files during tests
vi.mock('fs', async () => {
	const actual = await vi.importActual('fs');
	return {
		...actual,
		default: {
			...(actual as Record<string, unknown>),
			writeFileSync: vi.fn(),
		},
	};
});

// ============================================================================
// isValidConnectionString tests
// ============================================================================

describe('isValidConnectionString', () => {
	test('accepts postgresql:// URLs', () => {
		expect(
			isValidConnectionString(
				'postgresql://postgres:password@db.abc.supabase.co:5432/postgres'
			)
		).toBe(true);
	});

	test('accepts postgres:// URLs', () => {
		expect(
			isValidConnectionString(
				'postgres://postgres.ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
			)
		).toBe(true);
	});

	test('rejects non-postgres URLs', () => {
		expect(isValidConnectionString('mysql://host:3306/db')).toBe(false);
	});

	test('rejects plain strings', () => {
		expect(isValidConnectionString('not-a-url')).toBe(false);
	});

	test('rejects empty strings', () => {
		expect(isValidConnectionString('')).toBe(false);
	});

	test('rejects http URLs', () => {
		expect(isValidConnectionString('https://supabase.co')).toBe(false);
	});

	test('rejects postgres:// URLs that cannot be parsed', () => {
		expect(
			isValidConnectionString('postgresql://host with spaces:5432/db')
		).toBe(false);
	});

	test('accepts postgres:// URLs with URL-encoded special characters', () => {
		expect(
			isValidConnectionString(
				'postgresql://postgres:p%40ss%23word@db.abc.supabase.co:5432/postgres'
			)
		).toBe(true);
	});
});

// ============================================================================
// resolveConnectionString tests
// ============================================================================

describe('resolveConnectionString', () => {
	const validUrl =
		'postgresql://postgres:password@db.abc.supabase.co:5432/postgres';

	test('uses --db-url flag when provided', () => {
		const result = resolveConnectionString(['--db-url', validUrl], {});

		expect(result.dbUrl).toBe(validUrl);
		expect(result.warning).toBeUndefined();
	});

	test('--db-url flag takes priority over env var', () => {
		const envUrl =
			'postgresql://postgres:other@db.xyz.supabase.co:5432/postgres';
		const result = resolveConnectionString(['--db-url', validUrl], {
			SUPABASE_DB_URL: envUrl,
		});

		expect(result.dbUrl).toBe(validUrl);
	});

	test('uses SUPABASE_DB_URL when no flag', () => {
		const result = resolveConnectionString([], {
			SUPABASE_DB_URL: validUrl,
		});

		expect(result.dbUrl).toBe(validUrl);
		expect(result.warning).toBeUndefined();
	});

	test('returns warning and undefined dbUrl when env var is not a valid Postgres URL', () => {
		const result = resolveConnectionString([], {
			SUPABASE_DB_URL: 'not-a-valid-url',
		});

		expect(result.dbUrl).toBeUndefined();
		expect(result.warning).toContain('not a valid Postgres URL');
	});

	test('returns warning for invalid SUPABASE_DB_URL with https scheme', () => {
		const result = resolveConnectionString([], {
			SUPABASE_DB_URL: 'https://supabase.co/project',
		});

		expect(result.dbUrl).toBeUndefined();
		expect(result.warning).toContain('not a valid Postgres URL');
	});

	test('returns undefined dbUrl and no warning when no env vars set', () => {
		const result = resolveConnectionString([], {});

		expect(result.dbUrl).toBeUndefined();
		expect(result.warning).toBeUndefined();
	});

	test('parses --output flag', () => {
		const result = resolveConnectionString(
			['--db-url', validUrl, '--output', 'custom.json'],
			{}
		);

		expect(result.dbUrl).toBe(validUrl);
		expect(result.outputFile).toBe('custom.json');
	});

	test('defaults outputFile to supabase-export.json', () => {
		const result = resolveConnectionString([], {});

		expect(result.outputFile).toBe('supabase-export.json');
	});
});

// ============================================================================
// exportSupabaseUsers tests
// ============================================================================

describe('exportSupabaseUsers', () => {
	const dbUrl =
		'postgresql://postgres:password@db.abc.supabase.co:5432/postgres';

	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Import dynamically so mocks are applied
	async function getExportFn() {
		const mod = await import('../src/export/supabase');
		return mod.exportSupabaseUsers;
	}

	test('shows hostname hint for ENOTFOUND errors', async () => {
		mockConnect.mockRejectedValue(
			new Error('getaddrinfo ENOTFOUND db.abc.supabase.co')
		);
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'hostname could not be resolved'
		);
	});

	test('shows IPv4 hint for ETIMEDOUT errors', async () => {
		mockConnect.mockRejectedValue(new Error('connect ETIMEDOUT 1.2.3.4:5432'));
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'IPv4 add-on'
		);
	});

	test('shows IPv4 hint for ENETUNREACH errors', async () => {
		mockConnect.mockRejectedValue(
			new Error('connect ENETUNREACH 1.2.3.4:5432')
		);
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'IPv4 add-on'
		);
	});

	test('shows password hint for authentication errors', async () => {
		mockConnect.mockRejectedValue(
			new Error('password authentication failed for user "postgres"')
		);
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Check the password'
		);
	});

	test('shows generic hint for unknown connection errors', async () => {
		mockConnect.mockRejectedValue(new Error('some unexpected error'));
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Verify your connection string'
		);
	});

	test('shows auth.users hint when table does not exist', async () => {
		mockConnect.mockResolvedValue(undefined);
		mockQuery.mockRejectedValue(
			new Error('relation "auth.users" does not exist')
		);
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'Auth is enabled in Supabase Dashboard'
		);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('shows auth.users hint when permission is denied', async () => {
		mockConnect.mockResolvedValue(undefined);
		mockQuery.mockRejectedValue(new Error('permission denied for schema auth'));
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'connecting with the postgres role'
		);
		expect(mockEnd).toHaveBeenCalled();
	});

	test('re-throws unrecognized query errors', async () => {
		mockConnect.mockResolvedValue(undefined);
		mockQuery.mockRejectedValue(new Error('syntax error in SQL'));
		const exportSupabaseUsers = await getExportFn();

		await expect(exportSupabaseUsers(dbUrl, 'out.json')).rejects.toThrow(
			'syntax error in SQL'
		);
		expect(mockEnd).toHaveBeenCalled();
	});
});
