/**
 * Transformer for migrating users from Auth.js (formerly Next-Auth)
 *
 * Maps Auth.js user data to Clerk's import format.
 * This is a minimal transformer that only maps basic user fields.
 *
 * The postTransform function:
 * - Handles email verification status (routes to email or unverifiedEmailAddresses)
 * - Splits 'name' field into firstName (first word) and lastName (remaining words)
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} value - Internal value for the transformer
 * @property {string} label - Display name shown in CLI prompts
 * @property {string} description - Detailed description shown in CLI
 * @property {Object} transformer - Field mapping configuration
 * @property {Function} postTransform - Handles email verification and name splitting
 */
const authjsTransformer = {
	key: 'authjs',
	value: 'authjs',
	label: 'Authjs (Next-Auth)',
	description:
		'Authjs does not have a pre-built export tool, so you will need to edit this transformer to match the exported data. This transformer assumes the export was done via `SELECT id, name, email, email_verified, created_at FROM users`. The name field will be automatically split into firstName and lastName.',
	transformer: {
		id: 'userId',
		email: 'email',
		email_verified: 'emailVerified',
		name: 'name',
		created_at: 'createdAt',
		updated_at: 'updatedAt',
	},
	postTransform: (user: Record<string, unknown>) => {
		// Handle email verification
		const emailVerified = user.emailVerified as string | undefined;
		const email = user.email as string | undefined;

		if (email) {
			if (emailVerified) {
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
};

export default authjsTransformer;
