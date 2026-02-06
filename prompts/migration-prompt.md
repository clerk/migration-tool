# AI Prompt for Running Migrations

Use this prompt with an AI assistant to analyze your user data file and run the migration to Clerk.

---

## Prompt Template

Copy and paste the following prompt, replacing `[YOUR FILE PATH]` with the path to your user data file:

````
I want to migrate users to Clerk using the migration script. Please help me import the following file:

[YOUR FILE PATH]

## Instructions

1. **Analyze the file** - Read a sample of the file to understand its structure and identify the source platform.

2. **Match to an existing transformer** - Check if the data matches one of these platforms by looking for their signature fields:

   | Platform | Signature Fields |
   |----------|-----------------|
   | **Supabase** | `encrypted_password`, `email_confirmed_at`, `raw_user_meta_data`, `instance_id`, `aud`, `is_sso_user` |
   | **Auth0** | `user_id` (format: "provider\|id"), `email_verified` (boolean), `phone_number`, `phone_verified`, `user_metadata`, `app_metadata`, `given_name`, `family_name` |
   | **Firebase** | `localId`, `passwordHash`, `passwordSalt`, `displayName`, `phoneNumber`, `disabled` |
   | **Clerk** | `primary_email_address`, `verified_email_addresses`, `password_digest`, `password_hasher`, `primary_phone_number` |
   | **AuthJS** | `email_verified`, `name`, `id`, `email` (minimal - may need customization) |

3. **If a transformer matches:**
   - Check if `.env` exists with `CLERK_SECRET_KEY`
   - If not, ask me for the key (found in Clerk Dashboard → API Keys → Secret keys)
   - Create/update the `.env` file with the key
   - Tell me which transformer will be used and summarize what fields will be mapped
   - Ask if I want to proceed with the migration

4. **If no transformer matches:**
   - Tell me the data doesn't match any existing transformer
   - Point me to the transformer creation prompt at `prompts/transformer-prompt.md`
   - List the fields found in my data so I can use them with the transformer prompt

5. **Run the migration** (if I confirm):
   ```bash
   bun migrate -y --transformer [transformer-key] --file [file-path]
   ```

## Important Notes

- **Development instances** (`sk_test_*`): Limited to 10 requests/second
- **Production instances** (`sk_live_*`): 100 requests/second
- All operations are logged to `./logs/` with timestamps
- Failed validations are logged but don't stop the migration
- The script handles rate limiting and retries automatically
````

---

## Transformer Field Mapping Reference

### Supabase

```
id              → userId
email           → email (routed by email_confirmed_at)
encrypted_password → password
phone           → phone (routed by phone_confirmed_at)
raw_user_meta_data → publicMetadata
created_at      → createdAt
```

Default: `passwordHasher: "bcrypt"`

### Auth0

```
user_id         → userId
email           → email (routed by email_verified)
username        → username
given_name      → firstName
family_name     → lastName
phone_number    → phone (routed by phone_verified)
passwordHash    → password
user_metadata   → publicMetadata
app_metadata    → privateMetadata
created_at      → createdAt
```

Default: `passwordHasher: "bcrypt"`

### Firebase

```
localId         → userId
email           → email (routed by emailVerified)
passwordHash    → password (combined with salt and config)
passwordSalt    → (combined into password)
phoneNumber     → phone
displayName     → firstName + lastName (split)
```

Default: `passwordHasher: "scrypt_firebase"`

**Note:** Firebase migrations require hash configuration values (signer key, salt separator, rounds, mem_cost).

### Clerk (instance-to-instance)

```
id                        → userId
primary_email_address     → email
verified_email_addresses  → emailAddresses
unverified_email_addresses → unverifiedEmailAddresses
first_name                → firstName
last_name                 → lastName
password_digest           → password
password_hasher           → passwordHasher
primary_phone_number      → phone
verified_phone_numbers    → phoneNumbers
unverified_phone_numbers  → unverifiedPhoneNumbers
username                  → username
totp_secret               → totpSecret
backup_codes_enabled      → backupCodesEnabled
backup_codes              → backupCodes
public_metadata           → publicMetadata
unsafe_metadata           → unsafeMetadata
private_metadata          → privateMetadata
```

### AuthJS (Next-Auth)

```
id              → userId
email           → email (routed by email_verified)
name            → firstName + lastName (split)
created_at      → createdAt
updated_at      → updatedAt
```

**Note:** AuthJS has no standard export format. The transformer assumes a basic SQL export. Customize as needed.

---

## Example Conversations

### Example 1: Supabase Data (Transformer Matches)

**User:** I want to migrate `exports/users.json`

**AI analyzes file, finds Supabase fields:**

> Your file contains Supabase Auth data. I can see these signature fields:
>
> - `encrypted_password` (bcrypt hash)
> - `email_confirmed_at`
> - `raw_user_meta_data`
> - `instance_id`
>
> The **Supabase transformer** will map:
>
> - `id` → `userId`
> - `email` → verified/unverified based on `email_confirmed_at`
> - `encrypted_password` → `password` (with bcrypt hasher)
> - `raw_user_meta_data` → `publicMetadata`
>
> I don't see a `.env` file with `CLERK_SECRET_KEY`. Please provide your Clerk secret key.

**User:** sk_test_abc123...

**AI creates .env and asks:**

> Created `.env` with your secret key. Ready to migrate with:
>
> ```bash
> bun migrate --transformer supabase --file exports/users.json
> ```
>
> Would you like me to run the migration?

---

### Example 2: Unknown Data Format (No Match)

**User:** I want to migrate `data/custom-export.json`

**AI analyzes file, no match:**

> I analyzed your file and found these fields:
>
> - `user_uuid`
> - `contact_email`
> - `hashed_pw`
> - `is_email_verified`
> - `profile_data`
>
> This doesn't match any existing transformer. You'll need to create a custom one.
>
> Use the prompt in `prompts/transformer-prompt.md` with a sample of your data to generate a transformer. The AI will ask you about:
>
> 1. Email verification handling
> 2. Password hash algorithm
> 3. Metadata mapping
>
> Once created, add it to `src/transformers/index.ts` and run the migration.

---

## Post-Migration

After migration completes:

1. **Check logs** in `./logs/` for any errors
2. **Convert logs** for easier reading: `bun convert-logs`
3. **Verify users** in your Clerk Dashboard

To delete migrated users (uses `externalId` to identify):

```bash
bun delete
```
