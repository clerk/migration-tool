import * as z from "zod";

const unsafeMetadataSchema = z.object({});
// username: z.string().optional(),
// isAccessToBeta: z.boolean().optional(),
// });

const publicMetadataSchema = z.object({});

const privateMetadataSchema = z.object({});

// ============================================================================
//
// ONLY EDIT BELOW THIS IF YOU ARE ADDING A NEW IMPORT SOURCE
// THAT IS NOT YET SUPPORTED
//
// ============================================================================

const passwordHasherEnum = z.enum([
	"argon2i",
	"argon2id",
	"bcrypt",
	"md5",
	"pbkdf2_sha256",
	"pbkdf2_sha256_django",
	"pbkdf2_sha1",
	"scrypt_firebase",
]);

// default schema -- incoming data will be transformed to this format
// All fields are optional except:
// - userId is required (for logging purposes)
// - passwordHasher is required when password is provided
// - user must have either a verified email or verified phone number
export const userSchema = z.object({
	userId: z.string(),
	// Email fields
	email: z.union([z.string().email(), z.array(z.string().email())]).optional(),
	emailAddresses: z.union([z.string().email(), z.array(z.string().email())]).optional(),
	unverifiedEmailAddresses: z.union([z.string().email(), z.array(z.string().email())]).optional(),
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
	// MFA
	mfaEnabled: z.boolean().optional(),
	totpSecret: z.string().optional(),
	backupCodesEnabled: z.boolean().optional(),
	backupCodes: z.string().optional(),
	// unsafeMetadata: unsafeMetadataSchema,
	// publicMetadata: publicMetadataSchema,
	// privateMetadata: privateMetadataSchema,
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
