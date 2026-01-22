import * as z from 'zod';
import { PASSWORD_HASHERS } from '../types';

// ============================================================================
//
// ONLY EDIT BELOW THIS IF YOU ARE ADDING A NEW FIELD
//
// Generally you only need to add or edit a handler and do not need to touch
// any of the schema.
//
// ============================================================================

/**
 * Zod enum of supported password hashing algorithms
 */
const passwordHasherEnum = z.enum(
	PASSWORD_HASHERS as unknown as [string, ...string[]]
);

/**
 * User validation schema for Clerk user imports
 *
 * Validates user data before sending to Clerk API.
 * All fields are optional except:
 * - userId is required (for tracking and logging)
 * - passwordHasher is required when password is provided
 * - user must have at least one verified identifier (email or phone)
 *
 * @remarks
 * Fields can accept single values or arrays (e.g., email: string | string[])
 * Metadata fields accept any value for flexibility
 */
export const userSchema = z
	.object({
		userId: z.string(),
		// Email fields
		email: z.union([z.email(), z.array(z.email())]).optional(),
		emailAddresses: z.union([z.email(), z.array(z.email())]).optional(),
		unverifiedEmailAddresses: z
			.union([z.email(), z.array(z.email())])
			.optional(),
		// Phone fields
		phone: z.union([z.string(), z.array(z.string())]).optional(),
		phoneNumbers: z.union([z.string(), z.array(z.string())]).optional(),
		unverifiedPhoneNumbers: z
			.union([z.string(), z.array(z.string())])
			.optional(),
		// User info
		username: z.string().optional(),
		firstName: z.string().optional(),
		lastName: z.string().optional(),
		// Password
		password: z.string().optional(),
		passwordHasher: passwordHasherEnum.optional(),
		// 2FA
		totpSecret: z.string().optional(),
		backupCodesEnabled: z.boolean().optional(),
		backupCodes: z.string().optional(),
		// Metadata - accept any value
		unsafeMetadata: z.any().optional(),
		publicMetadata: z.any().optional(),
		privateMetadata: z.any().optional(),
	})
	.refine((data) => !data.password || data.passwordHasher, {
		message: 'passwordHasher is required when password is provided',
		path: ['passwordHasher'],
	})
	.refine(
		(data) => {
			// Helper to check if field has value
			const hasValue = (field: unknown): boolean => {
				if (!field) return false;
				if (typeof field === 'string') return field.length > 0;
				if (Array.isArray(field)) return field.length > 0;
				return false;
			};
			// Must have either verified email or verified phone
			const hasVerifiedEmail =
				hasValue(data.email) || hasValue(data.emailAddresses);
			const hasVerifiedPhone =
				hasValue(data.phone) || hasValue(data.phoneNumbers);
			return hasVerifiedEmail || hasVerifiedPhone;
		},
		{
			message:
				'User must have either a verified email or verified phone number',
			path: ['email'],
		}
	);
