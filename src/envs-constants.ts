import { z } from "zod";
import { config } from "dotenv";
config();

// Exported for testing
export const detectInstanceType = (secretKey: string): "dev" | "prod" => {
  return secretKey.split("_")[1] === "live" ? "prod" : "dev";
};

// Determine if this is a production or dev instance
const isProduction = process.env.CLERK_SECRET_KEY
  ? detectInstanceType(process.env.CLERK_SECRET_KEY) === "prod"
  : false;

// Set default rate limits based on instance type
// Production: 1000 requests per 10 seconds = 10ms delay
// Dev: 100 requests per 10 seconds = 100ms delay
export const getDefaultDelay = (instanceType: "dev" | "prod"): number => {
  return instanceType === "prod" ? 100 : 10;
};

// Set default retry delay based on instance type
// Production: 100ms retry delay
// Dev: 1000ms retry delay
export const getDefaultRetryDelay = (instanceType: "dev" | "prod"): number => {
  return instanceType === "prod" ? 100 : 1000;
};

const instanceType = isProduction ? "prod" : "dev";
const defaultDelay = getDefaultDelay(instanceType);
const defaultRetryDelay = getDefaultRetryDelay(instanceType);

// Exported for testing
export const createEnvSchema = (defaultDelayValue: number, defaultRetryDelayValue: number) => {
  return z.object({
    CLERK_SECRET_KEY: z.string(),
    DELAY: z.coerce.number().optional().default(defaultDelayValue),
    RETRY_DELAY_MS: z.coerce.number().optional().default(defaultRetryDelayValue),
    OFFSET: z.coerce.number().optional().default(0),
  });
};

const envSchema = createEnvSchema(defaultDelay, defaultRetryDelay);

// Exported for testing
export type EnvSchema = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

export const env = parsed.data;
