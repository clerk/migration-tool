import { beforeEach, describe, expect, test, vi } from 'vitest';

// Create mock functions at module level
const mockGetUserList = vi.fn();
const mockDeleteUser = vi.fn();

// Mock @clerk/backend before importing the module
vi.mock('@clerk/backend', () => ({
	createClerkClient: () => ({
		users: {
			getUserList: mockGetUserList,
			deleteUser: mockDeleteUser,
		},
	}),
}));

// Mock @clack/prompts to prevent console output during tests
vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
	log: {
		error: vi.fn(),
		info: vi.fn(),
	},
}));

// Mock picocolors
vi.mock('picocolors', () => ({
	default: {
		bgCyan: vi.fn((s) => s),
		black: vi.fn((s) => s),
		red: vi.fn((s) => s),
		yellow: vi.fn((s) => s),
	},
}));

// Mock getDateTimeStamp
vi.mock('../utils', () => ({
	getDateTimeStamp: vi.fn(() => '2024-01-01T12:00:00'),
	createImportFilePath: vi.fn((file: string) => file),
	getFileType: vi.fn(() => 'application/json'),
	tryCatch: async (promise: Promise<any>) => {
		try {
			const data = await promise;
			return [data, null];
		} catch (error) {
			return [null, error];
		}
	},
}));

// Mock env constants
vi.mock('../envs-constants', () => ({
	env: {
		CLERK_SECRET_KEY: 'test_secret_key',
		RATE_LIMIT: 10,
		CONCURRENCY_LIMIT: 5,
		OFFSET: 0,
	},
}));

