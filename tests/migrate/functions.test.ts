import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { loadUsersFromFile } from '../../src/migrate/functions';
import { transformKeys } from '../../src/utils';
import { transformers } from '../../src/transformers';

// Snapshot of files in logs/ before each test so we only clean up test-created files
let existingLogFiles: Set<string> = new Set();

const snapshotExistingLogs = () => {
	if (existsSync('logs')) {
		existingLogFiles = new Set(readdirSync('logs'));
	} else {
		existingLogFiles = new Set();
	}
};

const cleanupTestLogs = () => {
	if (!existsSync('logs')) return;
	for (const file of readdirSync('logs')) {
		if (!existingLogFiles.has(file)) {
			unlinkSync(`logs/${file}`);
		}
	}
};

beforeEach(snapshotExistingLogs);
afterEach(cleanupTestLogs);

test('Clerk - loadUsersFromFile - JSON', async () => {
	const { users: usersFromClerk } = await loadUsersFromFile(
		'./samples/clerk.json',
		'clerk'
	);

	// Find users with verified emails
	const usersWithEmail = usersFromClerk.filter(
		(u) => u.email && (Array.isArray(u.email) ? u.email.length > 0 : u.email)
	);
	expect(usersWithEmail.length).toBeGreaterThanOrEqual(2);

	// Find users with metadata
	const usersWithMetadata = usersFromClerk.filter(
		(u) => u.publicMetadata || u.privateMetadata || u.unsafeMetadata
	);
	expect(usersWithMetadata.length).toBeGreaterThanOrEqual(2);

	// Find users with username
	const usersWithUsername = usersFromClerk.filter((u) => u.username);
	expect(usersWithUsername.length).toBeGreaterThanOrEqual(2);

	// Find users with username and password
	const usersWithUsernameAndPassword = usersFromClerk.filter(
		(u) => u.username && u.password && u.passwordHasher
	);
	expect(usersWithUsernameAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with email and password
	const usersWithEmailAndPassword = usersFromClerk.filter(
		(u) => u.email && u.password && u.passwordHasher
	);
	expect(usersWithEmailAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with phone
	const usersWithPhone = usersFromClerk.filter(
		(u) => u.phone && (Array.isArray(u.phone) ? u.phone.length > 0 : u.phone)
	);
	expect(usersWithPhone.length).toBeGreaterThanOrEqual(2);
});

test('Auth.js - loadUsersFromFile - JSON', async () => {
	const { users: usersFromAuthjs } = await loadUsersFromFile(
		'./samples/authjs.json',
		'authjs'
	);

	// Find users with verified emails
	const usersWithEmail = usersFromAuthjs.filter(
		(u) => u.email && (Array.isArray(u.email) ? u.email.length > 0 : u.email)
	);
	expect(usersWithEmail.length).toBeGreaterThanOrEqual(2);

	// Note: Users with ONLY unverified emails (email_verified: null) will be
	// filtered out during validation because Clerk requires at least one verified
	// identifier (email or phone). This is correct behavior.

	// Find users with firstName and lastName (split from name field)
	const usersWithNames = usersFromAuthjs.filter(
		(u) => u.firstName && u.lastName
	);
	expect(usersWithNames.length).toBeGreaterThanOrEqual(15);

	// Verify a specific user's name was split correctly
	const janeDoUser = usersFromAuthjs.find(
		(u) => u.email === 'jane.doe@test.com'
	);
	expect(janeDoUser?.firstName).toBe('Jane');
	expect(janeDoUser?.lastName).toBe('Doe');

	// Verify a user with no name (null) doesn't have firstName/lastName
	const userWithNullName = usersFromAuthjs.find(
		(u) => u.email === 'noprofile@test.com'
	);
	expect(userWithNullName?.firstName).toBeUndefined();
	expect(userWithNullName?.lastName).toBeUndefined();
});

test('Supabase - loadUsersFromFile - JSON', async () => {
	const { users: usersFromSupabase } = await loadUsersFromFile(
		'./samples/supabase.json',
		'supabase'
	);

	// Find users with verified emails
	const usersWithEmail = usersFromSupabase.filter(
		(u) => u.email && (Array.isArray(u.email) ? u.email.length > 0 : u.email)
	);
	expect(usersWithEmail.length).toBeGreaterThanOrEqual(2);

	// Find users with username
	const usersWithUsername = usersFromSupabase.filter((u) => u.username);
	expect(usersWithUsername.length).toBeGreaterThanOrEqual(2);

	// Find users with username and password
	const usersWithUsernameAndPassword = usersFromSupabase.filter(
		(u) => u.username && u.password && u.passwordHasher
	);
	expect(usersWithUsernameAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with email and password
	const usersWithEmailAndPassword = usersFromSupabase.filter(
		(u) => u.email && u.password && u.passwordHasher
	);
	expect(usersWithEmailAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with phone
	const usersWithPhone = usersFromSupabase.filter(
		(u) => u.phone && (Array.isArray(u.phone) ? u.phone.length > 0 : u.phone)
	);
	expect(usersWithPhone.length).toBeGreaterThanOrEqual(2);
});

test('Auth0 - loadUsersFromFile - JSON', async () => {
	const { users: usersFromAuth0 } = await loadUsersFromFile(
		'./samples/auth0.json',
		'auth0'
	);

	// Verify we have users
	expect(usersFromAuth0.length).toBeGreaterThan(0);

	// Find users with verified emails
	const usersWithEmail = usersFromAuth0.filter(
		(u) => u.email && (Array.isArray(u.email) ? u.email.length > 0 : u.email)
	);
	expect(usersWithEmail.length).toBeGreaterThanOrEqual(2);

	// Find users with unverified emails
	const usersWithUnverifiedEmail = usersFromAuth0.filter(
		(u) => u.unverifiedEmailAddresses
	);
	expect(usersWithUnverifiedEmail.length).toBeGreaterThanOrEqual(1);

	// Find users with username
	const usersWithUsername = usersFromAuth0.filter((u) => u.username);
	expect(usersWithUsername.length).toBeGreaterThanOrEqual(2);

	// Find users with phone (verified)
	const usersWithPhone = usersFromAuth0.filter(
		(u) => u.phone && (Array.isArray(u.phone) ? u.phone.length > 0 : u.phone)
	);
	expect(usersWithPhone.length).toBeGreaterThanOrEqual(2);

	// Find users with unverified phone
	const usersWithUnverifiedPhone = usersFromAuth0.filter(
		(u) => u.unverifiedPhoneNumbers
	);
	expect(usersWithUnverifiedPhone.length).toBeGreaterThanOrEqual(1);

	// Verify createdAt is mapped
	const usersWithCreatedAt = usersFromAuth0.filter((u) => u.createdAt);
	expect(usersWithCreatedAt.length).toBeGreaterThanOrEqual(2);

	// Note: Auth0 does not export password hashes, so no password tests
});

// ============================================================================
// transformKeys tests
// ============================================================================

describe('transformKeys', () => {
	// Test setup: these transformers are guaranteed to exist in the transformers array
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const clerkTransformer = transformers.find((h) => h.key === 'clerk')!;
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const supabaseTransformer = transformers.find((h) => h.key === 'supabase')!;
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const auth0Transformer = transformers.find((h) => h.key === 'auth0')!;

	describe('key transformation', () => {
		test('transforms keys according to transformer config', () => {
			const data = {
				id: 'user_123',
				first_name: 'John',
				last_name: 'Doe',
				primary_email_address: 'john@example.com',
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				firstName: 'John',
				lastName: 'Doe',
				email: 'john@example.com',
			});
		});

		test('transforms Clerk-specific keys', () => {
			const data = {
				id: 'user_123',
				primary_email_address: 'john@example.com',
				verified_email_addresses: ['john@example.com', 'other@example.com'],
				password_digest: '$2a$10$hash',
				password_hasher: 'bcrypt',
				totp_secret: 'SECRET',
				backup_codes_enabled: false,
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				email: 'john@example.com',
				emailAddresses: ['john@example.com', 'other@example.com'],
				password: '$2a$10$hash',
				passwordHasher: 'bcrypt',
				totpSecret: 'SECRET',
				backupCodesEnabled: false,
			});
		});

		test('transforms Supabase-specific keys', () => {
			const data = {
				id: 'uuid-123',
				email: 'jane@example.com',
				email_confirmed_at: '2024-01-01 12:00:00+00',
				first_name: 'Jane',
				last_name: 'Smith',
				encrypted_password: '$2a$10$hash',
				phone: '+1234567890',
			};

			const result = transformKeys(data, supabaseTransformer);

			expect(result).toEqual({
				userId: 'uuid-123',
				email: 'jane@example.com',
				emailConfirmedAt: '2024-01-01 12:00:00+00',
				firstName: 'Jane',
				lastName: 'Smith',
				password: '$2a$10$hash',
				phone: '+1234567890',
			});
		});

		test('transforms Auth0-specific keys', () => {
			const data = {
				user_id: 'auth0|abc123',
				email: 'user@example.com',
				email_verified: true,
				username: 'bobuser',
				given_name: 'Bob',
				family_name: 'Jones',
				phone_number: '+1987654321',
				phone_verified: false,
				user_metadata: { role: 'admin' },
				app_metadata: { subscription: 'pro' },
				created_at: '2025-01-15T10:30:00.000Z',
			};

			const result = transformKeys(data, auth0Transformer);

			expect(result).toEqual({
				userId: 'auth0|abc123',
				email: 'user@example.com',
				emailVerified: true,
				username: 'bobuser',
				firstName: 'Bob',
				lastName: 'Jones',
				phone: '+1987654321',
				phoneVerified: false,
				publicMetadata: { role: 'admin' },
				privateMetadata: { subscription: 'pro' },
				createdAt: '2025-01-15T10:30:00.000Z',
			});
		});

		test('keeps unmapped keys unchanged', () => {
			const data = {
				id: 'user_123',
				customField: 'custom value',
				anotherField: 42,
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				customField: 'custom value',
				anotherField: 42,
			});
		});
	});

	describe('filtering empty values', () => {
		test('filters out empty strings', () => {
			const data = {
				id: 'user_123',
				first_name: 'John',
				last_name: '',
				primary_email_address: 'john@example.com',
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				firstName: 'John',
				email: 'john@example.com',
			});
			expect(result).not.toHaveProperty('lastName');
		});

		test("filters out empty JSON string '{\"}'", () => {
			const data = {
				id: 'user_123',
				first_name: 'John',
				public_metadata: '"{}"',
				unsafe_metadata: '"{}"',
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				firstName: 'John',
			});
			expect(result).not.toHaveProperty('publicMetadata');
			expect(result).not.toHaveProperty('unsafeMetadata');
		});

		test('filters out null values', () => {
			const data = {
				id: 'user_123',
				first_name: 'John',
				last_name: null,
				username: null,
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				firstName: 'John',
			});
			expect(result).not.toHaveProperty('lastName');
			expect(result).not.toHaveProperty('username');
		});

		test('keeps falsy but valid values (false, 0)', () => {
			const data = {
				id: 'user_123',
				backup_codes_enabled: false,
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				backupCodesEnabled: false,
			});
		});

		test('keeps undefined values (current behavior)', () => {
			const data = {
				id: 'user_123',
				first_name: undefined,
			};

			const result = transformKeys(data, clerkTransformer);

			// undefined is not filtered, only "", '"{}"', and null
			expect(result).toHaveProperty('firstName');
			expect(result.firstName).toBeUndefined();
		});
	});

	describe('edge cases', () => {
		test('handles empty object', () => {
			const result = transformKeys({}, clerkTransformer);
			expect(result).toEqual({});
		});

		test('handles object with only filtered values', () => {
			const data = {
				first_name: '',
				last_name: null,
				username: '"{}"',
			};

			const result = transformKeys(data, clerkTransformer);
			expect(result).toEqual({});
		});

		test('preserves array values', () => {
			const data = {
				id: 'user_123',
				verified_email_addresses: ['a@example.com', 'b@example.com'],
				verified_phone_numbers: ['+1111111111', '+2222222222'],
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result.emailAddresses).toEqual(['a@example.com', 'b@example.com']);
			expect(result.phoneNumbers).toEqual(['+1111111111', '+2222222222']);
		});

		test('preserves object values', () => {
			const data = {
				id: 'user_123',
				public_metadata: { role: 'admin', tier: 'premium' },
				private_metadata: { internalId: 456 },
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result.publicMetadata).toEqual({ role: 'admin', tier: 'premium' });
			expect(result.privateMetadata).toEqual({ internalId: 456 });
		});

		test('handles special characters in values', () => {
			const data = {
				id: 'user_123',
				first_name: 'José',
				last_name: "O'Brien",
				username: 'user@special!',
			};

			const result = transformKeys(data, clerkTransformer);

			expect(result).toEqual({
				userId: 'user_123',
				firstName: 'José',
				lastName: "O'Brien",
				username: 'user@special!',
			});
		});
	});
});

