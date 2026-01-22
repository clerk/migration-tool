import { describe, expect, test } from 'vitest';
import { loadUsersFromFile } from './functions';
import { transformKeys } from '../utils';
import { transformers } from './transformers';

test('Clerk - loadUsersFromFile - JSON', async () => {
	const usersFromClerk = await loadUsersFromFile(
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
	const usersFromAuthjs = await loadUsersFromFile(
		'./samples/authjs.json',
		'authjs'
	);

	// Find users with verified emails
	const usersWithEmail = usersFromAuthjs.filter(
		(u) => u.email && (Array.isArray(u.email) ? u.email.length > 0 : u.email)
	);
	expect(usersWithEmail.length).toBeGreaterThanOrEqual(2);

	// Find users with username
	const usersWithUsername = usersFromAuthjs.filter((u) => u.username);
	expect(usersWithUsername.length).toBeGreaterThanOrEqual(2);

	// Find users with username and password
	const usersWithUsernameAndPassword = usersFromAuthjs.filter(
		(u) => u.username && u.password && u.passwordHasher
	);
	expect(usersWithUsernameAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with email and password
	const usersWithEmailAndPassword = usersFromAuthjs.filter(
		(u) => u.email && u.password && u.passwordHasher
	);
	expect(usersWithEmailAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with phone
	const usersWithPhone = usersFromAuthjs.filter(
		(u) => u.phone && (Array.isArray(u.phone) ? u.phone.length > 0 : u.phone)
	);
	expect(usersWithPhone.length).toBeGreaterThanOrEqual(2);
});

test('Supabase - loadUsersFromFile - JSON', async () => {
	const usersFromSupabase = await loadUsersFromFile(
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
	const usersFromAuth0 = await loadUsersFromFile(
		'./samples/auth0.json',
		'auth0'
	);

	// Find users with verified emails
	const usersWithEmail = usersFromAuth0.filter(
		(u) => u.email && (Array.isArray(u.email) ? u.email.length > 0 : u.email)
	);
	expect(usersWithEmail.length).toBeGreaterThanOrEqual(2);

	// Find users with username
	const usersWithUsername = usersFromAuth0.filter((u) => u.username);
	expect(usersWithUsername.length).toBeGreaterThanOrEqual(2);

	// Find users with username and password
	const usersWithUsernameAndPassword = usersFromAuth0.filter(
		(u) => u.username && u.password && u.passwordHasher
	);
	expect(usersWithUsernameAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with email and password
	const usersWithEmailAndPassword = usersFromAuth0.filter(
		(u) => u.email && u.password && u.passwordHasher
	);
	expect(usersWithEmailAndPassword.length).toBeGreaterThanOrEqual(2);

	// Find users with phone
	const usersWithPhone = usersFromAuth0.filter(
		(u) => u.phone && (Array.isArray(u.phone) ? u.phone.length > 0 : u.phone)
	);
	expect(usersWithPhone.length).toBeGreaterThanOrEqual(2);
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
				_id: { $oid: 'auth0123' },
				email: 'user@example.com',
				email_verified: true,
				username: 'bobuser',
				given_name: 'Bob',
				family_name: 'Jones',
				phone_number: '+1987654321',
				passwordHash: '$2b$10$hash',
				user_metadata: { role: 'admin' },
			};

			const result = transformKeys(data, auth0Transformer);

			// transformKeys now extracts nested paths like "_id.$oid"
			expect(result).toEqual({
				userId: 'auth0123',
				email: 'user@example.com',
				emailVerified: true,
				username: 'bobuser',
				firstName: 'Bob',
				lastName: 'Jones',
				phone: '+1987654321',
				password: '$2b$10$hash',
				publicMetadata: { role: 'admin' },
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
