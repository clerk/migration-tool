/**
 * Transformer for migrating users from Auth.js (formerly Next-Auth)
 *
 * Maps Auth.js user data to Clerk's import format.
 * This is a minimal transformer that only maps basic user fields.
 * Auth.js typically doesn't export passwords, so users will need to
 * reset passwords or use passwordless authentication after migration.
 *
 * @property {string} key - Transformer identifier used in CLI
 * @property {string} value - Internal value for the transformer
 * @property {string} label - Display name shown in CLI prompts
 * @property {Object} transformer - Field mapping configuration
 */
const authjsTransformer = {
	key: 'authjs',
	value: 'authjs',
	label: 'Authjs (Next-Auth)',
	transformer: {
		id: 'userId',
		email_addresses: 'emailAddresses',
		first_name: 'firstName',
		last_name: 'lastName',
	},
};

export default authjsTransformer;
