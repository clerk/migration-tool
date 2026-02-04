# AI Prompt for Generating Custom Transformers

Use this prompt with an AI assistant to generate a custom transformer from your sample user data.

---

## Prompt Template

Copy and paste the following prompt, replacing `[YOUR SAMPLE DATA]` with a sample of your user JSON or CSV data:

````
I need to create a custom transformer for the Clerk user migration script. Please analyze my sample user data and generate a transformer file.

## Sample User Data

[YOUR SAMPLE DATA]

## Requirements

1. Analyze the JSON/CSV structure to identify:
   - User ID field (maps to `userId`)
   - Email field(s) and verification status
   - Phone field(s) and verification status
   - Name fields (first name, last name, or combined name)
   - Password field and hash algorithm
   - Any metadata fields

2. Generate a complete transformer file following this structure:

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

## Testing Commands

After generating your transformer:

```bash
# Add the transformer to src/transformers/index.ts

# Test with the CLI
bun migrate

# Run validation tests
bun run test

# Check for lint errors
bun lint
```
