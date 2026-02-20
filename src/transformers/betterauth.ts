import type { TransformerRegistryEntry } from '../types';

/**
 * Transformer for migrating users from Better Auth
 *
 * Maps Better Auth user export format to Clerk's import format.
 * Works with the Better Auth export (bun export:betterauth).
 *
 * Handles Better Auth-specific features:
 * - Email verification status routing (email_verified)
 * - Phone verification status routing (phone_number_verified)
 * - Bcrypt password hashes from the credential account
 * - Name splitting (name → firstName + lastName)
 * - Admin plugin banned flag
 * - Cleanup of plugin-specific fields that aren't in the Clerk schema
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} label - Display name shown in CLI prompts
 * @property {string} description - Detailed description shown in CLI
 * @property {Object} transformer - Field mapping configuration
 * @property {Function} postTransform - Custom transformation logic
 * @property {Object} defaults - Default values applied to all users (passwordHasher: bcrypt)
 */
const betterAuthTransformer = {
	key: 'betterauth',
	label: 'Better Auth',
	description:
		'Works with the Better Auth export (bun export:betterauth). Supports bcrypt passwords and optional plugin fields.',
	transformer: {
		user_id: 'userId',
		email: 'email',
		email_verified: 'emailVerified',
		name: 'name',
		password_hash: 'password',
		username: 'username',
		phone_number: 'phone',
		phone_number_verified: 'phoneVerified',
		created_at: 'createdAt',
		updated_at: 'updatedAt',
	},
	postTransform: (user: Record<string, unknown>) => {
		// Handle email verification
		const emailVerified = user.emailVerified as boolean | undefined;
		const email = user.email as string | undefined;

		if (email) {
			if (emailVerified === true) {
				user.email = email;
			} else {
				user.unverifiedEmailAddresses = email;
				delete user.email;
			}
		}

		// Handle phone verification
		const phoneVerified = user.phoneVerified as boolean | undefined;
		const phone = user.phone as string | undefined;

		if (phone) {
			if (phoneVerified === true) {
				user.phone = phone;
			} else {
				user.unverifiedPhoneNumbers = phone;
				delete user.phone;
			}
		}

		// Clean up verification fields
		delete user.emailVerified;
		delete user.phoneVerified;

		// Split name into firstName and lastName
		const name = user.name as string | null | undefined;
		if (name && typeof name === 'string') {
			const trimmedName = name.trim();
			const nameParts = trimmedName.split(/\s+/);

			if (nameParts.length > 1) {
				user.firstName = nameParts[0];
				user.lastName = nameParts.slice(1).join(' ');
			}

			delete user.name;
		}

		// Map banned field if present
		const banned = user.banned as boolean | undefined;
		if (banned === true) {
			user.banned = true;
		} else {
			delete user.banned;
		}

		// Clean up plugin-specific fields that aren't in the Clerk schema
		delete user.display_username;
		delete user.role;
		delete user.ban_reason;
		delete user.ban_expires;
		delete user.two_factor_enabled;
	},
	defaults: {
		passwordHasher: 'bcrypt' as const,
	},
} satisfies TransformerRegistryEntry;

export default betterAuthTransformer;
