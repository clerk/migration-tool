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
	return path.join(__dirname, '..', file);
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
