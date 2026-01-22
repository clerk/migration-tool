import { describe, expect, test } from 'vitest';
import {
	detectInstanceType,
	getDefaultDelay,
	getDefaultRetryDelay,
	createEnvSchema,
} from './envs-constants';

describe('envs-constants', () => {
	describe('detectInstanceType', () => {
		test("returns 'prod' for sk_live_ prefix", () => {
			expect(
				detectInstanceType('sk_live_abcdefghijklmnopqrstuvwxyz123456')
			).toBe('prod');
		});

		test("returns 'dev' for sk_test_ prefix", () => {
			expect(
				detectInstanceType('sk_test_abcdefghijklmnopqrstuvwxyz123456')
			).toBe('dev');
		});

		test("returns 'dev' for other prefixes", () => {
			expect(
				detectInstanceType('sk_prod_abcdefghijklmnopqrstuvwxyz123456')
			).toBe('dev');
			expect(detectInstanceType('sk_abcdefghijklmnopqrstuvwxyz123456')).toBe(
				'dev'
			);
		});

		test("returns 'dev' for keys without underscore", () => {
			expect(detectInstanceType('somekey')).toBe('dev');
		});

		test("returns 'dev' for empty string", () => {
			expect(detectInstanceType('')).toBe('dev');
		});
	});

	describe('getDefaultDelay', () => {
		test('returns 10 for production', () => {
			expect(getDefaultDelay('prod')).toBe(10);
		});

		test('returns 100 for dev', () => {
			expect(getDefaultDelay('dev')).toBe(100);
		});
	});

	describe('getDefaultRetryDelay', () => {
		test('returns 100 for production', () => {
			expect(getDefaultRetryDelay('prod')).toBe(100);
		});

		test('returns 1000 for dev', () => {
			expect(getDefaultRetryDelay('dev')).toBe(1000);
		});
	});

	describe('createEnvSchema', () => {
		test('returns a Zod schema object', () => {
			const schema = createEnvSchema();
			expect(schema).toBeDefined();
			expect(typeof schema.safeParse).toBe('function');
			expect(typeof schema.parse).toBe('function');
		});

		test('automatically uses production defaults for production keys', () => {
			const schema = createEnvSchema();
			const result = schema.safeParse({
				CLERK_SECRET_KEY: 'sk_live_abcdefghijklmnopqrstuvwxyz123456',
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.DELAY).toBe(10); // Production default
				expect(result.data.RETRY_DELAY_MS).toBe(100); // Production default
			}
		});

		test('automatically uses dev defaults for test keys', () => {
			const schema = createEnvSchema();
			const result = schema.safeParse({
				CLERK_SECRET_KEY: 'sk_test_abcdefghijklmnopqrstuvwxyz123456',
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.DELAY).toBe(100); // Dev default
				expect(result.data.RETRY_DELAY_MS).toBe(1000); // Dev default
			}
		});

		test('allows custom delay values to override defaults', () => {
			const schema = createEnvSchema();
			const result = schema.safeParse({
				CLERK_SECRET_KEY: 'sk_live_abcdefghijklmnopqrstuvwxyz123456',
				DELAY: '42',
				RETRY_DELAY_MS: '500',
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.DELAY).toBe(42);
				expect(result.data.RETRY_DELAY_MS).toBe(500);
			}
		});
	});

	describe('exported env object', () => {
		test('env object exists', async () => {
			const envModule = await import('./envs-constants');
			expect(envModule.env).toBeDefined();
		});

		test('env object has required fields with correct types', async () => {
			const envModule = await import('./envs-constants');

			expect(typeof envModule.env.CLERK_SECRET_KEY).toBe('string');
			expect(typeof envModule.env.DELAY).toBe('number');
			expect(typeof envModule.env.RETRY_DELAY_MS).toBe('number');
			expect(typeof envModule.env.OFFSET).toBe('number');
		});
	});

	describe('integration: instance type determines defaults', () => {
		test('production instance uses production defaults', () => {
			const secretKey = 'sk_live_abcdefghijklmnopqrstuvwxyz123456';
			const instanceType = detectInstanceType(secretKey);
			const delay = getDefaultDelay(instanceType);
			const retryDelay = getDefaultRetryDelay(instanceType);

			expect(instanceType).toBe('prod');
			expect(delay).toBe(10);
			expect(retryDelay).toBe(100);

			const schema = createEnvSchema();
			const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.DELAY).toBe(10);
				expect(result.data.RETRY_DELAY_MS).toBe(100);
			}
		});

		test('dev instance uses dev defaults', () => {
			const secretKey = 'sk_test_abcdefghijklmnopqrstuvwxyz123456';
			const instanceType = detectInstanceType(secretKey);
			const delay = getDefaultDelay(instanceType);
			const retryDelay = getDefaultRetryDelay(instanceType);

			expect(instanceType).toBe('dev');
			expect(delay).toBe(100);
			expect(retryDelay).toBe(1000);

			const schema = createEnvSchema();
			const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.DELAY).toBe(100);
				expect(result.data.RETRY_DELAY_MS).toBe(1000);
			}
		});
	});
});
