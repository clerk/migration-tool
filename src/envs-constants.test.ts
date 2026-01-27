import { describe, expect, test } from 'vitest';
import {
	createEnvSchema,
	detectInstanceType,
	getDefaultConcurrencyLimit,
	getDefaultRateLimit,
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

	describe('getDefaultConcurrencyLimit', () => {
		test('returns ~95% of rate limit for production', () => {
			// 100 req/s * 0.095 = 9.5, floored to 9
			expect(getDefaultConcurrencyLimit(100)).toBe(9);
		});

		test('returns ~95% of rate limit for dev', () => {
			// 10 req/s * 0.095 = 0.95, max(1, floor(0.95)) = 1
			expect(getDefaultConcurrencyLimit(10)).toBe(1);
		});

		test('returns at least 1 for very low rate limits', () => {
			expect(getDefaultConcurrencyLimit(1)).toBe(1);
			expect(getDefaultConcurrencyLimit(2)).toBe(1);
		});

		test('rounds down for fractional concurrency', () => {
			// 50 req/s * 0.095 = 4.75, floored to 4
			expect(getDefaultConcurrencyLimit(50)).toBe(4);
			// 75 req/s * 0.095 = 7.125, floored to 7
			expect(getDefaultConcurrencyLimit(75)).toBe(7);
			// 150 req/s * 0.095 = 14.25, floored to 14
			expect(getDefaultConcurrencyLimit(150)).toBe(14);
		});
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
			expect(result.data.CONCURRENCY_LIMIT).toBe(9); // 100 * 0.095 = 9.5, floored to 9
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
			expect(result.data.CONCURRENCY_LIMIT).toBe(1); // 10 * 0.095 = 0.95, max(1, floor(0.95)) = 1
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
			// 50 * 0.095 = 4.75, floored to 4
			expect(result.data.CONCURRENCY_LIMIT).toBe(4);
		}
	});

	test('allows custom concurrency limit to override defaults', () => {
		const schema = createEnvSchema();
		const result = schema.safeParse({
			CLERK_SECRET_KEY: 'sk_live_abcdefghijklmnopqrstuvwxyz123456',
			CONCURRENCY_LIMIT: '15',
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.RATE_LIMIT).toBe(100); // Production default
			expect(result.data.CONCURRENCY_LIMIT).toBe(15); // Custom override
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
		const concurrencyLimit = getDefaultConcurrencyLimit(rateLimit);

		expect(instanceType).toBe('prod');
		expect(rateLimit).toBe(100);
		expect(concurrencyLimit).toBe(9); // 100 * 0.095 = 9.5, floored to 9

		const schema = createEnvSchema();
		const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.RATE_LIMIT).toBe(100);
			expect(result.data.CONCURRENCY_LIMIT).toBe(9);
		}
	});

	test('dev instance uses dev defaults', () => {
		const secretKey = 'sk_test_abcdefghijklmnopqrstuvwxyz123456';
		const instanceType = detectInstanceType(secretKey);
		const rateLimit = getDefaultRateLimit(instanceType);
		const concurrencyLimit = getDefaultConcurrencyLimit(rateLimit);

		expect(instanceType).toBe('dev');
		expect(rateLimit).toBe(10);
		expect(concurrencyLimit).toBe(1); // 10 * 0.095 = 0.95, max(1, floor(0.95)) = 1

		const schema = createEnvSchema();
		const result = schema.safeParse({ CLERK_SECRET_KEY: secretKey });

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.RATE_LIMIT).toBe(10);
			expect(result.data.CONCURRENCY_LIMIT).toBe(1);
		}
	});
});
