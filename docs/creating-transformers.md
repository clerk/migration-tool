# Creating a Custom Transformer

Transformers map your source platform's user data format to Clerk's expected schema. Each transformer is defined in `src/transformers/`.

## Transformer Structure

A transformer is an object with the following properties:

```typescript
{
  key: string,              // Unique identifier for CLI selection
  value: string,            // Internal value (usually same as key)
  label: string,            // Display name shown in CLI
  description: string,      // Detailed description shown in CLI
  transformer: object,      // Field mapping configuration
  preTransform?: function,  // Optional: Pre-processing before field mapping
  postTransform?: function, // Optional: Custom transformation logic after mapping
  defaults?: object         // Optional: Default values for all users
}
```

## Transformer Functions

### preTransform (Optional)

The `preTransform` function runs before field mapping and is useful for:

- Adding headers to CSV files that lack them
- Extracting user arrays from JSON wrapper objects
- Any preprocessing needed before the standard transformation

**Function signature:**

```typescript
preTransform: (filePath: string, fileType: string) => PreTransformResult;

type PreTransformResult = {
	filePath: string; // The file path to use (may be a temp file)
	data?: User[]; // Pre-extracted user data (skips file parsing)
};
```

**Example: Firebase preTransform**

```typescript
preTransform: (filePath: string, fileType: string): PreTransformResult => {
	if (fileType === 'text/csv') {
		// Firebase CSV exports don't have headers - create temp file with headers
		const originalContent = fs.readFileSync(filePath, 'utf-8');
		const newFilePath = path.join('tmp', 'users-with-headers.csv');
		fs.writeFileSync(newFilePath, `${CSV_HEADERS}\n${originalContent}`);
		return { filePath: newFilePath };
	}

	if (fileType === 'application/json') {
		// Firebase JSON wraps users in { users: [...] }
		const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
		if (parsed.users && Array.isArray(parsed.users)) {
			return { filePath, data: parsed.users };
		}
	}

	return { filePath };
};
```

### transformer (Required)

The `transformer` object maps source field names to Clerk schema field names:

```typescript
transformer: {
  // Source field → Target Clerk field
  'user_id': 'userId',
  'email_address': 'email',
  'first': 'firstName',
  'last': 'lastName',
  // Supports dot notation for nested fields
  'user._id.$oid': 'userId',
  'profile.email': 'email',
}
```

### postTransform (Optional)

The `postTransform` function runs after field mapping and is useful for:

- Handling email/phone verification status
- Splitting combined fields (e.g., full name into first/last)
- Converting metadata formats
- Cleaning up temporary fields

**Function signature:**

```typescript
postTransform: (user: Record<string, unknown>) => void
```

### defaults (Optional)

Default values applied to all users:

```typescript
defaults: {
  passwordHasher: 'bcrypt',
}
```

## Example: Basic Transformer

Here's a simple transformer for a fictional platform:

```typescript
// src/transformers/myplatform.ts
const myPlatformTransformer = {
	key: 'myplatform',
	value: 'myplatform',
	label: 'My Platform',
	description:
		'Use this transformer when migrating from My Platform. It handles standard user fields and bcrypt passwords.',
	transformer: {
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

## Example: Advanced Transformer with Nested Fields

For platforms with nested data structures:

```typescript
const advancedTransformer = {
	key: 'advanced',
	value: 'advanced',
	label: 'Advanced Platform',
	description:
		'Use this for platforms with nested user data structures. Supports dot notation for extracting nested fields.',
	transformer: {
		'user._id.$oid': 'userId',
		'profile.email': 'email',
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

## Example: Transformer with Verification Handling

For platforms that track email verification status:

```typescript
const verificationTransformer = {
	key: 'verification',
	value: 'verification',
	label: 'Platform with Verification',
	description:
		'Use this for platforms that track email verification status. Automatically routes emails to verified or unverified fields.',
	transformer: {
		id: 'userId',
		email: 'email',
		email_verified: 'emailVerified',
		password_hash: 'password',
	},
	postTransform: (user: Record<string, unknown>) => {
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

		// Clean up temporary field
		delete user.emailVerified;
	},
	defaults: {
		passwordHasher: 'sha256',
	},
};

export default verificationTransformer;
```

## Registering Your Transformer

After creating your transformer file:

1. Create the transformer file in `src/transformers/myplatform.ts`
2. Export it in `src/transformers/index.ts`:

```typescript
import clerkTransformer from './clerk';
import auth0Transformer from './auth0';
import supabaseTransformer from './supabase';
import authjsTransformer from './authjs';
import firebaseTransformer from './firebase';
import myPlatformTransformer from './myplatform'; // Add your import

export const transformers = [
	clerkTransformer,
	auth0Transformer,
	supabaseTransformer,
	authjsTransformer,
	firebaseTransformer,
	myPlatformTransformer, // Add to array
];
```

The CLI will automatically detect and display your transformer in the platform selection menu.

## Best Practices

1. **Field Mapping**: Map source fields to valid Clerk schema fields (see [Schema Fields Reference](schema-fields.md))
2. **Nested Fields**: Use dot notation (e.g., `'user.profile.email'`) for nested source data
3. **Verification Status**: Use `postTransform` to route emails/phones to verified or unverified arrays
4. **Password Hashers**: Always specify the correct `passwordHasher` in defaults if passwords are included
5. **Metadata**: Map platform-specific data to `publicMetadata` or `privateMetadata`
6. **Required Identifier**: Ensure at least one identifier (email, phone, or username) is mapped
7. **Cleanup**: Remove temporary fields in `postTransform` that aren't part of the schema
8. **preTransform**: Use for file preprocessing (adding headers, extracting from wrappers)

## Testing Your Transformer

After creating a transformer, test it with sample data:

```bash
# Run the migration CLI with your new transformer
bun migrate

# Run tests to ensure validation still passes
bun run test

# Check for linting issues
bun lint
```