// ============================================================================
// Clerk transformer - pipe separator tests
// ============================================================================

describe('Clerk transformer - email and phone parsing with pipe separators', () => {
	test('parses pipe-separated emails in CSV format', async () => {
		// This test verifies the fix for rows with pipe-separated emails
		// like: verified_email_addresses: "email1@test.com|email2@test.com"
		const { users } = await loadUsersFromFile('./samples/clerk.csv', 'clerk');

		const userWithPipeSeparatedEmails = users.find(
			(u) => u.userId === 'user_pipe_email_test'
		);

		expect(userWithPipeSeparatedEmails).toBeDefined();
		expect(Array.isArray(userWithPipeSeparatedEmails?.email)).toBe(true);
		expect(userWithPipeSeparatedEmails?.email).toEqual([
			'primary@test.com',
			'secondary@test.com',
		]);
	});

	test('parses pipe-separated phones in CSV format', async () => {
		const { users } = await loadUsersFromFile('./samples/clerk.csv', 'clerk');

		const userWithPipeSeparatedPhones = users.find(
			(u) => u.userId === 'user_pipe_phone_test'
		);

		expect(userWithPipeSeparatedPhones).toBeDefined();
		expect(Array.isArray(userWithPipeSeparatedPhones?.phone)).toBe(true);
		expect(userWithPipeSeparatedPhones?.phone).toEqual([
			'+12125550200',
			'+12125550201',
		]);
	});

	test('parses mixed comma and pipe separators for emails', async () => {
		const { users } = await loadUsersFromFile('./samples/clerk.csv', 'clerk');

		const userWithMixedSeparators = users.find(
			(u) => u.userId === 'user_mixed_separator_test'
		);

		expect(userWithMixedSeparators).toBeDefined();
		expect(Array.isArray(userWithMixedSeparators?.email)).toBe(true);
		expect(userWithMixedSeparators?.email).toEqual([
			'first@test.com',
			'second@test.com',
			'third@test.com',
		]);
	});

	test('parses mixed comma and pipe separators for phones', async () => {
		const { users } = await loadUsersFromFile('./samples/clerk.csv', 'clerk');

		const userWithMixedPhoneSeparators = users.find(
			(u) => u.userId === 'user_mixed_phone_separator_test'
		);

		expect(userWithMixedPhoneSeparators).toBeDefined();
		expect(Array.isArray(userWithMixedPhoneSeparators?.phone)).toBe(true);
		expect(userWithMixedPhoneSeparators?.phone).toEqual([
			'+12125550300',
			'+12125550301',
		]);
	});
});