// Mock fs module
vi.mock('fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

// Mock logger module
vi.mock('../logger', () => ({
	errorLogger: vi.fn(),
	importLogger: vi.fn(),
	deleteErrorLogger: vi.fn(),
	deleteLogger: vi.fn(),
	closeAllStreams: vi.fn(),
}));

// Import after mocks are set up
import { deleteErrorLogger, deleteLogger } from '../logger';
import * as fs from 'fs';

// Get reference to mocked functions - cast to mock type since vi.mocked is not available
const mockDeleteErrorLogger = deleteErrorLogger as ReturnType<typeof vi.fn>;
const mockDeleteLogger = deleteLogger as ReturnType<typeof vi.fn>;

describe('delete-users', () => {
	let fetchUsers: any;
	let deleteUsers: any;
	let readSettings: any;
	let readMigrationFile: any;
	let findIntersection: any;

	const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
	const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Set default return values to handle auto-execution of processUsers()
		mockGetUserList.mockResolvedValue({ data: [] });
		mockDeleteUser.mockResolvedValue({});
		mockExistsSync.mockReturnValue(true);

		// Mock readFileSync to return different data based on file path
		mockReadFileSync.mockImplementation((filePath: any) => {
			const path = filePath.toString();
			if (path.includes('.settings')) {
				return JSON.stringify({ file: 'samples/test.json' });
			}
			// Return empty array for migration files by default
			return JSON.stringify([]);
		});

		// Import the module to get functions - note: vi.resetModules() is not available in Bun's Vitest
		const deleteUsersModule = await import('./index');
		fetchUsers = deleteUsersModule.fetchUsers;
		deleteUsers = deleteUsersModule.deleteUsers;
		readSettings = deleteUsersModule.readSettings;
		readMigrationFile = deleteUsersModule.readMigrationFile;
		findIntersection = deleteUsersModule.findIntersection;

		vi.clearAllMocks();
	});

	describe('fetchUsers', () => {
		test('fetches users with limit 500 and offset 0 on first call', async () => {
			mockGetUserList.mockResolvedValueOnce({
				data: [
					{ id: 'user_1', firstName: 'John' },
					{ id: 'user_2', firstName: 'Jane' },
				],
			});

			await fetchUsers(0);

			expect(mockGetUserList).toHaveBeenCalledTimes(1);
			expect(mockGetUserList).toHaveBeenCalledWith({
				offset: 0,
				limit: 500,
			});
		});

		test('returns users when data length is less than limit', async () => {
			const mockUsers = [
				{ id: 'user_1', firstName: 'John' },
				{ id: 'user_2', firstName: 'Jane' },
			];
			mockGetUserList.mockResolvedValueOnce({ data: mockUsers });

			const result = await fetchUsers(0);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('user_1');
			expect(result[1].id).toBe('user_2');
		});

		test('paginates when data length equals limit (500)', async () => {
			// Create 500 users for first page
			const firstPage = Array.from({ length: 500 }, (_, i) => ({
				id: `user_${i}`,
				firstName: `User${i}`,
			}));

			// Create 200 users for second page
			const secondPage = Array.from({ length: 200 }, (_, i) => ({
				id: `user_${i + 500}`,
				firstName: `User${i + 500}`,
			}));

			mockGetUserList
				.mockResolvedValueOnce({ data: firstPage })
				.mockResolvedValueOnce({ data: secondPage });

			const result = await fetchUsers(0);

			expect(mockGetUserList).toHaveBeenCalledTimes(2);
			expect(mockGetUserList).toHaveBeenNthCalledWith(1, {
				offset: 0,
				limit: 500,
			});
			expect(mockGetUserList).toHaveBeenNthCalledWith(2, {
				offset: 500,
				limit: 500,
			});
			expect(result).toHaveLength(700);
		});

		test('paginates through multiple pages without delay', async () => {
			const firstPage = Array.from({ length: 500 }, (_, i) => ({
				id: `user_${i}`,
				firstName: `User${i}`,
			}));

			const secondPage = Array.from({ length: 100 }, (_, i) => ({
				id: `user_${i + 500}`,
				firstName: `User${i + 500}`,
			}));

			mockGetUserList
				.mockResolvedValueOnce({ data: firstPage })
				.mockResolvedValueOnce({ data: secondPage });

			const result = await fetchUsers(0);

			// Should fetch both pages
			expect(mockGetUserList).toHaveBeenCalledTimes(2);
			expect(result).toHaveLength(600);
		});

		test('handles multiple pagination rounds (3 batches)', async () => {
			const firstPage = Array.from({ length: 500 }, (_, i) => ({
				id: `user_${i}`,
				firstName: `User${i}`,
			}));

			const secondPage = Array.from({ length: 500 }, (_, i) => ({
				id: `user_${i + 500}`,
				firstName: `User${i + 500}`,
			}));

			const thirdPage = Array.from({ length: 150 }, (_, i) => ({
				id: `user_${i + 1000}`,
				firstName: `User${i + 1000}`,
			}));

			mockGetUserList
				.mockResolvedValueOnce({ data: firstPage })
				.mockResolvedValueOnce({ data: secondPage })
				.mockResolvedValueOnce({ data: thirdPage });

			const result = await fetchUsers(0);

			expect(mockGetUserList).toHaveBeenCalledTimes(3);
			expect(mockGetUserList).toHaveBeenNthCalledWith(1, {
				offset: 0,
				limit: 500,
			});
			expect(mockGetUserList).toHaveBeenNthCalledWith(2, {
				offset: 500,
				limit: 500,
			});
			expect(mockGetUserList).toHaveBeenNthCalledWith(3, {
				offset: 1000,
				limit: 500,
			});
			expect(result).toHaveLength(1150);
			expect(mockGetUserList).toHaveBeenCalledTimes(3);
		});

		test('handles empty user list', async () => {
			mockGetUserList.mockResolvedValueOnce({ data: [] });

			const result = await fetchUsers(0);

			expect(mockGetUserList).toHaveBeenCalledTimes(1);
			expect(result).toHaveLength(0);
		});
	});

	describe('deleteUsers', () => {
		const dateTime = '2024-01-01T12:00:00';

		test('deletes all users sequentially', async () => {
			mockDeleteUser.mockResolvedValue({});

			const users = [
				{ id: 'user_1', firstName: 'John' },
				{ id: 'user_2', firstName: 'Jane' },
				{ id: 'user_3', firstName: 'Bob' },
			] as any[];

			await deleteUsers(users, dateTime);

			expect(mockDeleteUser).toHaveBeenCalledTimes(3);
			expect(mockDeleteUser).toHaveBeenNthCalledWith(1, 'user_1');
			expect(mockDeleteUser).toHaveBeenNthCalledWith(2, 'user_2');
			expect(mockDeleteUser).toHaveBeenNthCalledWith(3, 'user_3');
		});

		test('processes deletions concurrently', async () => {
			mockDeleteUser.mockResolvedValue({});

			const users = [
				{ id: 'user_1', firstName: 'John' },
				{ id: 'user_2', firstName: 'Jane' },
				{ id: 'user_3', firstName: 'Bob' },
			] as any[];

			await deleteUsers(users, dateTime);

			// Should delete all users
			expect(mockDeleteUser).toHaveBeenCalledTimes(3);
		});

		test('updates progress counter after each deletion', async () => {
			mockDeleteUser.mockResolvedValue({});

			const users = [
				{ id: 'user_1', firstName: 'John' },
				{ id: 'user_2', firstName: 'Jane' },
				{ id: 'user_3', firstName: 'Bob' },
			] as any[];

			await deleteUsers(users, dateTime);

			// Verify all deletions completed
			expect(mockDeleteUser).toHaveBeenCalledTimes(3);
		});

		test('handles empty user array', async () => {
			await deleteUsers([], dateTime);

			expect(mockDeleteUser).not.toHaveBeenCalled();
		});

		test('continues deletion if one fails and logs error', async () => {
			mockDeleteUser
				.mockResolvedValueOnce({})
				.mockRejectedValueOnce(new Error('Delete failed'))
				.mockResolvedValueOnce({});

			const users = [
				{ id: 'user_1', externalId: 'ext_1', firstName: 'John' },
				{ id: 'user_2', externalId: 'ext_2', firstName: 'Jane' },
				{ id: 'user_3', externalId: 'ext_3', firstName: 'Bob' },
			] as any[];

			await deleteUsers(users, dateTime);

			// Should attempt all three deletions
			expect(mockDeleteUser).toHaveBeenCalledTimes(3);

			// Should log to both error log and delete log for user_2
			expect(mockDeleteErrorLogger).toHaveBeenCalledTimes(1);
			expect(mockDeleteErrorLogger).toHaveBeenCalledWith(
				{
					userId: 'ext_2',
					status: 'error',
					errors: [{ message: 'Delete failed', longMessage: 'Delete failed' }],
				},
				dateTime
			);

			// Should also log to delete log file
			expect(mockDeleteLogger).toHaveBeenCalledTimes(3); // 2 success + 1 error
			expect(mockDeleteLogger).toHaveBeenCalledWith(
				{ userId: 'ext_2', status: 'error', error: 'Delete failed' },
				dateTime
			);
		});

		test('logs errors with user id when externalId is not present', async () => {
			mockDeleteUser.mockRejectedValueOnce(new Error('API error'));

			const users = [
				{ id: 'user_1', firstName: 'John' }, // no externalId
			] as any[];

			await deleteUsers(users, dateTime);

			expect(mockDeleteErrorLogger).toHaveBeenCalledWith(
				{
					userId: 'user_1',
					status: 'error',
					errors: [{ message: 'API error', longMessage: 'API error' }],
				},
				dateTime
			);

			expect(mockDeleteLogger).toHaveBeenCalledWith(
				{ userId: 'user_1', status: 'error', error: 'API error' },
				dateTime
			);
		});

		test('tracks successful and failed deletions separately', async () => {
			mockDeleteUser
				.mockResolvedValueOnce({})
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockResolvedValueOnce({})
				.mockRejectedValueOnce(new Error('Error 2'));

			const users = [
				{ id: 'user_1', firstName: 'John' },
				{ id: 'user_2', firstName: 'Jane' },
				{ id: 'user_3', firstName: 'Bob' },
				{ id: 'user_4', firstName: 'Alice' },
			] as any[];

			await deleteUsers(users, dateTime);

			expect(mockDeleteUser).toHaveBeenCalledTimes(4);
			expect(mockDeleteErrorLogger).toHaveBeenCalledTimes(2);
			expect(mockDeleteLogger).toHaveBeenCalledTimes(4); // All 4 users logged (2 success + 2 error)
		});
	});

	describe('readSettings', () => {
		test('reads settings file and returns file path', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(
				JSON.stringify({ file: 'samples/users.json' })
			);

			const result = readSettings();

			expect(result).toBe('samples/users.json');
			expect(mockExistsSync).toHaveBeenCalledWith(
				expect.stringContaining('.settings')
			);
			expect(mockReadFileSync).toHaveBeenCalledWith(
				expect.stringContaining('.settings'),
				'utf-8'
			);
		});

		test('exits with error when .settings file does not exist', () => {
			mockExistsSync.mockReturnValue(false);
			const mockExit = vi
				.spyOn(process, 'exit')
				.mockImplementation(() => undefined as never);

			readSettings();

			expect(mockExit).toHaveBeenCalledWith(1);
			mockExit.mockRestore();
		});

		test('exits with error when .settings file has no file property', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify({ key: 'authjs' }));
			const mockExit = vi
				.spyOn(process, 'exit')
				.mockImplementation(() => undefined as never);

			readSettings();

			expect(mockExit).toHaveBeenCalledWith(1);
			mockExit.mockRestore();
		});
	});

	describe('readMigrationFile', () => {
		test('reads JSON migration file and returns set of user IDs', async () => {
			const mockUsers = [
				{ userId: '1', email: 'user1@example.com' },
				{ userId: '2', email: 'user2@example.com' },
				{ userId: '3', email: 'user3@example.com' },
			];

			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(mockUsers));

			const result = await readMigrationFile('samples/users.json');

			expect(result).toBeInstanceOf(Set);
			expect(result.size).toBe(3);
			expect(result.has('1')).toBe(true);
			expect(result.has('2')).toBe(true);
			expect(result.has('3')).toBe(true);
		});

		test("reads JSON file with 'id' field instead of 'userId'", async () => {
			const mockUsers = [
				{ id: 'user_1', email: 'user1@example.com' },
				{ id: 'user_2', email: 'user2@example.com' },
			];

			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(mockUsers));

			const result = await readMigrationFile('samples/users.json');

			expect(result.size).toBe(2);
			expect(result.has('user_1')).toBe(true);
			expect(result.has('user_2')).toBe(true);
		});

		test('exits with error when migration file does not exist', async () => {
			mockExistsSync.mockReturnValue(false);
			const mockExit = vi
				.spyOn(process, 'exit')
				.mockImplementation(() => undefined as never);

			await readMigrationFile('samples/nonexistent.json');

			expect(mockExit).toHaveBeenCalledWith(1);
			mockExit.mockRestore();
		});

		test('handles empty user array in JSON file', async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify([]));

			const result = await readMigrationFile('samples/empty.json');

			expect(result).toBeInstanceOf(Set);
			expect(result.size).toBe(0);
		});

		test('skips users without userId or id field in JSON', async () => {
			const mockUsers = [
				{ userId: '1', email: 'user1@example.com' },
				{ email: 'user2@example.com' }, // no userId or id
				{ userId: '3', email: 'user3@example.com' },
			];

			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(mockUsers));

			const result = await readMigrationFile('samples/users.json');

			expect(result.size).toBe(2);
			expect(result.has('1')).toBe(true);
			expect(result.has('3')).toBe(true);
		});
	});

	describe('findIntersection', () => {
		test('finds users that exist in both Clerk and migration file', () => {
			const clerkUsers = [
				{ id: 'clerk_1', externalId: '1' },
				{ id: 'clerk_2', externalId: '2' },
				{ id: 'clerk_3', externalId: '3' },
				{ id: 'clerk_4', externalId: '4' },
			] as any[];

			const migrationUserIds = new Set(['2', '3', '5']);

			const result = findIntersection(clerkUsers, migrationUserIds);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('clerk_2');
			expect(result[1].id).toBe('clerk_3');
		});

		test('returns empty array when no users match', () => {
			const clerkUsers = [
				{ id: 'clerk_1', externalId: '1' },
				{ id: 'clerk_2', externalId: '2' },
			] as any[];

			const migrationUserIds = new Set(['5', '6']);

			const result = findIntersection(clerkUsers, migrationUserIds);

			expect(result).toHaveLength(0);
		});

		test('ignores Clerk users without externalId', () => {
			const clerkUsers = [
				{ id: 'clerk_1', externalId: '1' },
				{ id: 'clerk_2' }, // no externalId
				{ id: 'clerk_3', externalId: '3' },
			] as any[];

			const migrationUserIds = new Set(['1', '2', '3']);

			const result = findIntersection(clerkUsers, migrationUserIds);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('clerk_1');
			expect(result[1].id).toBe('clerk_3');
		});

		test('handles empty Clerk users array', () => {
			const clerkUsers = [] as any[];
			const migrationUserIds = new Set(['1', '2']);

			const result = findIntersection(clerkUsers, migrationUserIds);

			expect(result).toHaveLength(0);
		});

		test('handles empty migration user IDs set', () => {
			const clerkUsers = [
				{ id: 'clerk_1', externalId: '1' },
				{ id: 'clerk_2', externalId: '2' },
			] as any[];
			const migrationUserIds = new Set<string>();

			const result = findIntersection(clerkUsers, migrationUserIds);

			expect(result).toHaveLength(0);
		});
	});

	describe('integration: full delete process', () => {
		test('fetches and deletes 750 users across 2 pages', async () => {
			const dateTime = '2024-01-01T12:00:00';

			// Setup pagination mock
			const firstPage = Array.from({ length: 500 }, (_, i) => ({
				id: `user_${i}`,
				firstName: `User${i}`,
			}));

			const secondPage = Array.from({ length: 250 }, (_, i) => ({
				id: `user_${i + 500}`,
				firstName: `User${i + 500}`,
			}));

			mockGetUserList
				.mockResolvedValueOnce({ data: firstPage })
				.mockResolvedValueOnce({ data: secondPage });

			mockDeleteUser.mockResolvedValue({});

			// Fetch users
			const users = await fetchUsers(0);
			expect(users).toHaveLength(750);
			expect(mockGetUserList).toHaveBeenCalledTimes(2);

			vi.clearAllMocks();

			// Delete users
			await deleteUsers(users, dateTime);
			expect(mockDeleteUser).toHaveBeenCalledTimes(750);
		});
	});
});
