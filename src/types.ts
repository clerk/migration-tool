import type { ClerkAPIError } from '@clerk/types';
import type { transformers } from './migrate/transformers';
import type { userSchema } from './migrate/validator';
import * as z from 'zod';

/**
 * List of supported password hashing algorithms in Clerk
 *
 * When migrating users with existing passwords, specify which algorithm
 * was used to hash the passwords so Clerk can validate them correctly.
 */
export const PASSWORD_HASHERS = [
	'argon2i',
	'argon2id',
	'awscognito',
	'bcrypt',
	'bcrypt_peppered',
	'bcrypt_sha256_django',
	'hmac_sha256_utf16_b64',
	'md5',
	'md5_salted',
	'pbkdf2_sha1',
	'pbkdf2_sha256',
	'pbkdf2_sha256_django',
	'pbkdf2_sha512',
	'scrypt_firebase',
	'scrypt_werkzeug',
	'sha256',
	'sha256_salted',
	'md5_phpass',
	'ldap_ssha',
	'sha512_symfony',
] as const;

/**
 * User object validated against the user schema
 */
export type User = z.infer<typeof userSchema>;

/**
 * Union type of all transformer keys (e.g., "clerk" | "auth0" | "supabase" | "authjs")
 */
export type TransformerMapKeys = (typeof transformers)[number]['key'];

/**
 * Union type of all transformer configuration objects
 */
export type TransformerMapUnion = (typeof transformers)[number];

/**
 * Error information from a failed user creation attempt
 *
 * @property userId - The user ID that failed to import
 * @property status - HTTP status or error status
 * @property errors - Array of Clerk API error objects
 */
export type ErrorPayload = {
	userId: string;
	status: string;
	errors: ClerkAPIError[];
};

/**
 * Validation error information for a user that failed schema validation
 *
 * @property error - Description of the validation error
 * @property path - Path to the field that failed validation
 * @property userId - User ID of the invalid user
 * @property row - Row number in the source file (0-indexed)
 */
export type ValidationErrorPayload = {
	error: string;
	path: (string | number)[];
	userId: string;
	row: number;
};

/**
 * Formatted error log entry for file storage
 *
 * @property type - Type of error (e.g., "User Creation Error", "Validation Error")
 * @property userId - The user ID associated with the error
 * @property status - HTTP status or error status
 * @property error - Error message
 */
export type ErrorLog = {
	type: string;
	userId: string;
	status: string;
	error: string | undefined;
};

/**
 * Log entry for a user import attempt
 *
 * @property userId - The user ID from the source file
 * @property status - Whether the import succeeded or failed
 * @property clerkUserId - The Clerk user ID if import succeeded
 * @property error - Error message if import failed
 */
export type ImportLogEntry = {
	userId: string;
	status: 'success' | 'error';
	clerkUserId?: string;
	error?: string;
};

/**
 * Summary statistics for a user import operation
 *
 * @property totalProcessed - Total number of users processed
 * @property successful - Number of successful imports
 * @property failed - Number of failed imports
 * @property errorBreakdown - Map of error messages to occurrence counts
 */
export type ImportSummary = {
	totalProcessed: number;
	successful: number;
	failed: number;
	validationFailed: number;
	errorBreakdown: Map<string, number>;
};

/**
 * Log entry for a user deletion attempt
 *
 * @property userId - The user ID
 * @property status - Whether the deletion succeeded or failed
 * @property error - Error message if deletion failed
 */
export type DeleteLogEntry = {
	userId: string;
	status: 'success' | 'error';
	error?: string;
};

/**
 * Zod enum of supported password hashing algorithms
 */
export const passwordHasherEnum = z.enum(
	PASSWORD_HASHERS as unknown as [string, ...string[]]
);
