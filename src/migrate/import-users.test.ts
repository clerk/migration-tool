import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

// Mock @clerk/backend before importing the module
const mockCreateUser = vi.fn();
const mockCreateEmailAddress = vi.fn();
const mockCreatePhoneNumber = vi.fn();
vi.mock('@clerk/backend', () => ({
	createClerkClient: vi.fn(() => ({
		users: {
			createUser: mockCreateUser,
		},
		emailAddresses: {
			createEmailAddress: mockCreateEmailAddress,
		},
		phoneNumbers: {
			createPhoneNumber: mockCreatePhoneNumber,
		},
	})),
}));

// Mock @clack/prompts to prevent console output during tests
vi.mock('@clack/prompts', () => ({
	note: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
}));

// Mock picocolors to prevent console output during tests
vi.mock('picocolors', () => ({
	default: {
		bold: vi.fn((s) => s),
		dim: vi.fn((s) => s),
		gray: vi.fn((s) => s),
		green: vi.fn((s) => s),
		red: vi.fn((s) => s),
		yellow: vi.fn((s) => s),
		blue: vi.fn((s) => s),
		cyan: vi.fn((s) => s),
		white: vi.fn((s) => s),
		black: vi.fn((s) => s),
		bgCyan: vi.fn((s) => s),
	},
}));

// Mock utils for testing
vi.mock('../utils', () => ({
	getDateTimeStamp: vi.fn(() => '2024-01-01T12:00:00'),
	tryCatch: async (promise: Promise<any>) => {
		try {
			const data = await promise;
			return [data, null];
		} catch (throwable) {
			if (throwable instanceof Error) return [null, throwable];
			throw throwable;
		}
	},
}));

// Mock logger module
vi.mock('../logger', () => ({
	errorLogger: vi.fn(),
	importLogger: vi.fn(),
	closeAllStreams: vi.fn(),
}));

// Mock env constants
vi.mock('../envs-constants', () => ({
	env: {
		CLERK_SECRET_KEY: 'test_secret_key',
		DELAY: 0,
		RETRY_DELAY_MS: 0,
		OFFSET: 0,
	},
}));

// Import after mocks are set up
import { importUsers } from './import-users';
import * as logger from '../logger';

// Helper to clean up logs directory
const cleanupLogs = () => {
	if (existsSync('logs')) {
		rmSync('logs', { recursive: true, force: true, maxRetries: 3 });
	}
};

