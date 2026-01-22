/**
 * Transformer for migrating users from one Clerk instance to another
 *
 * Maps Clerk's user export format to the import format.
 * Supports all Clerk user fields including identifiers, passwords, MFA settings,
 * and metadata.
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} value - Internal value for the transformer
 * @property {string} label - Display name shown in CLI prompts
 * @property {Object} transformer - Field mapping configuration
 */
const clerkTransformer = {
	key: 'clerk',
	value: 'clerk',
	label: 'Clerk',
	transformer: {
		id: 'userId',
		primary_email_address: 'email',
		verified_email_addresses: 'emailAddresses',
		unverified_email_addresses: 'unverifiedEmailAddresses',
		first_name: 'firstName',
		last_name: 'lastName',
		password_digest: 'password',
		password_hasher: 'passwordHasher',
		primary_phone_number: 'phone',
		verified_phone_numbers: 'phoneNumbers',
		unverified_phone_numbers: 'unverifiedPhoneNumbers',
		username: 'username',
		totp_secret: 'totpSecret',
		backup_codes_enabled: 'backupCodesEnabled',
		backup_codes: 'backupCodes',
		public_metadata: 'publicMetadata',
		unsafe_metadata: 'unsafeMetadata',
		private_metadata: 'privateMetadata',
	},
};

export default clerkTransformer;
