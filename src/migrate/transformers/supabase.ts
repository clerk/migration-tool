/**
 * Transformer for migrating users from Supabase Auth
 *
 * Maps Supabase Auth user export format to Clerk's import format.
 * Handles Supabase-specific features:
 * - DateTime conversion (created_at: PostgreSQL format → ISO 8601)
 * - Email confirmation status routing (email_confirmed_at)
 * - Bcrypt encrypted passwords
 * - Phone numbers
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} value - Internal value for the transformer
 * @property {string} label - Display name shown in CLI prompts
 * @property {string} description - Detailed description shown in CLI
 * @property {Object} transformer - Field mapping configuration
 * @property {Function} postTransform - Custom transformation logic for datetime, email, and phone verification
 * @property {Object} defaults - Default values applied to all users (passwordHasher: bcrypt)
 */
const supabaseTransformer = {
	key: 'supabase',
	value: 'supabase',
	label: 'Supabase',
	description:
		'This should be used when you have exported your users via https://supabase.com/docs/guides/auth/managing-user-data#exporting-users. If you have performed your own exported via SQL you will likely need to edit this transformer to match or create a new one.',
	transformer: {
		id: 'userId',
		email: 'email',
		email_confirmed_at: 'emailConfirmedAt',
		first_name: 'firstName',
		last_name: 'lastName',
		encrypted_password: 'password',
		phone: 'phone',
		phone_confirmed_at: 'phoneConfirmedAt',
		raw_user_meta_data: 'publicMetadata',
		created_at: 'createdAt',
	},
	postTransform: (user: Record<string, unknown>) => {
		// Handle created_at datetime conversion
		// Convert from Supabase format (2024-06-29 20:25:06.126079+00) to ISO 8601 (2022-10-20T10:00:27.645Z)
		const createdAt = user.createdAt as string | undefined;
		if (createdAt) {
			try {
				const isoDate = new Date(createdAt).toISOString();
				user.createdAt = isoDate;
			} catch {
				// If conversion fails, leave the original value
				// Schema validation will catch any invalid formats and log via validationLogger
			}
		}

		// Handle email verification
		const emailConfirmedAt = user.emailConfirmedAt as string | undefined;
		const email = user.email as string | undefined;

		if (email) {
			if (emailConfirmedAt) {
				// Email is verified - keep it as is
				user.email = email;
			} else {
				// Email is unverified - move to unverifiedEmailAddresses
				user.unverifiedEmailAddresses = email;
				delete user.email;
			}
		}

		// Handle phone verification
		const phoneConfirmedAt = user.phoneConfirmedAt as string | undefined;
		const phone = user.phone as string | undefined;

		if (phone) {
			if (phoneConfirmedAt) {
				// Phone is verified - keep it as is
				user.phone = phone;
			} else {
				// Email is unverified - move to unverifiedEmailAddresses
				user.unverifiedPhoneNumbers = phone;
				delete user.phone;
			}
		}

		// Clean up the emailConfirmedAt and phoneConfirmedAt fields as they aren't
		// part of our schema
		delete user.emailConfirmedAt;
		delete user.phoneCofnirmedAt;
	},
	defaults: {
		passwordHasher: 'bcrypt' as const,
	},
};

export default supabaseTransformer;