describe('importUsers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cleanupLogs();
	});

	afterEach(() => {
		cleanupLogs();
	});

	describe('createUser API calls', () => {
		test('calls Clerk API with correct params for user with password', async () => {
			mockCreateUser.mockResolvedValue({ id: 'user_created' });

			const users = [
				{
					userId: 'user_123',
					email: ['john@example.com'],
					firstName: 'John',
					lastName: 'Doe',
					password: '$2a$10$hashedpassword',
					passwordHasher: 'bcrypt' as const,
					username: 'johndoe',
				},
			];

			await importUsers(users);

			expect(mockCreateUser).toHaveBeenCalledTimes(1);
			expect(mockCreateUser).toHaveBeenCalledWith({
				externalId: 'user_123',
				emailAddress: ['john@example.com'],
				firstName: 'John',
				lastName: 'Doe',
				passwordDigest: '$2a$10$hashedpassword',
				passwordHasher: 'bcrypt',
				username: 'johndoe',
				phoneNumber: undefined,
				totpSecret: undefined,
			});
		});

		test('calls Clerk API with skipPasswordRequirement for user without password', async () => {
			mockCreateUser.mockResolvedValue({ id: 'user_created' });

			const users = [
				{
					userId: 'user_456',
					email: ['jane@example.com'],
					firstName: 'Jane',
					lastName: 'Smith',
				},
			];

			await importUsers(users, true);

			expect(mockCreateUser).toHaveBeenCalledTimes(1);
			expect(mockCreateUser).toHaveBeenCalledWith({
				externalId: 'user_456',
				emailAddress: ['jane@example.com'],
				firstName: 'Jane',
				lastName: 'Smith',
				skipPasswordRequirement: true,
				username: undefined,
				phoneNumber: undefined,
				totpSecret: undefined,
			});
		});

		test('processes multiple users concurrently', async () => {
			mockCreateUser.mockResolvedValue({ id: 'user_created' });

			const users = [
				{ userId: 'user_1', email: ['user1@example.com'] },
				{ userId: 'user_2', email: ['user2@example.com'] },
				{ userId: 'user_3', email: ['user3@example.com'] },
			];

			await importUsers(users);

			expect(mockCreateUser).toHaveBeenCalledTimes(3);
		});

		test('includes phone number when provided', async () => {
			mockCreateUser.mockResolvedValue({ id: 'user_created' });

			const users = [
				{
					userId: 'user_phone',
					email: ['phone@example.com'],
					phone: ['+1234567890'],
				},
			];

			await importUsers(users);

			expect(mockCreateUser).toHaveBeenCalledWith(
				expect.objectContaining({
					phoneNumber: ['+1234567890'],
				})
			);
		});

		test('includes TOTP secret when provided', async () => {
			mockCreateUser.mockResolvedValue({ id: 'user_created' });

			const users = [
				{
					userId: 'user_totp',
					email: ['totp@example.com'],
					totpSecret: 'JBSWY3DPEHPK3PXP',
				},
			];

			await importUsers(users);

			expect(mockCreateUser).toHaveBeenCalledWith(
				expect.objectContaining({
					totpSecret: 'JBSWY3DPEHPK3PXP',
				})
			);
		});
	});

	describe('error handling', () => {
		test('logs error when Clerk API fails', async () => {
			const errorLoggerSpy = vi.spyOn(logger, 'errorLogger');

			const clerkError = {
				status: 422,
				errors: [
					{
						code: 'form_identifier_exists',
						message: 'Email exists',
						longMessage: 'That email address is taken.',
					},
				],
			};
			mockCreateUser.mockRejectedValue(clerkError);

			const users = [{ userId: 'user_fail', email: ['existing@example.com'] }];

			await importUsers(users);

			expect(errorLoggerSpy).toHaveBeenCalled();
			expect(errorLoggerSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: 'user_fail',
					status: '422',
				}),
				expect.any(String)
			);
		});

		test('continues processing after error', async () => {
			mockCreateUser
				.mockRejectedValueOnce({
					status: 400,
					errors: [{ code: 'error', message: 'Failed' }],
				})
				.mockResolvedValueOnce({ id: 'user_2_created' })
				.mockResolvedValueOnce({ id: 'user_3_created' });

			const users = [
				{ userId: 'user_1', email: ['user1@example.com'] },
				{ userId: 'user_2', email: ['user2@example.com'] },
				{ userId: 'user_3', email: ['user3@example.com'] },
			];

			await importUsers(users);

			// All three should be attempted
			expect(mockCreateUser).toHaveBeenCalledTimes(3);
		});

		test('retries on rate limit (429) error', async () => {
			const rateLimitError = {
				status: 429,
				errors: [{ code: 'rate_limit', message: 'Too many requests' }],
			};

			mockCreateUser
				.mockRejectedValueOnce(rateLimitError)
				.mockResolvedValueOnce({ id: 'user_created' });

			const users = [{ userId: 'user_rate', email: ['rate@example.com'] }];

			await importUsers(users);

			// Should be called twice: first fails with 429, retry succeeds
			expect(mockCreateUser).toHaveBeenCalledTimes(2);
		});
	});

	describe('validation', () => {
		test('skips createUser for invalid users (missing userId)', async () => {
			// Mock errorLogger to prevent TypeError from ZodError structure mismatch
			vi.spyOn(logger, 'errorLogger').mockImplementation(() => {});

			const users = [{ email: ['noid@example.com'] } as any];

			await importUsers(users);

			// createUser should not be called for invalid user
			expect(mockCreateUser).not.toHaveBeenCalled();
		});
	});
});

