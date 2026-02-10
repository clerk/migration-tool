import fs from 'fs';
import csvParser from 'csv-parser';
import * as p from '@clack/prompts';
import { validationLogger } from '../logger';
import { transformers } from '../transformers';
import { userSchema } from './validator';
import type { TransformerMapKeys, User } from '../types';
import { PASSWORD_HASHERS } from '../types';
import {
	createImportFilePath,
	getDateTimeStamp,
	getFileType,
	transformKeys,
} from '../utils';

// Re-export for backwards compatibility
export type { PreTransformResult } from '../types';

const s = p.spinner();

/**
 * Transforms and validates an array of users for import
 *
 * Processes each user through:
 * 1. Field transformation using the transformer's transformer config
 * 2. Special handling for Clerk-to-Clerk migrations (email/phone array consolidation)
 * 3. Transformer-specific postTransform logic (if defined)
 * 4. Schema validation
 * 5. Validation error logging for failed users
 *
 * Throws immediately if an invalid password hasher is detected.
 * Logs other validation errors and excludes invalid users from the result.
 *
 * @param users - Array of raw user data to transform
 * @param key - Transformer key identifying the source platform
 * @param dateTime - Timestamp for log file naming
 * @returns Object containing transformed users array and validation failure count
 * @throws Error if an invalid password hasher is detected
 */
function transformUsers(
	users: User[],
	key: TransformerMapKeys,
	dateTime: string
): { transformedData: User[]; validationFailed: number } {
	const transformedData: User[] = [];
	let validationFailed = 0;

	// Look up transformer once, outside the loop
	const transformer = transformers.find((obj) => obj.key === key);
	if (transformer === undefined) {
		throw new Error('No transformer found for the specified key');
	}

	for (let i = 0; i < users.length; i++) {
		const transformedUser = transformKeys(users[i], transformer);

		// Transform email to array for clerk transformer (merges primary + verified + unverified emails)
		if (key === 'clerk') {
			// Helper to parse email field - could be array (JSON) or comma/pipe-separated string (CSV)
			const parseEmails = (field: unknown): string[] => {
				if (Array.isArray(field)) return field as string[];
				if (typeof field === 'string' && field) {
					return field
						.split(/[,|]/)
						.map((e: string) => e.trim())
						.filter(Boolean);
				}
				return [];
			};

			const primaryEmail = transformedUser.email as string | undefined;
			const verifiedEmails = parseEmails(transformedUser.emailAddresses);
			const unverifiedEmails = parseEmails(
				transformedUser.unverifiedEmailAddresses
			);

			// Build email array: primary first, then verified, then unverified (deduplicated)
			const allEmails: string[] = [];
			if (primaryEmail) allEmails.push(primaryEmail);
			for (const email of [...verifiedEmails, ...unverifiedEmails]) {
				if (!allEmails.includes(email)) allEmails.push(email);
			}
			if (allEmails.length > 0) {
				transformedUser.email = allEmails;
			}
			// Remove the individual email fields after consolidation to avoid validation errors
			delete transformedUser.emailAddresses;
			delete transformedUser.unverifiedEmailAddresses;

			// Helper to parse phone field - could be array (JSON) or comma/pipe-separated string (CSV)
			const parsePhones = (field: unknown): string[] => {
				if (Array.isArray(field)) return field as string[];
				if (typeof field === 'string' && field) {
					return field
						.split(/[,|]/)
						.map((p: string) => p.trim())
						.filter(Boolean);
				}
				return [];
			};

			const primaryPhone = transformedUser.phone as string | undefined;
			const verifiedPhones = parsePhones(transformedUser.phoneNumbers);
			const unverifiedPhones = parsePhones(
				transformedUser.unverifiedPhoneNumbers
			);

			// Build phone array: primary first, then verified, then unverified (deduplicated)
			const allPhones: string[] = [];
			if (primaryPhone) allPhones.push(primaryPhone);
			for (const phone of [...verifiedPhones, ...unverifiedPhones]) {
				if (!allPhones.includes(phone)) allPhones.push(phone);
			}
			if (allPhones.length > 0) {
				transformedUser.phone = allPhones;
			}
			// Remove the individual phone fields after consolidation to avoid validation errors
			delete transformedUser.phoneNumbers;
			delete transformedUser.unverifiedPhoneNumbers;
		}

		// Apply transformer-specific post-transformation if defined
		if ('postTransform' in transformer) {
			transformer.postTransform(transformedUser);
		}
		const validationResult = userSchema.safeParse(transformedUser);
		// Check if validation was successful
		if (validationResult.success) {
			// The data is valid according to the original schema
			const validatedData = validationResult.data;
			transformedData.push(validatedData);
		} else {
			// The data is not valid, handle errors
			validationFailed++;
			const firstIssue = validationResult.error.issues[0];

			// Check if this is a password hasher validation error with an invalid value
			// Only stop immediately if there's an actual invalid value, not missing/undefined
			if (
				firstIssue.path.includes('passwordHasher') &&
				transformedUser.passwordHasher
			) {
				const userId = transformedUser.userId as string;
				const invalidHasher =
					typeof transformedUser.passwordHasher === 'string'
						? transformedUser.passwordHasher
						: JSON.stringify(transformedUser.passwordHasher);
				s.stop('Validation Error');
				throw new Error(
					`Invalid password hasher detected.\n` +
						`User ID: ${userId}\n` +
						`Row: ${i + 1}\n` +
						`Invalid hasher: "${invalidHasher}"\n` +
						`Expected one of: ${PASSWORD_HASHERS.join(', ')}`
				);
			}

			validationLogger(
				{
					error: firstIssue.message,
					path: firstIssue.path as (string | number)[],
					userId: transformedUser.userId as string,
					row: i,
				},
				dateTime
			);
		}
	}
	return { transformedData, validationFailed };
}

