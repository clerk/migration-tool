const auth0Handler = {
  key: "auth0",
  value: "auth0",
  label: "Auth0",
  transformer: {
    "_id.$oid": "userId", // Nested field automatically flattened by transformKeys
    email: "email",
    email_verified: "emailVerified",
    username: "username",
    given_name: "firstName",
    family_name: "lastName",
    phone_number: "phone",
    passwordHash: "password",
    user_metadata: "publicMetadata",
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
    passwordHasher: "bcrypt" as const,
  },
};

export default auth0Handler;
