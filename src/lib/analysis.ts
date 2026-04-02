import type { FieldAnalysis, IdentifierCounts } from '../types';
import { getDateTimeStamp } from './index';
import { validationLogger } from '../logger';
import { userSchema } from '../migrate/validator';
import { transformers } from '../transformers';

// Fields to analyze for the import (non-identifier fields)
export const ANALYZED_FIELDS = [
	{ key: 'firstName', label: 'First Name' },
	{ key: 'lastName', label: 'Last Name' },
	{ key: 'password', label: 'Password' },
	{ key: 'totpSecret', label: 'TOTP Secret' },
];

/**
 * Checks if a value exists and is not empty
 *
 * Returns false for undefined, null, empty strings, and empty arrays.
 * Returns true for all other values including 0, false, and non-empty objects.
 *
 * @param value - The value to check
 * @returns true if the value has meaningful content, false otherwise
 */
export const hasValue = (value: unknown): boolean => {
	if (value === undefined || value === null || value === '') return false;
	if (Array.isArray(value)) return value.length > 0;
	return true;
};

/**
 * Analyzes user data to determine field presence and identifier coverage
 *
 * Examines all users to count:
 * - How many users have each field (firstName, lastName, password, totpSecret)
 * - Identifier coverage (verified/unverified emails and phones, usernames)
 * - Whether all users have at least one valid identifier
 *
 * Used to provide feedback about Dashboard configuration requirements.
 *
 * @param users - Array of user objects to analyze
 * @returns Field analysis object with counts and identifier statistics
 */
export function analyzeFields(users: Record<string, unknown>[]): FieldAnalysis {
	const totalUsers = users.length;

	if (totalUsers === 0) {
		return {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 0,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 0,
			},
			totalUsers: 0,
			fieldCounts: {},
		};
	}

	const fieldCounts: Record<string, number> = {};
	const identifiers: IdentifierCounts = {
		verifiedEmails: 0,
		unverifiedEmails: 0,
		verifiedPhones: 0,
		unverifiedPhones: 0,
		username: 0,
		hasAnyIdentifier: 0,
	};

	// Count how many users have each field
	for (const user of users) {
		// Count non-identifier fields
		for (const field of ANALYZED_FIELDS) {
			if (hasValue(user[field.key])) {
				fieldCounts[field.key] = (fieldCounts[field.key] || 0) + 1;
			}
		}

		// Count consolidated identifier fields
		const hasVerifiedEmail =
			hasValue(user.email) || hasValue(user.emailAddresses);
		const hasUnverifiedEmail = hasValue(user.unverifiedEmailAddresses);
		const hasVerifiedPhone =
			hasValue(user.phone) || hasValue(user.phoneNumbers);
		const hasUnverifiedPhone = hasValue(user.unverifiedPhoneNumbers);
		const hasUsername = hasValue(user.username);

		if (hasVerifiedEmail) identifiers.verifiedEmails++;
		if (hasUnverifiedEmail) identifiers.unverifiedEmails++;
		if (hasVerifiedPhone) identifiers.verifiedPhones++;
		if (hasUnverifiedPhone) identifiers.unverifiedPhones++;
		if (hasUsername) identifiers.username++;

		// Check if user has at least one valid identifier
		if (hasVerifiedEmail || hasVerifiedPhone || hasUsername) {
			identifiers.hasAnyIdentifier++;
		}
	}

	const presentOnAll: string[] = [];
	const presentOnSome: string[] = [];

	for (const field of ANALYZED_FIELDS) {
		const count = fieldCounts[field.key] || 0;
		if (count === totalUsers) {
			presentOnAll.push(field.label);
		} else if (count > 0) {
			presentOnSome.push(field.label);
		}
	}

	return { presentOnAll, presentOnSome, identifiers, totalUsers, fieldCounts };
}

/**
 * Validates users against the schema and logs validation errors.
 *
 * Runs before the readiness display so users can see the validation failure
 * count and review the log file before confirming the migration.
 *
 * Applies transformer default fields (e.g., Supabase passwordHasher: "bcrypt")
 * before validation to match the behavior of the full import pipeline.
 *
 * @param users - Array of transformed user objects from loadRawUsers()
 * @param transformerKey - Transformer key to look up default fields
 * @returns Object with validation failure count and log file path
 */
export function validateUsers(
	users: Record<string, unknown>[],
	transformerKey: string
): { validationFailed: number; logFile: string } {
	const dateTime = getDateTimeStamp();
	const logFile = `migration-${dateTime}.log`;
	let validationFailed = 0;

	// Look up transformer defaults (e.g., Supabase adds passwordHasher: "bcrypt")
	const transformer = transformers.find((obj) => obj.key === transformerKey);
	const defaultFields =
		transformer && 'defaults' in transformer ? transformer.defaults : null;

	for (let i = 0; i < users.length; i++) {
		const user = defaultFields ? { ...users[i], ...defaultFields } : users[i];
		const result = userSchema.safeParse(user);

		if (!result.success) {
			validationFailed++;
			const firstIssue = result.error.issues[0];
			validationLogger(
				{
					error: firstIssue.message,
					path: firstIssue.path as (string | number)[],
					userId: (user.userId as string) || `row-${i}`,
					row: i,
				},
				dateTime
			);
		}
	}

	return { validationFailed, logFile };
}
