import path from 'path';
import mime from 'mime-types';
import fs from 'fs';

/**
 * Gets the current date and time in ISO format without milliseconds
 * @returns A string in the format YYYY-MM-DDTHH:mm:ss
 * @example
 * getDateTimeStamp() // "2026-01-20T14:30:45"
 */
export const getDateTimeStamp = () => {
	return new Date().toISOString().split('.')[0]; // YYYY-MM-DDTHH:mm:ss
};

/**
 * Creates an absolute file path for import files relative to the project root
 * @param file - The relative file path (e.g., "samples/users.json")
 * @returns The absolute file path
 */
export const createImportFilePath = (file: string) => {
	return path.join(__dirname, '..', '..', file);
};

/**
 * Checks if a file exists at the specified path
 * @param file - The relative file path to check
 * @returns True if the file exists, false otherwise
 */
export const checkIfFileExists = (file: string) => {
	if (fs.existsSync(createImportFilePath(file))) {
		return true;
	}
	return false;
};

/**
 * Determines the MIME type of a file
 * @param file - The relative file path
 * @returns The MIME type of the file (e.g., "application/json", "text/csv") or false if unknown
 */
export const getFileType = (file: string) => {
	return mime.lookup(createImportFilePath(file));
};

/**
 * Wraps a promise to return a tuple of [data, error] instead of throwing
 * @template T - The type of the resolved promise value
 * @param promise - The promise to wrap
 * @returns A tuple containing either [data, null] on success or [null, error] on failure
 * @throws Re-throws if the error is not an instance of Error
 * @example
 * const [data, error] = await tryCatch(fetchUsers());
 * if (error) console.error(error);
 */
export const tryCatch = async <T>(
	promise: Promise<T>
): Promise<[T, null] | [null, Error]> => {
	try {
		const data = await promise;
		return [data, null];
	} catch (throwable) {
		if (throwable instanceof Error) return [null, throwable];

		throw throwable;
	}
};

/**
 * Selectively flattens nested objects based on transformer configuration
 *
 * Only flattens paths that are explicitly referenced in the transformer config.
 * This allows transformers to map nested fields (e.g., "_id.$oid" in Auth0) to
 * flat fields in the target schema.
 *
 * @param obj - The object to flatten
 * @param transformer - The transformer config mapping source paths to target fields
 * @param prefix - Internal parameter for recursive flattening (current path prefix)
 * @returns Flattened object with dot-notation keys for nested paths
 *
 * @example
 * const obj = { _id: { $oid: "123" }, email: "test@example.com" }
 * const transformer = { "_id.$oid": "userId", "email": "email" }
 * flattenObjectSelectively(obj, transformer)
 * // Returns: { "_id.$oid": "123", "email": "test@example.com" }
 */
export function flattenObjectSelectively(
	obj: Record<string, unknown>,
	transformer: Record<string, string>,
	prefix = ''
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(obj)) {
		const currentPath = prefix ? `${prefix}.${key}` : key;

		// Check if this path (or any nested path) is in the transformer
		const hasNestedMapping = Object.keys(transformer).some((k) =>
			k.startsWith(`${currentPath}.`)
		);

		if (
			hasNestedMapping &&
			value &&
			typeof value === 'object' &&
			!Array.isArray(value)
		) {
			// This object has nested mappings, so recursively flatten it
			Object.assign(
				result,
				flattenObjectSelectively(
					value as Record<string, unknown>,
					transformer,
					currentPath
				)
			);
		} else {
			// Either it's not an object, or it's not mapped with nested paths - keep as-is
			result[currentPath] = value;
		}
	}

	return result;
}

/**
 * Transforms data keys from source format to Clerk's import schema
 *
 * Maps field names from the source platform (Auth0, Supabase, etc.) to
 * Clerk's expected field names using the transformer's configuration.
 * Flattens nested objects as needed and filters out empty values.
 *
 * @template T - The transformer type being used for transformation
 * @param data - The raw user data from the source platform
 * @param transformerConfig - The transformer configuration with field mapping
 * @returns Transformed user object with Clerk field names
 *
 * @example
 * const auth0User = { "_id": { "$oid": "123" }, "email": "test@example.com" }
 * const transformer = transformers.find(h => h.key === "auth0")
 * transformKeys(auth0User, transformer)
 * // Returns: { userId: "123", email: "test@example.com" }
 */
export function transformKeys<
	T extends { transformer: Record<string, string> },
