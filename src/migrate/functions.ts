import fs from 'fs';
import csvParser from 'csv-parser';
import * as p from '@clack/prompts';
import { validationLogger } from '../logger';
import { transformers } from './transformers';
import { userSchema } from './validator';
import { User, PASSWORD_HASHERS, TransformerMapKeys } from '../types';
import {
	createImportFilePath,
	getDateTimeStamp,
	getFileType,
	transformKeys,
} from '../utils';

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
 * @returns Array of successfully transformed and validated users
 * @throws Error if an invalid password hasher is detected
 */
const transformUsers = (
	users: User[],
	key: TransformerMapKeys,
	dateTime: string
) => {
	// This applies to smaller numbers. Pass in 10, get 5 back.
	const transformedData: User[] = [];
	for (let i = 0; i < users.length; i++) {
		const transformerKeys = transformers.find((obj) => obj.key === key);

		if (transformerKeys === undefined) {
			throw new Error('No transformer found for the specified key');
		}

		const transformedUser = transformKeys(users[i], transformerKeys);

		// Transform email to array for clerk transformer (merges primary + verified + unverified emails)
		if (key === 'clerk') {
			// Helper to parse email field - could be array (JSON) or comma-separated string (CSV)
			const parseEmails = (field: unknown): string[] => {
				if (Array.isArray(field)) return field;
				if (typeof field === 'string' && field) {
					return field
						.split(',')
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

			// Helper to parse phone field - could be array (JSON) or comma-separated string (CSV)
			const parsePhones = (field: unknown): string[] => {
				if (Array.isArray(field)) return field;
				if (typeof field === 'string' && field) {
					return field
						.split(',')
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
		}

		// Apply transformer-specific post-transformation if defined
		if (
			transformerKeys &&
			'postTransform' in transformerKeys &&
			typeof transformerKeys.postTransform === 'function'
		) {
			transformerKeys.postTransform(transformedUser);
		}
		const validationResult = userSchema.safeParse(transformedUser);
		// Check if validation was successful
		if (validationResult.success) {
			// The data is valid according to the original schema
			const validatedData = validationResult.data;
			transformedData.push(validatedData);
		} else {
			// The data is not valid, handle errors
			const firstIssue = validationResult.error.issues[0];

			// Check if this is a password hasher validation error with an invalid value
			// Only stop immediately if there's an actual invalid value, not missing/undefined
			if (
				firstIssue.path.includes('passwordHasher') &&
				transformedUser.passwordHasher
			) {
				const userId = transformedUser.userId as string;
				const invalidHasher = transformedUser.passwordHasher;
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
					error: `${firstIssue.code} for required field.`,
					path: firstIssue.path as (string | number)[],
					id: transformedUser.userId as string,
					row: i,
				},
				dateTime
			);
		}
	}
	return transformedData;
};

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
const addDefaultFields = (users: User[], key: string) => {
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
	} else {
		return users;
	}
};

/**
 * Loads, transforms, and validates users from a JSON or CSV file
 *
 * Main entry point for loading user data. Performs the following:
 * 1. Reads users from file (supports JSON and CSV)
 * 2. Applies transformer default fields
 * 3. Transforms field names to Clerk schema
 * 4. Validates each user against schema
 * 5. Logs validation errors
 * 6. Returns only successfully validated users
 *
 * Displays a spinner during the loading process.
 *
 * @param file - File path to load users from (relative or absolute)
 * @param key - Transformer key identifying the source platform
 * @returns Array of validated users ready for import
 * @throws Error if file cannot be read or contains invalid data
 */
export const loadUsersFromFile = async (
	file: string,
	key: TransformerMapKeys
): Promise<User[]> => {
	const dateTime = getDateTimeStamp();
	s.start();
	s.message('Loading users and preparing to migrate');

	const type = getFileType(createImportFilePath(file));

	// convert a CSV to JSON and return array
	if (type === 'text/csv') {
		const users: User[] = [];
		return new Promise((resolve, reject) => {
			fs.createReadStream(createImportFilePath(file))
				.pipe(csvParser({ skipComments: true }))
				.on('data', (data) => {
					users.push(data);
				})
				.on('error', (err) => {
					s.stop('Error loading users');
					reject(err);
				})
				.on('end', () => {
					const usersWithDefaultFields = addDefaultFields(users, key);
					const transformedData: User[] = transformUsers(
						usersWithDefaultFields,
						key,
						dateTime
					);
					s.stop('Users Loaded');
					resolve(transformedData);
				});
		});

		// if the file is already JSON, just read and parse and return the result
	} else {
		const users: User[] = JSON.parse(
			fs.readFileSync(createImportFilePath(file), 'utf-8')
		);
		const usersWithDefaultFields = addDefaultFields(users, key);

		const transformedData: User[] = transformUsers(
			usersWithDefaultFields,
			key,
			dateTime
		);

		s.stop('Users Loaded');
		return transformedData;
	}
};
