import { describe, expect, test } from 'vitest';

// ============================================================================
// Better Auth transformer tests
// ============================================================================

describe('betterAuthTransformer', () => {
	async function getTransformer() {
		const mod = await import('../src/transformers/betterauth');
		return mod.default;
	}

	test('has correct key and label', async () => {
		const transformer = await getTransformer();
		expect(transformer.key).toBe('betterauth');
		expect(transformer.label).toBe('Better Auth');
	});

	test('maps core fields correctly', async () => {
		const transformer = await getTransformer();
		expect(transformer.transformer.user_id).toBe('userId');
		expect(transformer.transformer.email).toBe('email');
		expect(transformer.transformer.password_hash).toBe('password');
		expect(transformer.transformer.username).toBe('username');
		expect(transformer.transformer.phone_number).toBe('phone');
		expect(transformer.transformer.created_at).toBe('createdAt');
		expect(transformer.transformer.updated_at).toBe('updatedAt');
	});

	test('sets passwordHasher: bcrypt as default', async () => {
		const transformer = await getTransformer();
		expect(transformer.defaults.passwordHasher).toBe('bcrypt');
	});

	test('routes verified email to email', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			email: 'test@example.com',
			emailVerified: true,
		};
		transformer.postTransform(user);

		expect(user.email).toBe('test@example.com');
		expect(user.unverifiedEmailAddresses).toBeUndefined();
		expect(user.emailVerified).toBeUndefined();
	});

	test('routes unverified email to unverifiedEmailAddresses', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			email: 'test@example.com',
			emailVerified: false,
		};
		transformer.postTransform(user);

		expect(user.email).toBeUndefined();
		expect(user.unverifiedEmailAddresses).toBe('test@example.com');
		expect(user.emailVerified).toBeUndefined();
	});

	test('routes verified phone to phone', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			phone: '+1234567890',
			phoneVerified: true,
		};
		transformer.postTransform(user);

		expect(user.phone).toBe('+1234567890');
		expect(user.unverifiedPhoneNumbers).toBeUndefined();
		expect(user.phoneVerified).toBeUndefined();
	});

	test('routes unverified phone to unverifiedPhoneNumbers', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			phone: '+1234567890',
			phoneVerified: false,
		};
		transformer.postTransform(user);

		expect(user.phone).toBeUndefined();
		expect(user.unverifiedPhoneNumbers).toBe('+1234567890');
		expect(user.phoneVerified).toBeUndefined();
	});

	test('splits name into firstName and lastName', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			name: 'John Doe',
		};
		transformer.postTransform(user);

		expect(user.firstName).toBe('John');
		expect(user.lastName).toBe('Doe');
		expect(user.name).toBeUndefined();
	});

	test('handles multi-word last names', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			name: 'William James Miller',
		};
		transformer.postTransform(user);

		expect(user.firstName).toBe('William');
		expect(user.lastName).toBe('James Miller');
		expect(user.name).toBeUndefined();
	});

	test('handles single-word names (no split)', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			name: 'Noah',
		};
		transformer.postTransform(user);

		// Single word: firstName/lastName not set, name deleted
		expect(user.firstName).toBeUndefined();
		expect(user.lastName).toBeUndefined();
		expect(user.name).toBeUndefined();
	});

	test('handles missing name gracefully', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			name: null,
		};
		transformer.postTransform(user);

		expect(user.firstName).toBeUndefined();
		expect(user.lastName).toBeUndefined();
	});

	test('maps banned field when true', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			banned: true,
		};
		transformer.postTransform(user);

		expect(user.banned).toBe(true);
	});

	test('removes banned field when false', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			banned: false,
		};
		transformer.postTransform(user);

		expect(user.banned).toBeUndefined();
	});

	test('cleans up intermediate plugin fields', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			display_username: 'TestUser',
			role: 'admin',
			ban_reason: 'Spam',
			ban_expires: '2026-12-31',
			two_factor_enabled: true,
			emailVerified: true,
			phoneVerified: false,
		};
		transformer.postTransform(user);

		expect(user.display_username).toBeUndefined();
		expect(user.role).toBeUndefined();
		expect(user.ban_reason).toBeUndefined();
		expect(user.ban_expires).toBeUndefined();
		expect(user.two_factor_enabled).toBeUndefined();
		expect(user.emailVerified).toBeUndefined();
		expect(user.phoneVerified).toBeUndefined();
	});

	test('full transform with all fields', async () => {
		const transformer = await getTransformer();
		const user: Record<string, unknown> = {
			email: 'test@example.com',
			emailVerified: true,
			name: 'Jane Smith',
			phone: '+1234567890',
			phoneVerified: true,
			banned: true,
			display_username: 'JaneS',
			role: 'user',
			ban_reason: null,
			ban_expires: null,
			two_factor_enabled: false,
		};
		transformer.postTransform(user);

		expect(user.email).toBe('test@example.com');
		expect(user.firstName).toBe('Jane');
		expect(user.lastName).toBe('Smith');
		expect(user.phone).toBe('+1234567890');
		expect(user.banned).toBe(true);

		// All intermediate fields cleaned up
		expect(user.emailVerified).toBeUndefined();
		expect(user.phoneVerified).toBeUndefined();
		expect(user.name).toBeUndefined();
		expect(user.display_username).toBeUndefined();
		expect(user.role).toBeUndefined();
		expect(user.ban_reason).toBeUndefined();
		expect(user.ban_expires).toBeUndefined();
		expect(user.two_factor_enabled).toBeUndefined();
	});
});
