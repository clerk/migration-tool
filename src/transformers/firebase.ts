import fs from 'fs';
import path from 'path';
import type {
	FirebaseHashConfig,
	PreTransformResult,
	TransformerRegistryEntry,
	User,
} from '../types';

// Re-export for backwards compatibility
export type { FirebaseHashConfig } from '../types';

/**
 * Transformer for migrating users from Firebase
 *
 * Maps Firebase user data to Clerk's import format.
 * Please see https://clerk.com/docs/guides/development/migrating/firebase
 * for more information about the migration process
 *
 * The preTransform function:
 * - For CSV: Creates a temp file with headers (Firebase CSV exports lack headers)
 * - For JSON: Extracts the `users` array from the wrapper object
 *
 * The postTransform function:
 * - Adds the salt to the password using the same values as Firebase
 * - Handles email verification status
 * - Splits displayName into firstName and lastName
 */

/**
 * Hash configuration - can be set directly or via CLI
 * Values set here take precedence over .settings file
 */
export const firebaseHashConfig: FirebaseHashConfig = {
	// base64_signer_key: undefined,
	// base64_salt_separator: undefined,
	// rounds: undefined,
	// mem_cost: undefined,
	//
	base64_signer_key:
		'JbDJcvJ8lq1cSWILYAfwWU66EdgTszlHKHtsP01us8gGIhiRUFpns5sgVL4Wq6gdStEhF0XaZwTsgACxmQJBJA==',
	base64_salt_separator: 'Bw==',
	rounds: 8,
	mem_cost: 14,
};

/**
 * Sets the Firebase hash configuration values
 * Called by CLI when user provides values
 */
export function setFirebaseHashConfig(config: Partial<FirebaseHashConfig>) {
	if (config.base64_signer_key !== undefined)
		firebaseHashConfig.base64_signer_key = config.base64_signer_key;
	if (config.base64_salt_separator !== undefined)
		firebaseHashConfig.base64_salt_separator = config.base64_salt_separator;
	if (config.rounds !== undefined) firebaseHashConfig.rounds = config.rounds;
	if (config.mem_cost !== undefined)
		firebaseHashConfig.mem_cost = config.mem_cost;
}

/**
 * Checks if all required Firebase hash config values are set
 */
export function isFirebaseHashConfigComplete(): boolean {
	return (
		firebaseHashConfig.base64_signer_key !== undefined &&
		firebaseHashConfig.base64_signer_key !== '' &&
		firebaseHashConfig.base64_salt_separator !== undefined &&
		firebaseHashConfig.base64_salt_separator !== '' &&
		firebaseHashConfig.rounds !== undefined &&
		firebaseHashConfig.mem_cost !== undefined
	);
}

/**
 * CSV headers for Firebase auth export (29 columns)
 * Firebase CLI exports CSV without headers, so we need to prepend them
 *
 * Column order matches `firebase auth:export --format=csv` output:
 * 1-5: localId, email, emailVerified, passwordHash, passwordSalt
 * 6-7: displayName, photoUrl
 * 8-11: googleId, googleEmail, googleDisplayName, googlePhotoUrl
 * 12-15: facebookId, facebookEmail, facebookDisplayName, facebookPhotoUrl
 * 16-19: twitterId, twitterEmail, twitterDisplayName, twitterPhotoUrl
 * 20-23: githubId, githubEmail, githubDisplayName, githubPhotoUrl
 * 24-29: createdAt, lastSignedInAt, phoneNumber, disabled, customAttributes, providerUserInfo
 */
const FIREBASE_CSV_HEADERS =
	'localId,email,emailVerified,passwordHash,passwordSalt,displayName,photoUrl,googleId,googleEmail,googleDisplayName,googlePhotoUrl,facebookId,facebookEmail,facebookDisplayName,facebookPhotoUrl,twitterId,twitterEmail,twitterDisplayName,twitterPhotoUrl,githubId,githubEmail,githubDisplayName,githubPhotoUrl,createdAt,lastSignedInAt,phoneNumber,disabled,customAttributes,providerUserInfo';

/**
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} label - Display name shown in CLI prompts
 * @property {string} description - Detailed description shown in CLI
 * @property {Function} preTransform - Handles CSV headers and JSON extraction
 * @property {Object} transformer - Field mapping configuration
 * @property {Function} postTransform - Handles email verification and name splitting
 */
