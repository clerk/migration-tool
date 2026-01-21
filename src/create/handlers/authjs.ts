/**
 * Handler for migrating users from Auth.js (formerly Next-Auth)
 *
 * Maps Auth.js user data to Clerk's import format.
 * This is a minimal handler that only maps basic user fields.
 * Auth.js typically doesn't export passwords, so users will need to
 * reset passwords or use passwordless authentication after migration.
 *
 * @property {string} key - Handler identifier used in CLI
 * @property {string} value - Internal value for the handler
 * @property {string} label - Display name shown in CLI prompts
 * @property {Object} transformer - Field mapping configuration
 */
const authjsHandler = {
  key: "authjs",
  value: "authjs",
  label: "Authjs (Next-Auth)",
  transformer: {
    id: "userId",
    email_addresses: "emailAddresses",
    first_name: "firstName",
    last_name: "lastName",
  },
};

export default authjsHandler;
