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
 * Calculates the default concurrency limit based on rate limit
 *
 * Uses 95% of the rate limit assuming ~100ms average API latency:
 * - Production: 100 req/s → 10 concurrent = ~95-100 req/s throughput
 * - Dev: 10 req/s → 1 concurrent = ~9-10 req/s throughput
 *
 * Formula: CONCURRENCY = RATE_LIMIT * 0.095
 * - This assumes 100ms average API response time
 * - With X concurrent requests at 100ms each: throughput = X * 10 req/s
 * - To get 95 req/s: need 9.5 concurrent
 *
 * Users can override this via CONCURRENCY_LIMIT in .env to tune performance
 * based on their actual API latency and desired throughput.
 *
 * @param rateLimit - The rate limit in requests per second
 * @returns The concurrency limit (number of concurrent requests)
 */
export const getDefaultConcurrencyLimit = (rateLimit: number): number => {
	// 95% of rate limit with 100ms latency assumption
	return Math.max(1, Math.floor(rateLimit * 0.095));
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
			CONCURRENCY_LIMIT: z.coerce.number().positive().optional(),
		})
		.transform((data) => {
			// Dynamically determine instance type from the actual secret key
			const instanceType = detectInstanceType(data.CLERK_SECRET_KEY);

			const rateLimit = data.RATE_LIMIT ?? getDefaultRateLimit(instanceType);
			const concurrencyLimit =
				data.CONCURRENCY_LIMIT ?? getDefaultConcurrencyLimit(rateLimit);

			return {
				CLERK_SECRET_KEY: data.CLERK_SECRET_KEY,
				RATE_LIMIT: rateLimit,
				CONCURRENCY_LIMIT: concurrencyLimit,
			};
		});
};

const envSchema = createEnvSchema();

/**
 * Type representing the validated environment configuration
 */
export type EnvSchema = z.infer<typeof envSchema>;

// Lazy validation - don't exit immediately, allow CLI to handle missing key
let _env: EnvSchema | null = null;
let _validationError: z.ZodError | null = null;

/**
 * Attempts to validate environment variables
 * @returns true if valid, false if invalid
 */
function tryValidateEnv(): boolean {
	const parsed = envSchema.safeParse(process.env);
	if (parsed.success) {
		_env = parsed.data;
		_validationError = null;
		return true;
	}
	_validationError = parsed.error;
	return false;
}

// Initial validation attempt
tryValidateEnv();

/**
 * Checks if CLERK_SECRET_KEY is set in the environment
 * @returns true if the key is set (even if not validated yet)
 */
export function hasClerkSecretKey(): boolean {
	return !!process.env.CLERK_SECRET_KEY;
}

/**
 * Sets the CLERK_SECRET_KEY in process.env and re-validates
 * @param key - The Clerk secret key to set
 * @returns true if validation succeeds after setting the key
 */
export function setClerkSecretKey(key: string): boolean {
	process.env.CLERK_SECRET_KEY = key;
	return tryValidateEnv();
}

/**
 * Gets the validation error if env validation failed
 * @returns The Zod error or null if validation succeeded
 */
export function getEnvValidationError(): z.ZodError | null {
	return _validationError;
}

/**
 * Validates environment and exits if invalid
 * Call this after giving the user a chance to provide missing values
 */
export function requireValidEnv(): void {
	if (!_env) {
		// eslint-disable-next-line no-console
		console.error('❌ Invalid environment variables:');
		if (_validationError) {
			// eslint-disable-next-line no-console
			console.error(JSON.stringify(_validationError.issues, null, 2));
		}
		process.exit(1);
	}
}

/**
 * Validated environment configuration with defaults applied
 *
 * @property CLERK_SECRET_KEY - Your Clerk secret key
 * @property RATE_LIMIT - Rate limit in requests per second (auto-configured based on instance type)
 * @property CONCURRENCY_LIMIT - Number of concurrent requests (defaults to ~95% of rate limit, can be overridden in .env)
 */
export const env: EnvSchema = new Proxy({} as EnvSchema, {
	get(_, prop: keyof EnvSchema) {
		if (!_env) {
			requireValidEnv();
		}
		// _env is guaranteed to be defined here since requireValidEnv exits if null
		return (_env as EnvSchema)[prop];
	},
});

/**
 * Maximum number of retries for rate limit (429) errors
 */
export const MAX_RETRIES = 5;

/**
 * Default delay in milliseconds when retrying after a 429 error (10 seconds)
 * Used as a fallback when the response doesn't include a Retry-After header
 */
export const RETRY_DELAY_MS = 10000;
