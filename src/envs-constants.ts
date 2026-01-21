import { z } from "zod";
import { config } from "dotenv";
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
export const detectInstanceType = (secretKey: string): "dev" | "prod" => {
  return secretKey.split("_")[1] === "live" ? "prod" : "dev";
};

// Determine if this is a production or dev instance
const isProduction = process.env.CLERK_SECRET_KEY
  ? detectInstanceType(process.env.CLERK_SECRET_KEY) === "prod"
  : false;

/**
 * Gets the default delay between API requests based on instance type
 *
 * Rate limits:
 * - Production: 1000 requests per 10 seconds = 10ms delay
 * - Dev: 100 requests per 10 seconds = 100ms delay
 *
 * @param instanceType - The type of Clerk instance
 * @returns The delay in milliseconds
 */
export const getDefaultDelay = (instanceType: "dev" | "prod"): number => {
  return instanceType === "prod" ? 100 : 10;
};

/**
 * Gets the default retry delay when rate limited based on instance type
 *
 * @param instanceType - The type of Clerk instance
 * @returns The retry delay in milliseconds (100ms for prod, 1000ms for dev)
 */
export const getDefaultRetryDelay = (instanceType: "dev" | "prod"): number => {
  return instanceType === "prod" ? 100 : 1000;
};

const instanceType = isProduction ? "prod" : "dev";
const defaultDelay = getDefaultDelay(instanceType);
const defaultRetryDelay = getDefaultRetryDelay(instanceType);

/**
 * Creates a Zod schema for environment variable validation
 *
 * @param defaultDelayValue - Default delay between requests in milliseconds
 * @param defaultRetryDelayValue - Default retry delay in milliseconds
 * @returns A Zod object schema for environment variables
 */
export const createEnvSchema = (defaultDelayValue: number, defaultRetryDelayValue: number) => {
  return z.object({
    CLERK_SECRET_KEY: z.string(),
    DELAY: z.coerce.number().optional().default(defaultDelayValue),
    RETRY_DELAY_MS: z.coerce.number().optional().default(defaultRetryDelayValue),
    OFFSET: z.coerce.number().optional().default(0),
  });
};

const envSchema = createEnvSchema(defaultDelay, defaultRetryDelay);

/**
 * Type representing the validated environment configuration
 */
export type EnvSchema = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

/**
 * Validated environment configuration with defaults applied
 *
 * @property CLERK_SECRET_KEY - Your Clerk secret key
 * @property DELAY - Delay between API requests (auto-configured based on instance type)
 * @property RETRY_DELAY_MS - Delay before retrying failed requests
 * @property OFFSET - Starting offset for processing users (for resuming migrations)
 */
export const env = parsed.data;
