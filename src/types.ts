import type { ClerkAPIError } from '@clerk/types';
import type { transformers } from './transformers';
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
 * @property code - HTTP status code or error code if import failed
 */
export type ImportLogEntry = {
	userId: string;
	status: 'success' | 'error';
	clerkUserId?: string;
	error?: string;
	code?: string;
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
 * Log entry for a user export attempt
 *
 * @property userId - The user ID that was exported
 * @property status - Whether the export succeeded or failed
 * @property error - Error message if export failed
 */
export type ExportLogEntry = {
	userId: string;
	status: 'success' | 'error';
	error?: string;
};

/**
 * Log entry for a user deletion attempt
 *
 * @property userId - The user ID
 * @property status - Whether the deletion succeeded or failed
 * @property error - Error message if deletion failed
 * @property code - HTTP status code or error code if deletion failed
 */
export type DeleteLogEntry = {
	userId: string;
	status: 'success' | 'error';
	error?: string;
	code?: string;
};

/**
 * Zod enum of supported password hashing algorithms
 */
export const passwordHasherEnum = z.enum(
	PASSWORD_HASHERS as unknown as [string, ...string[]]
);

/**
 * Result of a preTransform operation
 *
 * @property filePath - The file path to use (may be modified, e.g., temp file with headers)
 * @property data - Pre-extracted user data (e.g., extracted from JSON wrapper)
 */
export type PreTransformResult = {
	filePath: string;
	data?: User[];
};

/**
 * Firebase scrypt hash configuration
 *
 * These values are required to verify Firebase passwords in Clerk.
 * You can find them in Firebase Console:
 * Authentication → Users → (⋮ menu) → Password hash parameters
 *
 * They can be set directly in the transformer, or via the CLI
 * which will save them to the .settings file.
 */
export type FirebaseHashConfig = {
	base64_signer_key: string | undefined;
	base64_salt_separator: string | undefined;
	rounds: number | undefined;
	mem_cost: number | undefined;
};

/**
 * CLI settings persisted to .settings file
 *
 * @property key - Transformer key for the source platform
 * @property file - Path to the user data file
 * @property firebaseHashConfig - Firebase hash parameters (if using Firebase transformer)
 */
export type Settings = {
	key?: string;
	file?: string;
	firebaseHashConfig?: FirebaseHashConfig;
	skipUnsupportedProviders?: boolean;
};

/**
 * Counts of users with each identifier type
 */
export type IdentifierCounts = {
	verifiedEmails: number;
	unverifiedEmails: number;
	verifiedPhones: number;
	unverifiedPhones: number;
	username: number;
	hasAnyIdentifier: number;
};

/**
 * Analysis of user data fields for CLI display
 *
 * @property presentOnAll - Fields present on all users
 * @property presentOnSome - Fields present on some but not all users
 * @property identifiers - Counts of identifier types
 * @property totalUsers - Total number of users analyzed
 * @property fieldCounts - Count of users with each field
 */
export type FieldAnalysis = {
	presentOnAll: string[];
	presentOnSome: string[];
	identifiers: IdentifierCounts;
	totalUsers: number;
	fieldCounts: Record<string, number>;
};

/**
 * Settings result from reading .settings file for deletion
 *
 * @property file - Path to the migration file
 * @property key - Transformer key (optional)
 */
export type SettingsResult = {
	file: string;
	key?: string;
};

/**
 * Common fields returned by all export functions
 *
 * @property userCount - Number of users exported
 * @property outputPath - Absolute path to the output file
 * @property fieldCoverage - Map of field names to counts of users with that field
 */
export type BaseExportResult = {
	userCount: number;
	outputPath: string;
	fieldCoverage: Record<string, number>;
};

/**
 * Registry entry for the export dispatcher
 *
 * @property key - Unique key used for CLI --platform flag
 * @property label - Display name shown in the interactive picker
 * @property description - Short description shown below the label
 * @property run - Function that executes the export
 */
export type ExportRegistryEntry = {
	key: string;
	label: string;
	description: string;
	run: () => Promise<void>;
};
