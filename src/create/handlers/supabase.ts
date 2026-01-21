/**
 * Handler for migrating users from Supabase Auth
 *
 * Maps Supabase Auth user export format to Clerk's import format.
 * Handles Supabase-specific features:
 * - Email confirmation status routing (email_confirmed_at)
 * - Bcrypt encrypted passwords
 * - Phone numbers
 *
 * @property {string} key - Handler identifier used in CLI
 * @property {string} value - Internal value for the handler
 * @property {string} label - Display name shown in CLI prompts
 * @property {Object} transformer - Field mapping configuration
 * @property {Function} postTransform - Custom transformation logic for email confirmation
 * @property {Object} defaults - Default values applied to all users (passwordHasher: bcrypt)
 */
const supabaseHandler = {
  key: "supabase",
  value: "supabase",
  label: "Supabase",
  transformer: {
    id: "userId",
    email: "email",
    email_confirmed_at: "emailConfirmedAt",
    first_name: "firstName",
    last_name: "lastName",
    encrypted_password: "password",
    phone: "phone",
  },
  postTransform: (user: Record<string, unknown>) => {
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

    // Clean up the emailConfirmedAt field as it's not part of our schema
    delete user.emailConfirmedAt;
  },
  defaults: {
    passwordHasher: "bcrypt" as const,
  },
};

export default supabaseHandler;