const firebaseTransformer = {
	key: 'firebase',
	label: 'Firebase',
	description:
		'This transformer works with the `firebase auth:export` command and the instructions in https://clerk.com/docs/guides/development/migrating/firebase',
	preTransform: (filePath: string, fileType: string): PreTransformResult => {
		if (fileType === 'text/csv') {
			// Firebase CSV exports don't have headers - create a temp file with headers
			const originalContent = fs.readFileSync(filePath, 'utf-8');
			const ext = path.extname(filePath);
			const baseName = path.basename(filePath, ext);

			// Create temp file in root tmp/ folder
			const tmpDir = path.join(process.cwd(), 'tmp');
			if (!fs.existsSync(tmpDir)) {
				fs.mkdirSync(tmpDir, { recursive: true });
			}
			const newFilePath = path.join(tmpDir, `${baseName}-with-headers${ext}`);

			fs.writeFileSync(
				newFilePath,
				`${FIREBASE_CSV_HEADERS}\n${originalContent}`
			);

			return { filePath: newFilePath };
		}

		if (fileType === 'application/json') {
			// Firebase JSON exports wrap users in { users: [...] }
			const fileContent = fs.readFileSync(filePath, 'utf-8');
			const parsed = JSON.parse(fileContent) as { users?: User[] } | User[];

			// Check if it's wrapped in { users: [...] } or already an array
			if (Array.isArray(parsed)) {
				return { filePath, data: parsed };
			}

			if (parsed.users && Array.isArray(parsed.users)) {
				return { filePath, data: parsed.users };
			}

			throw new Error(
				'Invalid Firebase JSON format: expected { users: [...] } or an array of users'
			);
		}

		return { filePath };
	},
	transformer: {
		localId: 'userId',
		email: 'email',
		emailVerified: 'emailVerified',
		passwordHash: 'passwordHash',
		passwordSalt: 'salt',
		phoneNumber: 'phone',
		displayName: 'name',
	},
	postTransform: (user: Record<string, unknown>) => {
		// Handle password transform to include salt and Firebase scrypt parameters
		// Format: hash$salt$base64_signer_key$base64_salt_separator$rounds$mem_cost
		const passwordHash = user.passwordHash as string | undefined;
		const salt = user.salt as string | undefined;

		if (passwordHash && salt) {
			user.password = `${passwordHash}$${salt}$${firebaseHashConfig.base64_signer_key}$${firebaseHashConfig.base64_salt_separator}$${firebaseHashConfig.rounds}$${firebaseHashConfig.mem_cost}`;

			// Clean up intermediate fields
			delete user.passwordHash;
			delete user.salt;
		}
		// Handle email verification
		const emailVerified = user.emailVerified as string | boolean | undefined;
		const email = user.email as string | undefined;

		if (email) {
			// emailVerified can be boolean or string "true"/"false"
			const isVerified = emailVerified === true || emailVerified === 'true';

			if (isVerified) {
				// Email is verified - keep it as is
				user.email = email;
			} else {
				// Email is unverified - move to unverifiedEmailAddresses
				user.unverifiedEmailAddresses = email;
				delete user.email;
			}
		}

		// Handle created_at datetime conversion
		// Convert from Firebase format (1770071979468) to ISO 8601 (2022-10-20T10:00:27.645Z)
		const createdAt = user.createdAt as string | number | undefined;
		if (createdAt) {
			try {
				// Firebase exports timestamps as milliseconds (either string or number)
				const timestamp =
					typeof createdAt === 'string' ? parseInt(createdAt, 10) : createdAt;
				const isoDate = new Date(timestamp).toISOString();
				user.createdAt = isoDate;
			} catch {
				// If conversion fails, leave the original value
				// Schema validation will catch any invalid formats and log via validationLogger
			}
		}

		// Clean up the emailVerified field as it's not part of our schema
		delete user.emailVerified;

		// Split name into firstName and lastName
		// Only set names if we have at least 2 words (Clerk requires both first and last)
		const name = user.name as string | null | undefined;
		if (name && typeof name === 'string') {
			const trimmedName = name.trim();
			const nameParts = trimmedName.split(/\s+/); // Split by one or more spaces

			if (nameParts.length > 1) {
				user.firstName = nameParts[0];
				user.lastName = nameParts.slice(1).join(' ');
			}

			// Remove the original name field
			delete user.name;
		}
	},
	defaults: {
		passwordHasher: 'scrypt_firebase' as const,
	},
} satisfies TransformerRegistryEntry;

export default firebaseTransformer;
