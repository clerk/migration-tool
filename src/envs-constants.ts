import { TypeOf, z } from "zod";
import { config } from "dotenv";
config();

// TODO: Revisit if we need this. Left to easily implement
export const withDevDefault = <T extends z.ZodTypeAny>(
  schema: T,
  val: NonNullable<TypeOf<T>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => (process.env["NODE_ENV"] !== "production" ? schema.default(val as any) : schema);

// Determine if this is a production or dev instance
const isProduction = process.env.CLERK_SECRET_KEY?.split("_")[1] === "live";

// Set default rate limits based on instance type
// Production: 1000 requests per 10 seconds = 10ms delay
// Dev: 100 requests per 10 seconds = 100ms delay
const defaultDelay = isProduction ? 10 : 100;

const envSchema = z.object({
  CLERK_SECRET_KEY: z.string(),
  DELAY: z.coerce.number().optional().default(defaultDelay),
  RETRY_DELAY_MS: z.coerce.number().optional().default(10000),
  OFFSET: z.coerce.number().optional().default(0),
  IMPORT_TO_DEV: z.coerce.boolean().optional().default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    JSON.stringify(parsed.error.format(), null, 4),
  );
  process.exit(1);
}

export const env = parsed.data;
