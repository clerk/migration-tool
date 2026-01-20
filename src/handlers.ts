const clerkHandler = {
  key: "clerk",
  value: "clerk",
  label: "Clerk",
  transformer: {
    id: "userId",
    primary_email_address: "email",
    verified_email_addresses: "emailAddresses",
    unverified_email_addresses: "unverifiedEmailAddresses",
    first_name: "firstName",
    last_name: "lastName",
    password_digest: "password",
    password_hasher: "passwordHasher",
    primary_phone_number: "phone",
    verified_phone_numbers: "phoneNumbers",
    unverified_phone_numbers: "unverifiedPhoneNumbers",
    username: "username",
    totp_secret: "totpSecret",
    backup_codes_enabled: "backupCodesEnabled",
    backup_codes: "backupCodes",
    public_metadata: "publicMetadata",
    unsafe_metadata: "unsafeMetadata",
    private_metadata: "privateMetadata",
  },
}

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
}

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
}

const auth0Handler = {
  key: "auth0",
  value: "auth0",
  label: "Auth0",
  transformer: {
    "_id.$oid": "userId",  // Nested field automatically flattened by transformKeys
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
}


export const handlers = [
  clerkHandler,
  auth0Handler,
  authjsHandler,
  supabaseHandler,
];
