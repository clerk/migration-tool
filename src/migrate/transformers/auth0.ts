/**
 * Transformer for migrating users from Auth0
 *
 * Maps Auth0's user export format to Clerk's import format.
 * Handles Auth0-specific features:
 * - Nested _id.$oid field extraction
 * - Email verification status routing (verified vs unverified)
 * - User metadata mapping
 * - Bcrypt password hashes
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} value - Internal value for the transformer
 * @property {string} label - Display name shown in CLI prompts
 * @property {string} description - Detailed description shown in CLI
 * @property {Object} transformer - Field mapping configuration (supports nested paths with dot notation)
 * @property {Function} postTransform - Custom transformation logic for email verification
 * @property {Object} defaults - Default values applied to all users (passwordHasher: bcrypt)
 */
const auth0Transformer = {
	key: 'auth0',
	value: 'auth0',
	label: 'Auth0',
	description:
		'This is designed to match the user export that you request from Auth0, but may need changes/updates to match the data in your export',
	transformer: {
		'_id.$oid': 'userId', // Nested field automatically flattened by transformKeys
		email: 'email',
		email_verified: 'emailVerified',
		username: 'username',
		given_name: 'firstName',
		family_name: 'lastName',
		phone_number: 'phone',
		passwordHash: 'password',
		user_metadata: 'publicMetadata',
	},
	postTransform: (user: Record<string, unknown>) => {
		// Handle email verification
		const emailVerified = user.emailVerified as boolean | undefined;
		const email = user.email as string | undefined;

		if (email) {
			if (emailVerified === true) {
				// Email is verified - keep it as is
				user.email = email;
			} else {
				// Email is unverified - move to unverifiedEmailAddresses
				user.unverifiedEmailAddresses = email;
				delete user.email;
			}
		}

		// Clean up the emailVerified field as it's not part of our schema
		delete user.emailVerified;
	},
	defaults: {
		passwordHasher: 'bcrypt' as const,
	},
};

export default auth0Transformer;
