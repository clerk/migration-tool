import { beforeEach, describe, expect, test, vi } from 'vitest';

// Use vi.hoisted so variables are available when vi.mock factories run
const {
	mockListUsers,
	mockInitializeApp,
	mockDeleteApp,
	mockReadFileSync,
	mockExistsSync,
	mockWriteFileSync,
	mockMkdirSync,
	mockExportLogger,
} = vi.hoisted(() => ({
	mockListUsers: vi.fn(),
	mockInitializeApp: vi.fn(),
	mockDeleteApp: vi.fn(),
	mockReadFileSync: vi.fn(),
	mockExistsSync: vi.fn(),
	mockWriteFileSync: vi.fn(),
	mockMkdirSync: vi.fn(),
	mockExportLogger: vi.fn(),
}));

// Mock firebase-admin
vi.mock('firebase-admin', () => {
	const mockApp = { delete: mockDeleteApp };
	mockInitializeApp.mockReturnValue(mockApp);

	return {
		initializeApp: mockInitializeApp,
		credential: {
			cert: vi.fn((sa) => sa),
		},
		auth: () => ({
			listUsers: mockListUsers,
		}),
		app: () => mockApp,
	};
});

// Mock fs
vi.mock('fs', async () => {
	const actual = await vi.importActual('fs');
	return {
		...actual,
		default: {
			...(actual as Record<string, unknown>),
			readFileSync: mockReadFileSync,
			existsSync: mockExistsSync,
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
// mapFirebaseUserToExport tests
// ============================================================================

describe('mapFirebaseUserToExport', () => {
	async function getMapFn() {
		const mod = await import('../src/export/firebase');
		return mod.mapFirebaseUserToExport;
	}

	function makeUserRecord(overrides: Record<string, unknown> = {}) {
		return {
			uid: 'firebase_uid_123',
			email: 'test@example.com',
			emailVerified: true,
			passwordHash: 'base64hash',
			passwordSalt: 'base64salt',
			displayName: 'Test User',
			phoneNumber: '+1234567890',
			disabled: false,
			metadata: {
				creationTime: '2025-01-01T00:00:00.000Z',
				lastSignInTime: '2025-06-01T00:00:00.000Z',
			},
			...overrides,
		};
	}

	test('maps core fields correctly', async () => {
		const mapFirebaseUserToExport = await getMapFn();
		const result = mapFirebaseUserToExport(makeUserRecord() as never);

		expect(result.localId).toBe('firebase_uid_123');
		expect(result.email).toBe('test@example.com');
		expect(result.emailVerified).toBe(true);
		expect(result.passwordHash).toBe('base64hash');
		expect(result.passwordSalt).toBe('base64salt');
		expect(result.displayName).toBe('Test User');
		expect(result.phoneNumber).toBe('+1234567890');
	});

	test('converts metadata timestamps to milliseconds', async () => {
		const mapFirebaseUserToExport = await getMapFn();
		const result = mapFirebaseUserToExport(makeUserRecord() as never);

		expect(result.createdAt).toBe(
			new Date('2025-01-01T00:00:00.000Z').getTime()
		);
		expect(result.lastSignedInAt).toBe(
			new Date('2025-06-01T00:00:00.000Z').getTime()
		);
	});

	test('omits null/undefined fields', async () => {
		const mapFirebaseUserToExport = await getMapFn();
		const result = mapFirebaseUserToExport(
			makeUserRecord({
				email: undefined,
				passwordHash: undefined,
				passwordSalt: undefined,
				displayName: undefined,
				phoneNumber: undefined,
				disabled: false,
			}) as never
		);

		expect(result.localId).toBe('firebase_uid_123');
		expect(result.email).toBeUndefined();
		expect(result.passwordHash).toBeUndefined();
		expect(result.passwordSalt).toBeUndefined();
		expect(result.displayName).toBeUndefined();
		expect(result.phoneNumber).toBeUndefined();
		expect(result.disabled).toBeUndefined(); // false → omitted
	});
});

// ============================================================================
// exportFirebaseUsers tests
// ============================================================================

describe('exportFirebaseUsers', () => {
	const serviceAccountPath = '/path/to/service-account.json';
	const serviceAccountJson = JSON.stringify({
		project_id: 'test-project',
		client_email: 'test@test.iam.gserviceaccount.com',
		private_key: 'test-key',
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockReadFileSync.mockReturnValue(serviceAccountJson);
		mockDeleteApp.mockResolvedValue(undefined);
	});

	async function getExportFn() {
		const mod = await import('../src/export/firebase');
		return mod.exportFirebaseUsers;
	}

	function makeUserRecord(overrides: Record<string, unknown> = {}) {
		return {
			uid: 'firebase_uid_123',
			email: 'test@example.com',
			emailVerified: true,
			passwordHash: 'hash123',
			passwordSalt: 'salt123',
			displayName: 'Test User',
			phoneNumber: '+1234567890',
			disabled: false,
			metadata: {
				creationTime: '2025-01-01T00:00:00.000Z',
				lastSignInTime: '2025-06-01T00:00:00.000Z',
			},
			...overrides,
		};
	}

	test('paginates with pageToken', async () => {
		const exportFirebaseUsers = await getExportFn();

		mockListUsers
			.mockResolvedValueOnce({
				users: [makeUserRecord({ uid: 'user_1' })],
				pageToken: 'next-page-token',
			})
			.mockResolvedValueOnce({
				users: [makeUserRecord({ uid: 'user_2' })],
				pageToken: undefined,
			});

		const result = await exportFirebaseUsers(
			serviceAccountPath,
			'test-output.json'
		);

		expect(mockListUsers).toHaveBeenCalledTimes(2);
		expect(mockListUsers).toHaveBeenCalledWith(1000, undefined);
		expect(mockListUsers).toHaveBeenCalledWith(1000, 'next-page-token');
		expect(result.userCount).toBe(2);
	});

	test('returns accurate field coverage counts', async () => {
		const exportFirebaseUsers = await getExportFn();

		mockListUsers.mockResolvedValueOnce({
			users: [
				makeUserRecord({
					uid: 'user_1',
					email: 'a@test.com',
					emailVerified: true,
					passwordHash: 'hash',
					displayName: 'User One',
					phoneNumber: '+1234567890',
				}),
				makeUserRecord({
					uid: 'user_2',
					email: 'b@test.com',
					emailVerified: false,
					passwordHash: undefined,
					displayName: undefined,
					phoneNumber: undefined,
				}),
			],
			pageToken: undefined,
		});

		const result = await exportFirebaseUsers(
			serviceAccountPath,
			'test-output.json'
		);

		expect(result.fieldCoverage.email).toBe(2);
		expect(result.fieldCoverage.emailVerified).toBe(1);
		expect(result.fieldCoverage.passwordHash).toBe(1);
		expect(result.fieldCoverage.phone).toBe(1);
		expect(result.fieldCoverage.displayName).toBe(1);
	});

	test('writes JSON output to exports directory', async () => {
		const exportFirebaseUsers = await getExportFn();

		mockListUsers.mockResolvedValueOnce({
			users: [makeUserRecord()],
			pageToken: undefined,
		});

		await exportFirebaseUsers(serviceAccountPath, 'test-output.json');

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
		expect(parsed[0].localId).toBe('firebase_uid_123');
	});

	test('logs each user via exportLogger', async () => {
		const exportFirebaseUsers = await getExportFn();

		mockListUsers.mockResolvedValueOnce({
			users: [
				makeUserRecord({ uid: 'user_1' }),
				makeUserRecord({ uid: 'user_2' }),
			],
			pageToken: undefined,
		});

		await exportFirebaseUsers(serviceAccountPath, 'test-output.json');

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

	test('cleans up Firebase app in finally block', async () => {
		const exportFirebaseUsers = await getExportFn();

		mockListUsers.mockResolvedValueOnce({
			users: [makeUserRecord()],
			pageToken: undefined,
		});

		await exportFirebaseUsers(serviceAccountPath, 'test-output.json');

		expect(mockDeleteApp).toHaveBeenCalled();
	});

	test('cleans up Firebase app even on error', async () => {
		const exportFirebaseUsers = await getExportFn();

		mockListUsers.mockRejectedValue(new Error('Auth error'));

		await expect(
			exportFirebaseUsers(serviceAccountPath, 'test-output.json')
		).rejects.toThrow('Auth error');

		expect(mockDeleteApp).toHaveBeenCalled();
	});
});
