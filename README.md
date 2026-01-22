# Clerk User Migration Script

## Description

This repository contains a script that takes a JSON file as input, containing a list of users, and creates a user in Clerk using Clerk's backend API. The script respects rate limits and handles errors.

## Getting Started

Clone the repository and install the dependencies.

```bash
git clone git@github.com:clerk/migration-script

cd migration-script

bun install
```

### Users file

The script is designed to import from multiple sources, including moving users from one Clerk instance to another. You may need to edit the transformer for your source. Please see below for more information on that.

The script will import from a CSV or JSON. It accounts for empty fields in a CSV and will remove them when converting from CSV to a javascript object.

The only required fields are `userId` and an identifier (one of `email`, `phone` or `username`).

#### Samples

The samples/ folder contains some samples you can test with. The samples include issues that will produce errors when running the import.

Some sample users have passwords. The password is `Kk4aPMeiaRpAs2OeX1NE`.

### Secret Key

Create a `.env` file in the root of the folder and add your `CLERK_SECRET_KEY` to it. You can find your secret key in the [Clerk dashboard](https://dashboard.clerk.dev/).

```bash
CLERK_SECRET_KEY=your-secret-key
```

### Run the script

```bash
bun migrate
```

The script will begin processing users and attempting to import them into Clerk. The script respects rate limits for the Clerk Backend API. If the script hits a rate limit, it will wait 10 seconds and retry (up to 5 times). Any errors will be logged to timestamped log files in the `./logs` folder.

The script can be run on the same data multiple times. Clerk automatically uses the email as a unique key so users won't be created again.

**Error Handling & Resuming**: If the migration stops for any reason (error, interruption, etc.), the script will display the last processed user ID. You can resume the migration from that point by providing the user ID when prompted, or by using:

```bash
bun migrate --resume-after="user_xxx"
```

### Configuration

The script can be configured through the following environment variables:

| Variable           | Description                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY` | Your Clerk secret key                                                     |
| `RATE_LIMIT`       | Rate limit in requests/second (auto-configured: 100 for prod, 10 for dev) |

The script automatically detects production vs development instances from your `CLERK_SECRET_KEY` and sets appropriate rate limits:

- **Production** (`sk_live_*`): 100 requests/second (Clerk's limit: 1000 requests per 10 seconds)
- **Development** (`sk_test_*`): 10 requests/second (Clerk's limit: 100 requests per 10 seconds)

You can override the rate limit by setting `RATE_LIMIT` in your `.env` file.

## Other commands

### Delete users

```
bun delete
```

This will delete all migrated users from the instance. It should not delete pre-existing users, but it is not recommended to use this with a production instance that has pre-existing users. Please use caution with this command.

### Clean logs

```
bun clean-logs
```

All migrations and deletions will create logs in the `./logs` folder. This command will delete those logs.

## Migrating OAuth connections

OAuth connections can not be directly migrated. The creation of the connection requires the user to consent, which can't happen on a migration like this. Instead you can rely on Clerk's [Account Linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking) to handle this.

## Handling the Foreign Key constraint

If you were using a database, you will have data tied to your previous auth system's userIDs. You will need to handle this in some way to maintain data consistency as you move to Clerk. Below are a few strategies you can use.

### Custom session claims

Our sessions allow for conditional expressions. This would allow you add a session claim that will return either the `externalId` (the previous id for your user) when it exists, or the `userId` from Clerk. This will result in your imported users returning their `externalId` while newer users will return the Clerk `userId`.

In your Dashboard, go to Sessions -> Edit. Add the following:

```json
{
	"userId": "{{user.externalId || user.id}}"
}
```

You can now access this value using the following:

```ts
const { sessionClaims } = auth();
console.log(sessionClaims.userId);
```

You can add the following for typescript:

```js
// types/global.d.ts

export { };

declare global {
  interface CustomJwtSessionClaims {
    userId?: string;
  }
}
```

### Other options

You could continue to generate unique ids for the database as done previously, and then store those in `externalId`. This way all users would have an `externalId` that would be used for DB interactions.

You could add a column in your user table inside of your database called `ClerkId`. Use that column to store the userId from Clerk directly into your database.

## Supported Schema Fields

The migration script validates all user data against a Zod schema defined in `src/migrate/validator.ts`. Below is a complete list of supported fields.

### Required Fields

| Field    | Type     | Description                                                        |
| -------- | -------- | ------------------------------------------------------------------ |
| `userId` | `string` | Unique identifier for the user (required for tracking and logging) |

### Identifier Fields

At least one verified identifier (email or phone) is required.

| Field                      | Type                 | Description                         |
| -------------------------- | -------------------- | ----------------------------------- |
| `email`                    | `string \| string[]` | Primary verified email address(es)  |
| `emailAddresses`           | `string \| string[]` | Additional verified email addresses |
| `unverifiedEmailAddresses` | `string \| string[]` | Unverified email addresses          |
| `phone`                    | `string \| string[]` | Primary verified phone number(s)    |
| `phoneNumbers`             | `string \| string[]` | Additional verified phone numbers   |
| `unverifiedPhoneNumbers`   | `string \| string[]` | Unverified phone numbers            |
| `username`                 | `string`             | Username for the user               |

### User Information

| Field       | Type     | Description       |
| ----------- | -------- | ----------------- |
| `firstName` | `string` | User's first name |
| `lastName`  | `string` | User's last name  |

### Password Fields

| Field            | Type     | Description                                                 |
| ---------------- | -------- | ----------------------------------------------------------- |
| `password`       | `string` | Hashed password from source platform                        |
| `passwordHasher` | `enum`   | Hashing algorithm used (required when password is provided) |

**Supported Password Hashers:**

- `argon2i`, `argon2id`
- `bcrypt`, `bcrypt_peppered`, `bcrypt_sha256_django`
- `hmac_sha256_utf16_b64`
- `md5`, `md5_salted`, `md5_phpass`
- `pbkdf2_sha1`, `pbkdf2_sha256`, `pbkdf2_sha256_django`, `pbkdf2_sha512`
- `scrypt_firebase`, `scrypt_werkzeug`
- `sha256`, `sha256_salted`, `sha512_symfony`
- `ldap_ssha`

### Two-Factor Authentication

| Field                | Type       | Description                      |
| -------------------- | ---------- | -------------------------------- |
| `totpSecret`         | `string`   | TOTP secret for 2FA              |
| `backupCodesEnabled` | `boolean`  | Whether backup codes are enabled |
| `backupCodes`        | `string[]` | Array of backup codes            |

### Metadata

| Field             | Type  | Description                                                  |
| ----------------- | ----- | ------------------------------------------------------------ |
| `unsafeMetadata`  | `any` | Publicly accessible metadata (readable by client and server) |
| `publicMetadata`  | `any` | Publicly accessible metadata (readable by client and server) |
| `privateMetadata` | `any` | Server-side only metadata (not accessible to client)         |

### Clerk API Configuration Fields

| Field                       | Type      | Description                                     |
| --------------------------- | --------- | ----------------------------------------------- |
| `bypassClientTrust`         | `boolean` | Skip client trust verification                  |
| `createOrganizationEnabled` | `boolean` | Whether user can create organizations           |
| `createOrganizationsLimit`  | `number`  | Maximum number of organizations user can create |
| `createdAt`                 | `string`  | Custom creation timestamp                       |
| `deleteSelfEnabled`         | `boolean` | Whether user can delete their own account       |
| `legalAcceptedAt`           | `string`  | Timestamp when legal terms were accepted        |
| `skipLegalChecks`           | `boolean` | Skip legal acceptance checks                    |
| `skipPasswordChecks`        | `boolean` | Skip password requirements during import        |

## Creating a Custom Transformer

Transformers map your source platform's user data format to Clerk's expected schema. Each transformer is defined in `src/migrate/transformers/`.

### Transformer Structure

A transformer is an object with the following properties:

```typescript
{
  key: string,           // Unique identifier for CLI selection
  value: string,         // Internal value (usually same as key)
  label: string,         // Display name shown in CLI
  transformer: object,   // Field mapping configuration
  postTransform?: function,  // Optional: Custom transformation logic
  defaults?: object      // Optional: Default values for all users
}
```

### Example: Basic Transformer

Here's a simple transformer for a fictional platform:

```typescript
// src/migrate/transformers/myplatform.ts
const myPlatformTransformer = {
	key: 'myplatform',
	value: 'myplatform',
	label: 'My Platform',
	transformer: {
		// Source field → Target Clerk field
		user_id: 'userId',
		email_address: 'email',
		first: 'firstName',
		last: 'lastName',
		phone_number: 'phone',
		hashed_password: 'password',
	},
	defaults: {
		passwordHasher: 'bcrypt',
	},
};

export default myPlatformTransformer;
```

### Example: Advanced Transformer with Nested Fields

For platforms with nested data structures:

```typescript
const advancedTransformer = {
	key: 'advanced',
	value: 'advanced',
	label: 'Advanced Platform',
	transformer: {
		// Supports dot notation for nested fields
		'user._id.$oid': 'userId', // Extracts user._id.$oid
		'profile.email': 'email', // Extracts profile.email
		'profile.name.first': 'firstName',
		'profile.name.last': 'lastName',
		'auth.passwordHash': 'password',
		'metadata.public': 'publicMetadata',
	},
	defaults: {
		passwordHasher: 'bcrypt',
	},
};

export default advancedTransformer;
```

### Example: Transformer with Post-Transform Logic

For complex transformations like handling verification status:

```typescript
const verificationTransformer = {
	key: 'verification',
	value: 'verification',
	label: 'Platform with Verification',
	transformer: {
		id: 'userId',
		email: 'email',
		email_verified: 'emailVerified',
		password_hash: 'password',
	},
	postTransform: (user: Record<string, unknown>) => {
		// Route email based on verification status
		const emailVerified = user.emailVerified as boolean | undefined;
		const email = user.email as string | undefined;

		if (email) {
			if (emailVerified === true) {
				// Keep verified email in email field
				user.email = email;
			} else {
				// Move unverified email to unverifiedEmailAddresses
				user.unverifiedEmailAddresses = email;
				delete user.email;
			}
		}

		// Clean up temporary field
		delete user.emailVerified;
	},
	defaults: {
		passwordHasher: 'sha256',
	},
};

export default verificationTransformer;
```

### Registering Your Transformer

After creating your transformer file:

1. Create the transformer file in `src/migrate/transformers/myplatform.ts`
2. Export it in `src/migrate/transformers/index.ts`:

```typescript
import clerkTransformer from './clerk';
import auth0Transformer from './auth0';
import supabaseTransformer from './supabase';
import authjsTransformer from './authjs';
import myPlatformTransformer from './myplatform'; // Add your import

export const transformers = [
	clerkTransformer,
	auth0Transformer,
	supabaseTransformer,
	authjsTransformer,
	myPlatformTransformer, // Add to array
];
```

The CLI will automatically detect and display your transformer in the platform selection menu.

### Transformer Best Practices

1. **Field Mapping**: Map source fields to valid Clerk schema fields (see Supported Schema Fields above)
2. **Nested Fields**: Use dot notation (e.g., `'user.profile.email'`) for nested source data
3. **Verification Status**: Use `postTransform` to route emails/phones to verified or unverified arrays
4. **Password Hashers**: Always specify the correct `passwordHasher` in defaults if passwords are included
5. **Metadata**: Map platform-specific data to `publicMetadata` or `privateMetadata`
6. **Required Identifier**: Ensure at least one verified email or phone is mapped
7. **Cleanup**: Remove temporary fields in `postTransform` that aren't part of the schema