>(
	data: Record<string, unknown>,
	transformerConfig: T
): Record<string, unknown> {
	const transformedData: Record<string, unknown> = {};
	const transformer = transformerConfig.transformer;

	// Selectively flatten the input data based on transformer config
	const flatData = flattenObjectSelectively(data, transformer);

	// Then apply transformations
	for (const [key, value] of Object.entries(flatData)) {
		if (value !== '' && value !== '"{}"' && value !== null) {
			const transformedKey = transformer[key] || key;
			transformedData[transformedKey] = value;
		}
	}

	return transformedData;
}

/**
 * Calculates the delay in milliseconds for rate limit retries
 *
 * Uses the Retry-After value from the API response if provided,
 * otherwise falls back to the default delay.
 *
 * @param retryAfterSeconds - Optional Retry-After value from response header
 * @param defaultDelayMs - Default delay in milliseconds (typically 10000ms)
 * @returns Object containing delayMs (milliseconds) and delaySeconds (for logging)
 *
 * @example
 * const { delayMs, delaySeconds } = getRetryDelay(undefined, 10000);
 * // Returns: { delayMs: 10000, delaySeconds: 10 }
 *
 * @example
 * const { delayMs, delaySeconds } = getRetryDelay(15, 10000);
 * // Returns: { delayMs: 15000, delaySeconds: 15 }
 */
export function getRetryDelay(
	retryAfterSeconds: number | undefined,
	defaultDelayMs: number
): { delayMs: number; delaySeconds: number } {
	// Use retryAfter from response or default delay for all retries
	const delayMs = retryAfterSeconds ? retryAfterSeconds * 1000 : defaultDelayMs;
	const delaySeconds = retryAfterSeconds || defaultDelayMs / 1000;
	return { delayMs, delaySeconds };
}

/**
 * Checks if a string is a valid Postgres connection string.
 *
 * Verifies the value starts with postgresql:// or postgres:// and is
 * parseable as a URL. Passwords with special characters (like @, #, %)
 * must be URL-encoded for the string to be valid.
 *
 * @param value - The string to check
 * @returns true if the value is a parseable Postgres URL
 */
export const isValidConnectionString = (value: string): boolean => {
	if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
		return false;
	}
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
};

/**
 * Resolves the database connection string from CLI args and environment variables.
 *
 * Priority: --db-url flag > SUPABASE_DB_URL env var > interactive prompt
 *
 * Returns the resolved URL and an optional warning if an env var was present
 * but had an invalid format.
 *
 * @param cliArgs - Raw CLI arguments (process.argv.slice(2))
 * @param env - Environment variables to check
 * @returns Object with resolved dbUrl (undefined if not found) and optional warning
 */
export function resolveConnectionString(
	cliArgs: string[],
	env: Record<string, string | undefined>
): {
	dbUrl: string | undefined;
	outputFile: string;
	warning: string | undefined;
} {
	let dbUrl: string | undefined;
	let outputFile = 'supabase-export.json';
	let warning: string | undefined;

	// Parse CLI flags
	for (let i = 0; i < cliArgs.length; i++) {
		if (cliArgs[i] === '--db-url' && cliArgs[i + 1]) {
			dbUrl = cliArgs[i + 1];
			i++;
		} else if (cliArgs[i] === '--output' && cliArgs[i + 1]) {
			outputFile = cliArgs[i + 1];
			i++;
		}
	}

	// Fall back to env vars if no --db-url flag, validating format
	if (!dbUrl) {
		const envUrl = env.SUPABASE_DB_URL;
		if (envUrl && isValidConnectionString(envUrl)) {
			dbUrl = envUrl;
		} else if (envUrl) {
			warning =
				'Connection string from environment is not a valid Postgres URL — prompting instead.';
		}
	}

	return { dbUrl, outputFile, warning };
}

/**
 * Normalizes error messages by sorting field arrays to group similar errors
 *
 * Example: Converts both:
 * - ["first_name" "last_name"] data doesn't match...
 * - ["last_name" "first_name"] data doesn't match...
 * into: ["first_name" "last_name"] data doesn't match...
 *
 * @param errorMessage - The original error message
 * @returns The normalized error message with sorted field arrays
 */
export function normalizeErrorMessage(errorMessage: string): string {
	// Match array-like patterns in error messages: ["field1" "field2"]
	const arrayPattern = /\[([^\]]+)\]/g;

	return errorMessage.replace(arrayPattern, (_match, fields: string) => {
		// Split by spaces and quotes, filter out empty strings
		const fieldNames = fields
			.split(/["'\s]+/)
			.filter((f: string) => f.trim().length > 0);

		// Sort field names alphabetically
		fieldNames.sort();

		// Reconstruct the array notation
		return `[${fieldNames.map((f: string) => `"${f}"`).join(' ')}]`;
	});
}
