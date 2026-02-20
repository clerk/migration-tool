import { beforeEach, describe, expect, test, vi } from 'vitest';

// Use vi.hoisted so variables are available when vi.mock factories run
const { mockGetAll, mockWriteFileSync, mockMkdirSync, mockExportLogger } =
	vi.hoisted(() => ({
		mockGetAll: vi.fn(),
		mockWriteFileSync: vi.fn(),
		mockMkdirSync: vi.fn(),
		mockExportLogger: vi.fn(),
	}));

// Mock auth0 ManagementClient
vi.mock('auth0', () => ({
	ManagementClient: class MockManagementClient {
		users = {
			getAll: mockGetAll,
		};
	},
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
// mapAuth0UserToExport tests
// ============================================================================

describe('mapAuth0UserToExport', () => {
	async function getMapFn() {
		const mod = await import('../src/export/auth0');
		return mod.mapAuth0UserToExport;
	}

	test('maps core fields correctly', async () => {
		const mapAuth0UserToExport = await getMapFn();
		const result = mapAuth0UserToExport({
			user_id: 'auth0|abc123',
			email: 'test@example.com',
			email_verified: true,
			given_name: 'John',
			family_name: 'Doe',
			created_at: '2025-01-01T00:00:00.000Z',
		});

		expect(result.user_id).toBe('auth0|abc123');
		expect(result.email).toBe('test@example.com');
		expect(result.email_verified).toBe(true);
		expect(result.given_name).toBe('John');
		expect(result.family_name).toBe('Doe');
		expect(result.created_at).toBe('2025-01-01T00:00:00.000Z');
	});

	test('includes optional fields when present', async () => {
		const mapAuth0UserToExport = await getMapFn();
		const result = mapAuth0UserToExport({
			user_id: 'auth0|abc123',
			email: 'test@example.com',
			username: 'testuser',
			phone_number: '+1234567890',
			phone_verified: true,
			user_metadata: { theme: 'dark' },
			app_metadata: { role: 'admin' },
		});

		expect(result.username).toBe('testuser');
		expect(result.phone_number).toBe('+1234567890');
		expect(result.phone_verified).toBe(true);
		expect(result.user_metadata).toEqual({ theme: 'dark' });
		expect(result.app_metadata).toEqual({ role: 'admin' });
	});

	test('omits null/empty fields', async () => {
		const mapAuth0UserToExport = await getMapFn();
		const result = mapAuth0UserToExport({
			user_id: 'auth0|abc123',
			email: null,
			username: null,
			phone_number: null,
			user_metadata: {},
			app_metadata: {},
		});

		expect(result.email).toBeUndefined();
		expect(result.username).toBeUndefined();
		expect(result.phone_number).toBeUndefined();
		expect(result.user_metadata).toBeUndefined();
		expect(result.app_metadata).toBeUndefined();
	});
});

// ============================================================================
// exportAuth0Users tests
// ============================================================================

describe('exportAuth0Users', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function getExportFn() {
		const mod = await import('../src/export/auth0');
		return mod.exportAuth0Users;
	}

	function makeAuth0User(overrides: Record<string, unknown> = {}) {
		return {
			user_id: 'auth0|test123',
			email: 'test@example.com',
			email_verified: true,
			username: null,
			given_name: 'Test',
			family_name: 'User',
			phone_number: null,
			phone_verified: false,
			user_metadata: {},
			app_metadata: {},
			created_at: '2025-01-01T00:00:00.000Z',
			...overrides,
		};
	}

	test('paginates when results fill a page', async () => {
		const exportAuth0Users = await getExportFn();

		// First call returns 100 users (full page), second returns less
		const page1 = Array.from({ length: 100 }, (_, i) =>
			makeAuth0User({ user_id: `auth0|user_${i}` })
		);
		const page2 = [makeAuth0User({ user_id: 'auth0|user_100' })];

		mockGetAll
			.mockResolvedValueOnce({ data: { users: page1 } })
			.mockResolvedValueOnce({ data: { users: page2 } });

		const result = await exportAuth0Users(
			'test.auth0.com',
			'client-id',
			'client-secret',
			'test-output.json'
		);

		expect(mockGetAll).toHaveBeenCalledTimes(2);
		expect(mockGetAll).toHaveBeenCalledWith({
			page: 0,
			per_page: 100,
			include_totals: true,
		});
		expect(mockGetAll).toHaveBeenCalledWith({
			page: 1,
			per_page: 100,
			include_totals: true,
		});
		expect(result.userCount).toBe(101);
	});

	test('does not paginate when results are less than page size', async () => {
		const exportAuth0Users = await getExportFn();

		const users = [
			makeAuth0User({ user_id: 'auth0|user_1' }),
			makeAuth0User({ user_id: 'auth0|user_2' }),
		];

		mockGetAll.mockResolvedValueOnce({ data: { users } });

		const result = await exportAuth0Users(
			'test.auth0.com',
			'client-id',
			'client-secret',
			'test-output.json'
		);

		expect(mockGetAll).toHaveBeenCalledTimes(1);
		expect(result.userCount).toBe(2);
	});

	test('returns accurate field coverage counts', async () => {
		const exportAuth0Users = await getExportFn();

		const users = [
			makeAuth0User({
				user_id: 'auth0|user_1',
				email: 'a@test.com',
				username: 'user1',
				given_name: 'Test',
				family_name: 'User',
				phone_number: '+1234567890',
			}),
			makeAuth0User({
				user_id: 'auth0|user_2',
				email: 'b@test.com',
				username: null,
				given_name: null,
				family_name: null,
				phone_number: null,
			}),
		];

		mockGetAll.mockResolvedValueOnce({ data: { users } });

		const result = await exportAuth0Users(
			'test.auth0.com',
			'client-id',
			'client-secret',
			'test-output.json'
		);

		expect(result.fieldCoverage.email).toBe(2);
		expect(result.fieldCoverage.username).toBe(1);
		expect(result.fieldCoverage.firstName).toBe(1);
		expect(result.fieldCoverage.lastName).toBe(1);
		expect(result.fieldCoverage.phone).toBe(1);
		expect(result.fieldCoverage.password).toBe(0); // Never available from API
	});

	test('writes JSON output to exports directory', async () => {
		const exportAuth0Users = await getExportFn();

		mockGetAll.mockResolvedValueOnce({
			data: { users: [makeAuth0User()] },
		});

		await exportAuth0Users(
			'test.auth0.com',
			'client-id',
			'client-secret',
			'test-output.json'
		);

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
		expect(parsed[0].user_id).toBe('auth0|test123');
	});

	test('logs each user via exportLogger', async () => {
		const exportAuth0Users = await getExportFn();

		const users = [
			makeAuth0User({ user_id: 'auth0|user_1' }),
			makeAuth0User({ user_id: 'auth0|user_2' }),
		];

		mockGetAll.mockResolvedValueOnce({ data: { users } });

		await exportAuth0Users(
			'test.auth0.com',
			'client-id',
			'client-secret',
			'test-output.json'
		);

		expect(mockExportLogger).toHaveBeenCalledTimes(2);
		expect(mockExportLogger).toHaveBeenCalledWith(
			{ userId: 'auth0|user_1', status: 'success' },
			expect.any(String)
		);
		expect(mockExportLogger).toHaveBeenCalledWith(
			{ userId: 'auth0|user_2', status: 'success' },
			expect.any(String)
		);
	});

	test('handles API errors', async () => {
		const exportAuth0Users = await getExportFn();

		mockGetAll.mockRejectedValue(new Error('Unauthorized'));

		await expect(
			exportAuth0Users(
				'test.auth0.com',
				'client-id',
				'client-secret',
				'test-output.json'
			)
		).rejects.toThrow('Unauthorized');
	});
});
