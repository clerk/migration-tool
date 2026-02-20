# AI Prompt for Clerk Dev ↔ Production Migrations

Use this prompt with an AI assistant to migrate users between Clerk instances (e.g., development → production).

---

## Prompt Template

Copy and paste the following prompt:

````
I want to migrate users between Clerk instances (e.g., from my development instance to production). Please help me export from the source instance and import into the destination instance.

## Instructions

Follow these steps EXACTLY in order. Do NOT skip any steps.

### Step 1: Verify Environment

1. Check if dependencies are installed. If not, use `bun install` to install them.
2. Check if a `.env` file exists with `CLERK_SECRET_KEY`.
   - If missing, IMMEDIATELY ask for the key (Clerk Dashboard → API Keys → Secret keys, or https://dashboard.clerk.com/~/api-keys)
   - Create/update the `.env` file with the provided key
   - Do NOT proceed until the key is configured

### Step 2: Detect Instance Type

Use the Clerk API to determine the environment type of the current key:

```bash
curl -s https://api.clerk.com/v1/instance \
  --header "Authorization: Bearer $CLERK_SECRET_KEY"
```

Read `environment_type` from the response — it will be `"development"` or `"production"`.

Tell the user which instance type was detected.

### Step 3: Ensure the Source Key Is Active

The **source** instance is the one you are exporting users FROM.

- **If the detected instance is `development`** (the typical case — exporting dev → prod):
  The source key is already active. Proceed to Step 4.

- **If the detected instance is `production`** (the user wants to export from production, or provided a production key first):
  Ask the user for their **development** (or other source) secret key. Then:
  1. Update `.env`: comment out the current key with a label, and set the new key:
     ```
     # Production CLERK_SECRET_KEY (commented out for export step)
     # CLERK_SECRET_KEY=sk_live_...
     # Development CLERK_SECRET_KEY (active for export)
     CLERK_SECRET_KEY=sk_test_...
     ```
  2. Re-run the instance detection from Step 2 to confirm the new key is for the expected environment.
  3. Do NOT proceed until confirmed.

### Step 4: Export Users from the Source Instance

Follow the instructions in `prompts/export-prompt.md` to export users, selecting **Clerk** as the platform.

The export command is:
```bash
bun export:clerk
```

This will save users to `exports/clerk-export.json`.

After the export completes, report the user count and field coverage.

### Step 5: Switch to the Destination Key

The **destination** instance is the one you are importing users INTO.

1. Check `.env` for a commented-out key from Step 3 that matches the destination environment.
   - If found, uncomment it and comment out the current (source) key. Add labels:
     ```
     # Development CLERK_SECRET_KEY (commented out after export)
     # CLERK_SECRET_KEY=sk_test_...
     # Production CLERK_SECRET_KEY (active for import)
     CLERK_SECRET_KEY=sk_live_...
     ```
   - If NOT found, ask the user for the destination secret key and update `.env`.

2. Re-run the instance detection from Step 2 to confirm the key matches the destination environment.
3. Do NOT proceed until confirmed.

### Step 6: Import Users into the Destination Instance

Follow the instructions in `prompts/migration-prompt.md` to import users, using:
- **Transformer**: `clerk`
- **File**: `exports/clerk-export.json` (or whatever path was produced in Step 4)

The migration command is:
```bash
bun migrate -y --transformer clerk --file exports/clerk-export.json
```

### Step 7: Post-Migration

After migration completes:
1. Report the number of users successfully migrated
2. Report any failures or validation errors from the logs
3. Remind the user:
   - Verify users in the destination Clerk Dashboard
   - Passwords, TOTP secrets, and backup codes are NOT available from the Clerk export API — users with passwords will need to reset them
   - Run `bun delete` if you need to remove migrated users
   - Check `./logs/` for detailed logs, or run `bun convert-logs` for easier reading

## Important Notes

- **Password limitation**: The Clerk API does not expose password hashes, TOTP secrets, or backup codes. Users who signed in with a password on the source instance will need to use "Forgot password" or another recovery flow on the destination instance.
- **Rate limits**: Development instances allow ~10 req/s, production allows ~100 req/s. The tool handles rate limiting automatically.
- **External IDs**: Migrated users get an `externalId` set to their original user ID, which is how `bun delete` identifies them.

````

---

## Typical Flow Summary

```
1. Verify deps + CLERK_SECRET_KEY
2. Detect instance type (dev or prod)
3. Ensure source key is active
4. Export users (bun export:clerk)          ← see prompts/export-prompt.md
5. Switch .env to destination key
6. Import users (bun migrate)              ← see prompts/migration-prompt.md
7. Verify migration results
```

---

## Example Conversation

### Dev → Production (typical)

**User:** Migrate my users from development to production

**AI checks .env, detects development instance:**

> Dependencies are installed. I found `CLERK_SECRET_KEY` in your `.env` file.
>
> I checked the instance type and it's a **development** instance. I'll export users from here, then switch to your production key to import.
>
> Starting the Clerk export...

**AI runs export, gets 150 users, then asks:**

> Exported 150 users to `exports/clerk-export.json`.
>
> Now I need your **production** secret key to import the users. You can find it in the Clerk Dashboard → API Keys → Secret keys (make sure you're viewing the production instance): https://dashboard.clerk.com/~/api-keys

**User:** sk_live_abc123...

**AI updates .env, confirms production, runs migration:**

> Confirmed — this is a **production** instance. I've updated `.env` (your dev key is commented out and labeled).
>
> Running the migration...
>
> Migration complete! 148 users imported successfully, 2 failed (see logs).
>
> Note: Passwords are not available from the Clerk export API. Users who signed in with a password will need to use "Forgot password" on the production instance.
