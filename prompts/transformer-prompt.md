# AI Prompt for Generating Custom Transformers

Use this prompt with an AI assistant to generate a custom transformer from your sample user data.

---

## Prompt Template

Copy and paste the following prompt, replacing `[YOUR SAMPLE DATA]` with a sample of your user JSON or CSV data:

````
I need to create a custom transformer for the Clerk user migration script. Please analyze my sample user data and generate a transformer file.

## Environment Setup

Before generating the transformer, check if a `.env` file exists with `CLERK_SECRET_KEY`. If not:
1. Ask the user to provide their CLERK_SECRET_KEY (found in Clerk Dashboard → API Keys → Secret keys)
2. Create the `.env` file with the provided key
3. Continue with the transformer generation without stopping

Do not ask "would you like me to create one?" - just ask for the key directly and create the file.

## Sample User Data

[YOUR SAMPLE DATA]

## Requirements

1. Before beginning work, check if CLERK_SECRET_KEY is present.
   - Check if `.env` exists with `CLERK_SECRET_KEY`
   - If not, ask me for the key (found in Clerk Dashboard → API Keys → Secret keys, or https://dashboard.clerk.com/~/api-keys)
   - Create/update the `.env` file with the key

2. Analyze the JSON/CSV structure to identify:
   - User ID field (maps to `userId`)
   - Email field(s) and verification status
   - Phone field(s) and verification status
   - Name fields (first name, last name, or combined name)
   - Password field and hash algorithm
   - Any metadata fields

3. Generate a complete transformer file following this structure:

```typescript
// src/transformers/[platform-name].ts
const [platformName]Transformer = {
  key: '[platform-key]',
  value: '[platform-key]',
  label: '[Platform Name]',
  description: '[Description of what this transformer handles]',
  preTransform?: (filePath, fileType) => PreTransformResult,  // if needed
  transformer: {
    // field mappings
  },
  postTransform?: (user) => void,  // if needed
  defaults?: {
    // default values
  },
};

export default [platformName]Transformer;
```

4. **CRITICAL - Register the transformer**: After creating the transformer file, you MUST register it in `src/transformers/index.ts`. This is NOT optional. The migration and delete commands will fail silently if the transformer is not registered.

   Add both an import and include it in the exports array:

   ```typescript
   // Add import at the top
   import customTransformer from './custom';

   // Add to the transformers array
   export const transformers = [
     // ... existing transformers
     customTransformer,  // ADD YOUR TRANSFORMER HERE
   ];
   ```

   **WARNING**: If you skip this step:
   - The transformer will NOT appear in the CLI's platform selection
   - The `bun delete` command will NOT be able to find migrated users
   - Users will see "Found 0 migrated users to delete" even after successful migration
````

## Questions to Answer

Before generating the transformer, please ask me about:

1. **Email verification**: Does the data include an email verification status field? If not, should emails be treated as verified or unverified?

2. **Phone verification**: Does the data include a phone verification status field? If not, should phones be treated as verified or unverified?

3. **Password hasher**: If there's a password field, what hashing algorithm was used? (bcrypt, argon2, sha256, etc.)

4. **Data preprocessing**: Does the data require any preprocessing?
   - Is the JSON wrapped in an object (e.g., `{ users: [...] }` or `{ data: [...] }`)?
   - Is the CSV missing headers?
   - Any other preprocessing needs?

5. **Metadata mapping**: Should any fields be mapped to `publicMetadata` or `privateMetadata`?

After I answer these questions, generate the complete transformer file with:

- All necessary imports
- Field mappings
- preTransform function (if data needs preprocessing)
- postTransform function (if verification handling or field splitting is needed)
- Appropriate defaults
- JSDoc comments explaining the transformer

## Environment Check

Before generating the transformer:

1. Check if a `.env` file exists in the project root with `CLERK_SECRET_KEY`
2. If it doesn't exist or is missing the key, immediately ask for the CLERK_SECRET_KEY
3. Create/update the `.env` file with the provided key
4. Continue with the transformer generation

Do not stop and wait for confirmation - just ask for the key, create the file, and proceed.

````

---

## Example Conversation

**User provides sample data:**

```json
{
  "users": [
    {
      "_id": { "$oid": "507f1f77bcf86cd799439011" },
      "email": "user@example.com",
      "email_confirmed": false,
      "password_digest": "$2a$10$...",
      "full_name": "John Doe",
      "phone": "+1234567890",
      "created_at": "2024-01-15T10:30:00Z",
      "app_metadata": { "role": "admin" }
    }
  ]
}
````

**AI asks clarifying questions:**

1. I see `email_confirmed: false` - should unconfirmed emails go to `unverifiedEmailAddresses`?
2. The phone field has no verification status - should it be treated as verified or unverified?
3. The `password_digest` appears to be bcrypt (`$2a$` prefix) - is that correct?
4. The data is wrapped in `{ users: [...] }` - should I add a preTransform to extract it?
5. Should `app_metadata` be mapped to `publicMetadata` or `privateMetadata`?

**User answers:**

1. Yes, unconfirmed emails should be unverified
2. Treat phones as verified
3. Yes, it's bcrypt
4. Yes, add preTransform
5. Map to privateMetadata

**AI generates complete transformer with all handling.**

---

## Field Reference

When generating transformers, map to these Clerk schema fields:

| Clerk Field                | Description                      |
| -------------------------- | -------------------------------- |
| `userId`                   | Required unique identifier       |
| `email`                    | Verified email address(es)       |
| `unverifiedEmailAddresses` | Unverified email addresses       |
| `phone`                    | Verified phone number(s)         |
| `unverifiedPhoneNumbers`   | Unverified phone numbers         |
| `username`                 | Username                         |
| `firstName`                | First name                       |
| `lastName`                 | Last name                        |
| `password`                 | Hashed password                  |
| `passwordHasher`           | Algorithm used (set in defaults) |
| `publicMetadata`           | Client-readable metadata         |
| `privateMetadata`          | Server-only metadata             |
| `createdAt`                | ISO 8601 timestamp               |

See [Schema Fields Reference](schema-fields.md) for the complete list.

---

## Post-Generation Checklist

After generating your transformer, verify these steps were completed:

### 1. Transformer File Created

- [ ] File exists at `src/transformers/[platform-name].ts`
- [ ] Has a default export with `key`, `value`, `label`, `description`, and `transformer` fields
- [ ] The `transformer` object maps source fields to Clerk fields (including a field that maps to `userId`)

### 2. Transformer Registered (CRITICAL)

- [ ] Import added to `src/transformers/index.ts`
- [ ] Transformer added to the `transformers` array export

**If you skip registration, the delete command will fail to find migrated users!**

### 3. Validate the Setup

```bash
# Run tests to verify transformer is properly registered
bun run test

# Check for lint errors
bun lint

# Test the migration CLI (should show your new platform in the list)
bun migrate
```
