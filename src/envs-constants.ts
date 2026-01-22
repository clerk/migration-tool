import { z } from 'zod';
import { config } from 'dotenv';
config();

/**
 * Detects whether a Clerk instance is production or development based on the secret key
 *
 * @param secretKey - The Clerk secret key (format: sk_{type}_{random})
 * @returns "prod" if the key contains "live", otherwise "dev"
 * @example
 * detectInstanceType("sk_live_xxx") // "prod"
 * detectInstanceType("sk_test_xxx") // "dev"
 */
export const detectInstanceType = (secretKey: string): 'dev' | 'prod' => {
	return secretKey.split('_')[1] === 'live' ? 'prod' : 'dev';
};

/**
 * Gets the default rate limit based on instance type
 *
 * Rate limits (Clerk's documented limits):
 * - Production: 1000 requests per 10 seconds = 100 requests/second
 * - Dev: 100 requests per 10 seconds = 10 requests/second
 *
 * @param instanceType - The type of Clerk instance
 * @returns The rate limit in requests per second
 */
export const getDefaultRateLimit = (instanceType: 'dev' | 'prod'): number => {
	return instanceType === 'prod' ? 100 : 10;
};

/**
 * Calculates the concurrency limit based on rate limit
 *
 * Uses an aggressive approach with only 50ms leeway:
 * - Allows concurrent requests up to 95% of rate limit
 * - This maximizes throughput while leaving minimal buffer (50ms worth of requests)
 * - Example: 100 req/s → 95 concurrent, 10 req/s → 9 concurrent
 *
 * @param rateLimit - The rate limit in requests per second
 * @returns The concurrency limit (number of concurrent requests allowed)
 */
export const getConcurrencyLimit = (rateLimit: number): number => {
	return Math.max(1, Math.floor(rateLimit * 0.95));
};

/**
 * Creates a Zod schema for environment variable validation with dynamic defaults
 * based on the actual CLERK_SECRET_KEY value
 *
 * @returns A Zod object schema for environment variables
 */
export const createEnvSchema = () => {
	return z
		.object({
			CLERK_SECRET_KEY: z.string(),
			RATE_LIMIT: z.coerce.number().positive().optional(),
		})
		.transform((data) => {
			// Dynamically determine instance type from the actual secret key
			const instanceType = detectInstanceType(data.CLERK_SECRET_KEY);

			const rateLimit = data.RATE_LIMIT ?? getDefaultRateLimit(instanceType);

			return {
				CLERK_SECRET_KEY: data.CLERK_SECRET_KEY,
				RATE_LIMIT: rateLimit,
				CONCURRENCY_LIMIT: getConcurrencyLimit(rateLimit),
			};
		});
};

const envSchema = createEnvSchema();

/**
 * Type representing the validated environment configuration
 */
export type EnvSchema = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	// Infrastructure error at module load time - occurs before CLI is initialized
	// eslint-disable-next-line no-console
	console.error('❌ Invalid environment variables:');
	// eslint-disable-next-line no-console
	console.error(JSON.stringify(parsed.error.issues, null, 2));
	process.exit(1);
}

/**
 * Validated environment configuration with defaults applied
 *
 * @property CLERK_SECRET_KEY - Your Clerk secret key
 * @property RATE_LIMIT - Rate limit in requests per second (auto-configured based on instance type)
 * @property CONCURRENCY_LIMIT - Maximum number of concurrent requests (calculated from rate limit)
 */
export const env = parsed.data;