describe('importUsers edge cases', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreatePhoneNumber.mockReset();
		cleanupLogs();
	});

	afterEach(() => {
		cleanupLogs();
	});

	test('handles empty user array', async () => {
		await importUsers([]);
		expect(mockCreateUser).not.toHaveBeenCalled();
	});

	test('handles user with all optional fields', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_full_created' });
		mockCreateEmailAddress.mockResolvedValue({});

		const users = [
			{
				userId: 'user_full',
				email: ['full@example.com', 'secondary@example.com'],
				firstName: 'Full',
				lastName: 'User',
				password: '$2a$10$hash',
				passwordHasher: 'bcrypt' as const,
				username: 'fulluser',
				phone: ['+1111111111'],
				totpSecret: 'SECRET123',
				backupCodesEnabled: true,
			},
		];

		await importUsers(users);

		// createUser should be called with only the primary email
		expect(mockCreateUser).toHaveBeenCalledWith(
			expect.objectContaining({
				externalId: 'user_full',
				emailAddress: ['full@example.com'],
				firstName: 'Full',
				lastName: 'User',
				passwordDigest: '$2a$10$hash',
				passwordHasher: 'bcrypt',
				username: 'fulluser',
				phoneNumber: ['+1111111111'],
				totpSecret: 'SECRET123',
			})
		);

		// createEmailAddress should be called for additional emails
		expect(mockCreateEmailAddress).toHaveBeenCalledWith({
			userId: 'user_full_created',
			emailAddress: 'secondary@example.com',
			primary: false,
		});
	});

	test('adds multiple additional emails after user creation', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_multi_email' });
		mockCreateEmailAddress.mockResolvedValue({});

		const users = [
			{
				userId: 'user_emails',
				email: [
					'primary@example.com',
					'second@example.com',
					'third@example.com',
				],
			},
		];

		await importUsers(users);

		// createUser gets only the first email
		expect(mockCreateUser).toHaveBeenCalledWith(
			expect.objectContaining({
				emailAddress: ['primary@example.com'],
			})
		);

		// createEmailAddress called for each additional email
		expect(mockCreateEmailAddress).toHaveBeenCalledTimes(2);
		expect(mockCreateEmailAddress).toHaveBeenCalledWith({
			userId: 'user_multi_email',
			emailAddress: 'second@example.com',
			primary: false,
		});
		expect(mockCreateEmailAddress).toHaveBeenCalledWith({
			userId: 'user_multi_email',
			emailAddress: 'third@example.com',
			primary: false,
		});
	});

	test('does not call createEmailAddress when only one email', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_single' });

		const users = [
			{
				userId: 'user_one_email',
				email: ['only@example.com'],
			},
		];

		await importUsers(users);

		expect(mockCreateUser).toHaveBeenCalledTimes(1);
		expect(mockCreateEmailAddress).not.toHaveBeenCalled();
	});

	test('adds multiple additional phones after user creation', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_multi_phone' });
		mockCreatePhoneNumber.mockResolvedValue({});

		const users = [
			{
				userId: 'user_phones',
				email: ['test@example.com'],
				phone: ['+1111111111', '+2222222222', '+3333333333'],
			},
		];

		await importUsers(users);

		// createUser gets only the first phone
		expect(mockCreateUser).toHaveBeenCalledWith(
			expect.objectContaining({
				phoneNumber: ['+1111111111'],
			})
		);

		// createPhoneNumber called for each additional phone
		expect(mockCreatePhoneNumber).toHaveBeenCalledTimes(2);
		expect(mockCreatePhoneNumber).toHaveBeenCalledWith({
			userId: 'user_multi_phone',
			phoneNumber: '+2222222222',
			primary: false,
		});
		expect(mockCreatePhoneNumber).toHaveBeenCalledWith({
			userId: 'user_multi_phone',
			phoneNumber: '+3333333333',
			primary: false,
		});
	});

	test('does not call createPhoneNumber when only one phone', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_single_phone' });

		const users = [
			{
				userId: 'user_one_phone',
				email: ['test@example.com'],
				phone: ['+1234567890'],
			},
		];

		await importUsers(users);

		expect(mockCreateUser).toHaveBeenCalledTimes(1);
		expect(mockCreatePhoneNumber).not.toHaveBeenCalled();
	});

	test('handles phone as string (converts to array)', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_string_phone' });

		const users = [
			{
				userId: 'user_string_phone',
				email: ['test@example.com'],
				phone: '+1234567890',
			},
		];

		await importUsers(users);

		expect(mockCreateUser).toHaveBeenCalledWith(
			expect.objectContaining({
				phoneNumber: ['+1234567890'],
			})
		);
		expect(mockCreatePhoneNumber).not.toHaveBeenCalled();
	});

	test('handles user without phone', async () => {
		mockCreateUser.mockResolvedValue({ id: 'user_no_phone' });

		const users = [
			{
				userId: 'user_no_phone',
				email: ['test@example.com'],
			},
		];

		await importUsers(users);

		expect(mockCreateUser).toHaveBeenCalledWith(
			expect.not.objectContaining({
				phoneNumber: expect.anything(),
			})
		);
	});
});
