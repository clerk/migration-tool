import { describe, expect, test } from 'vitest';
import {
	detectInstanceType,
	getDefaultRateLimit,
	getConcurrencyLimit,
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

	describe('getDefaultRateLimit', () => {
		test('returns 100 requests/second for production', () => {
			expect(getDefaultRateLimit('prod')).toBe(100);
		});

		test('returns 10 requests/second for dev', () => {
			expect(getDefaultRateLimit('dev')).toBe(10);
		});
	});

	describe('getConcurrencyLimit', () => {
		test('returns 95% of rate limit for production (50ms leeway)', () => {
			expect(getConcurrencyLimit(100)).toBe(95); // 100 * 0.95
		});

		test('returns 95% of rate limit for dev (50ms leeway)', () => {
			expect(getConcurrencyLimit(10)).toBe(9); // 10 * 0.95 = 9.5, floored to 9
		});

		test('returns at least 1 for very low rate limits', () => {
			expect(getConcurrencyLimit(1)).toBe(1);
			expect(getConcurrencyLimit(2)).toBe(1);
		});

		test('rounds down for odd rate limits', () => {
			expect(getConcurrencyLimit(15)).toBe(14); // 15 * 0.95 = 14.25, floored to 14
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
				expect(result.data.RATE_LIMIT).toBe(100); // Production default
				expect(result.data.CONCURRENCY_LIMIT).toBe(95); // 95% of rate limit
			}
		});

		test('automatically uses dev defaults for test keys', () => {
			const schema = createEnvSchema();
			const result = schema.safeParse({
				CLERK_SECRET_KEY: 'sk_test_abcdefghijklmnopqrstuvwxyz123456',
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.RATE_LIMIT).toBe(10); // Dev default
				expect(result.data.CONCURRENCY_LIMIT).toBe(9); // 95% of rate limit
			}
		});

		test('allows custom rate limit to override defaults', () => {
			const schema = createEnvSchema();
			const result = schema.safeParse({
				CLERK_SECRET_KEY: 'sk_live_abcdefghijklmnopqrstuvwxyz123456',
				RATE_LIMIT: '50',
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.RATE_LIMIT).toBe(50);
				expect(result.data.CONCURRENCY_LIMIT).toBe(47); // 95% of custom rate limit
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
			expect(typeof envModule.env.RATE_LIMIT).toBe('number');
			expect(typeof envModule.env.CONCURRENCY_LIMIT).toBe('number');
		});
	});

	describe('integration: instance type determines defaults', () => {
		test('production instance uses production defaults', () => {
			const secretKey = 'sk_live_abcdefghijklmnopqrstuvwxyz123456';
			const instanceType = detectInstanceType(secretKey);
			const rateLimit = getDefaultRateLimit(instanceType);
			const concurrency = getConcurrencyLimit(rateLimit);

			expect(instanceType).toBe('prod');
			expect(rateLimit).toBe(100);
			expect(concurrency).toBe(95);

			const schema = createEnvSchema();
			const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.RATE_LIMIT).toBe(100);
				expect(result.data.CONCURRENCY_LIMIT).toBe(95);
			}
		});

		test('dev instance uses dev defaults', () => {
			const secretKey = 'sk_test_abcdefghijklmnopqrstuvwxyz123456';
			const instanceType = detectInstanceType(secretKey);
			const rateLimit = getDefaultRateLimit(instanceType);
			const concurrency = getConcurrencyLimit(rateLimit);

			expect(instanceType).toBe('dev');
			expect(rateLimit).toBe(10);
			expect(concurrency).toBe(9);

			const schema = createEnvSchema();
			const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.RATE_LIMIT).toBe(10);
				expect(result.data.CONCURRENCY_LIMIT).toBe(9);
			}
		});
	});
});
