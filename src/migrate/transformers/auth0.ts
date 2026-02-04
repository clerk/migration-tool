/**
 * Transformer for migrating users from Auth0
 *
 * Maps Auth0's user export format to Clerk's import format.
 * Works with Auth0's Export Users API (https://auth0.com/docs/api/management/v2#!/Jobs/post_users_exports)
 *
 * Handles Auth0-specific features:
 * - user_id field (format: "provider|id", e.g., "auth0|abc123" or "github|12345")
 * - Email and phone verification status routing
 * - User and app metadata mapping
 * - Bcrypt password hashes (available via Auth0 support request)
 * - created_at timestamp conversion
 *
 * Note: Auth0 does not include password hashes in standard exports. You must contact
 * Auth0 support to request password hash export. Auth0 uses bcrypt ($2a$ or $2b$)
 * with 10 salt rounds.
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} label - Display name shown in CLI prompts
 * @property {string} description - Detailed description shown in CLI
 * @property {Object} transformer - Field mapping configuration
 * @property {Function} postTransform - Custom transformation logic for verification status
 * @property {Object} defaults - Default values applied to all users (passwordHasher: bcrypt)
 */
const auth0Transformer = {
	key: 'auth0',
	label: 'Auth0',
	description:
		"Works with Auth0's Export Users API. Password hashes require a support request to Auth0.",
	transformer: {
		user_id: 'userId',
		email: 'email',
		email_verified: 'emailVerified',
		username: 'username',
		given_name: 'firstName',
		family_name: 'lastName',
		phone_number: 'phone',
		phone_verified: 'phoneVerified',
		passwordHash: 'password',
		user_metadata: 'publicMetadata',
		app_metadata: 'privateMetadata',
		created_at: 'createdAt',
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

		// Handle phone verification
		const phoneVerified = user.phoneVerified as boolean | undefined;
		const phone = user.phone as string | undefined;

		if (phone) {
			if (phoneVerified === true) {
				// Phone is verified - keep it as is
				user.phone = phone;
			} else {
				// Phone is unverified - move to unverifiedPhoneNumbers
				user.unverifiedPhoneNumbers = phone;
				delete user.phone;
			}
		}

		// Clean up verification fields as they're not part of our schema
		delete user.emailVerified;
		delete user.phoneVerified;
	},
	defaults: {
		// Auth0 uses bcrypt with $2a$ or $2b$ prefix and 10 salt rounds
		passwordHasher: 'bcrypt' as const,
	},
};

export default auth0Transformer;
