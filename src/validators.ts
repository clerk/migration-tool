import * as z from "zod";
import { PASSWORD_HASHERS } from "./types";

// ============================================================================
//
// ONLY EDIT BELOW THIS IF YOU ARE ADDING A NEW FIELD
//
// Generally you only need to add or edit a handler and do not need to touch
// any of the schema.
//
// ============================================================================

const passwordHasherEnum = z.enum(PASSWORD_HASHERS as unknown as [string, ...string[]]);

// Email validation using regex to avoid deprecated .email() method
const emailString = z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

// default schema -- incoming data will be transformed to this format
// All fields are optional except:
// - userId is required (for logging purposes)
// - passwordHasher is required when password is provided
// - user must have either a verified email or verified phone number
export const userSchema = z.object({
	userId: z.string(),
	// Email fields
	email: z.union([emailString, z.array(emailString)]).optional(),
	emailAddresses: z.union([emailString, z.array(emailString)]).optional(),
	unverifiedEmailAddresses: z.union([emailString, z.array(emailString)]).optional(),
	// Phone fields
	phone: z.union([z.string(), z.array(z.string())]).optional(),
	phoneNumbers: z.union([z.string(), z.array(z.string())]).optional(),
	unverifiedPhoneNumbers: z.union([z.string(), z.array(z.string())]).optional(),
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
}).refine(
	(data) => !data.password || data.passwordHasher,
	{
		message: "passwordHasher is required when password is provided",
		path: ["passwordHasher"],
	}
).refine(
	(data) => {
		// Helper to check if field has value
		const hasValue = (field: unknown): boolean => {
			if (!field) return false;
			if (typeof field === "string") return field.length > 0;
			if (Array.isArray(field)) return field.length > 0;
			return false;
		};
		// Must have either verified email or verified phone
		const hasVerifiedEmail = hasValue(data.email) || hasValue(data.emailAddresses);
		const hasVerifiedPhone = hasValue(data.phone) || hasValue(data.phoneNumbers);
		return hasVerifiedEmail || hasVerifiedPhone;
	},
	{
		message: "User must have either a verified email or verified phone number",
		path: ["email"],
	}
);