/**
 * Adds default field values from the transformer configuration to all users
 *
 * Some transformers define default values that should be applied to all users.
 * For example, the Supabase transformer defaults passwordHasher to "bcrypt".
 *
 * @param users - Array of user objects
 * @param key - Transformer key identifying which defaults to apply
 * @returns Array of users with default fields applied (if transformer has defaults)
 */
function addDefaultFields(users: User[], key: string) {
	const transformer = transformers.find((obj) => obj.key === key);
	const defaultFields =
		transformer && 'defaults' in transformer ? transformer.defaults : null;

	if (defaultFields) {
		const updatedUsers: User[] = [];

		for (const user of users) {
			const updated = {
				...user,
				...defaultFields,
			};
			updatedUsers.push(updated);
		}

		return updatedUsers;
	}
	return users;
}

/**
 * Loads, transforms, and validates users from a JSON or CSV file
 *
 * Main entry point for loading user data. Performs the following:
 * 1. Reads users from file (supports JSON and CSV)
 * 2. Applies transformer default fields
 * 3. Transforms field names to Clerk schema
 * 4. Validates each user against schema
 * 5. Logs validation errors
 * 6. Returns only successfully validated users and validation failure count
 *
 * Displays a spinner during the loading process.
 *
 * @param file - File path to load users from (relative or absolute)
 * @param key - Transformer key identifying the source platform
 * @returns Object containing validated users array and validation failure count
 * @throws Error if file cannot be read or contains invalid data
 */
export async function loadUsersFromFile(
	file: string,
	key: TransformerMapKeys
): Promise<{ users: User[]; validationFailed: number }> {
	const dateTime = getDateTimeStamp();
	s.start();
	s.message('Loading users and preparing to migrate');

	// Look up transformer to check for preTransform
	const transformer = transformers.find((obj) => obj.key === key);
	if (transformer === undefined) {
		s.stop('Error loading users');
		throw new Error('No transformer found for the specified key');
	}

	let filePath = createImportFilePath(file);
	let preExtractedData: User[] | undefined;
	const type = getFileType(filePath);

	// Run preTransform if defined (e.g., Firebase needs to add CSV headers or extract JSON users array)
	if ('preTransform' in transformer) {
		const preTransformResult = await Promise.resolve(
			transformer.preTransform(filePath, type || '')
		);
		filePath = preTransformResult.filePath;
		preExtractedData = preTransformResult.data;
	}

	// convert a CSV to JSON and return array
	if (type === 'text/csv') {
		const users: User[] = [];
		return new Promise((resolve, reject) => {
			fs.createReadStream(filePath)
				.pipe(csvParser({ skipComments: true }))
				.on('data', (data: User) => {
					users.push(data);
				})
				.on('error', (err) => {
					s.stop('Error loading users');
					reject(err);
				})
				.on('end', () => {
					const usersWithDefaultFields = addDefaultFields(users, key);
					const { transformedData, validationFailed } = transformUsers(
						usersWithDefaultFields,
						key,
						dateTime
					);
					s.stop('Users Loaded');
					resolve({ users: transformedData, validationFailed });
				});
		});

		// if the file is already JSON, just read and parse and return the result
	}

	// Use pre-extracted data if available (from preTransform), otherwise parse the file
	const users = preExtractedData
		? preExtractedData
		: (JSON.parse(fs.readFileSync(filePath, 'utf-8')) as User[]);
	const usersWithDefaultFields = addDefaultFields(users, key);

	const { transformedData, validationFailed } = transformUsers(
		usersWithDefaultFields,
		key,
		dateTime
	);

	s.stop('Users Loaded');
	return { users: transformedData, validationFailed };
}
