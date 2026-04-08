# AI Prompt for Exporting Users

Use this prompt with an AI assistant to export users from your current authentication platform to a JSON file compatible with the migration tool.

---

## Prompt Template

Copy and paste the following prompt, replacing `[PLATFORM]` with your source platform (or leave blank for auto-detection):

````
I want to export users from my authentication platform so I can migrate them to Clerk. Please help me run the export.

Platform: [PLATFORM or "not sure"]

## Instructions

Follow these steps EXACTLY in order. Do NOT skip any steps.

### Step 1: Verify Environment

Before proceeding:
1. Check if dependencies are installed. If not, use `bun install` to install them.
2. Identify the source platform. If the user specified a platform, use it. Otherwise, ask which platform they're exporting from.

### Step 2: Determine Platform and Requirements

Based on the platform, verify the required configuration:

| Platform | Required Configuration |
|----------|----------------------|
| **Auth0** | Auth0 domain, client ID, client secret (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` in `.env` or `--domain`, `--client-id`, `--client-secret` flags) |
| **AuthJS** | Database connection string (`AUTHJS_DB_URL` in `.env` or `--db-url` flag). Supports PostgreSQL, MySQL, and SQLite. |
| **Better Auth** | Database connection string (`BETTER_AUTH_DB_URL` in `.env` or `--db-url` flag). Supports PostgreSQL, MySQL, and SQLite. |
| **Clerk** | `CLERK_SECRET_KEY` in `.env` (Clerk Dashboard → API Keys → Secret keys, or https://dashboard.clerk.com/~/api-keys) |
| **Firebase** | Firebase service account JSON key file (`GOOGLE_APPLICATION_CREDENTIALS` in `.env` or `--service-account` flag) |
| **Supabase** | PostgreSQL connection string (`SUPABASE_DB_URL` in `.env` or `--db-url` flag) |

If the required configuration is missing:
- For database platforms: ask for the connection string and suggest setting the environment variable
- For Clerk: ask for the secret key and create/update `.env`

**DO NOT** proceed until the required configuration is available.

### Step 3: Run the Export

Run the appropriate export command:

```bash
# Auth0
bun export:auth0

# AuthJS
bun export:authjs

# Better Auth
bun export:betterauth

# Clerk
bun export:clerk

# Firebase
bun export:firebase

# Supabase
bun export:supabase

# Or use the interactive picker
bun export
```

For database exports, you can pass the connection string directly:
```bash
bun export:authjs -- --db-url postgresql://user:password@host:5432/database
bun export:betterauth -- --db-url postgresql://user:password@host:5432/database
bun export:supabase -- --db-url postgresql://postgres:password@db.xxx.supabase.co:5432/postgres
```

For Auth0, you can pass credentials directly:
```bash
bun export:auth0 -- --domain my-tenant.us.auth0.com --client-id xxx --client-secret xxx
```

For Firebase, you can pass the service account path:
```bash
bun export:firebase -- --service-account /path/to/service-account.json
```

### Step 4: Verify Output and Explain Field Coverage

After the export completes:
1. Report the number of users exported
2. Explain the field coverage summary:
   - Green ● = all users have this field
   - Yellow ○ = some users have this field
   - Dim ○ = no users have this field
3. Note any fields with low coverage that may need attention

### Step 5: Guide to Next Step

Tell the user how to use the exported file with the migration tool:
```bash
bun migrate
```

Then select the appropriate transformer and point to the exported file in the `exports/` directory.

If `CLERK_SECRET_KEY` is not yet configured (for database-only exports), remind the user to set it up before running the migration.
````

---

## Platform Reference

### Auth0

- **Environment variables**: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`
- **CLI flags**: `--domain`, `--client-id`, `--client-secret`
- **Requires**: Auth0 Management API access (Machine-to-Machine app with `read:users` scope)
- **API used**: `ManagementClient.users.getAll` with pagination (100 users per page)
- **Note**: Password hashes are NOT available from the Management API. Contact Auth0 support for a password hash export.
- **Output**: `exports/auth0-export.json`

### AuthJS

- **Environment variable**: `AUTHJS_DB_URL`
- **CLI flag**: `--db-url`
- **Requires**: Database access (PostgreSQL, MySQL, or SQLite)
- **Tables read**: `"User"`, `"Account"` (standard AuthJS Prisma adapter schema)
- **Table casing**: Tries PascalCase first, falls back to lowercase on failure
- **Output**: `exports/authjs-export.json`

### Better Auth

- **Environment variable**: `BETTER_AUTH_DB_URL`
- **CLI flag**: `--db-url`
- **Requires**: Database access (PostgreSQL, MySQL, or SQLite)
- **Tables read**: `"user"`, `"account"` (joined on `providerId = 'credential'`)
- **Plugin detection**: Automatically detects username, phone number, admin, and two-factor plugins
- **Output**: `exports/betterauth-export.json`

### Clerk

- **Environment variable**: `CLERK_SECRET_KEY`
- **Requires**: Clerk API access (secret key)
- **API used**: `getUserList` with pagination (500 users per page)
- **Note**: Passwords, TOTP secrets, and backup codes are NOT available from the API
- **Output**: `exports/clerk-export.json`

### Firebase

- **Environment variable**: `GOOGLE_APPLICATION_CREDENTIALS`
- **CLI flag**: `--service-account`
- **Requires**: Firebase Admin SDK access (service account JSON key file)
- **API used**: `admin.auth().listUsers` with pagination (1000 users per page)
- **Note**: Password hashes and salts are included when available. Use a project-level service account.
- **Output**: `exports/firebase-export.json`

### Supabase

- **Environment variable**: `SUPABASE_DB_URL`
- **CLI flag**: `--db-url`
- **Requires**: PostgreSQL database access (direct or pooler connection)
- **Table read**: `auth.users`
- **Note**: Direct connections require the IPv4 add-on; pooler connections work without it
- **Output**: `exports/supabase-export.json`

---

## Example Conversations

### Example 1: Successful Supabase Export

**User:** I want to export my Supabase users

**AI checks environment:**

> I'll help you export users from Supabase. I need a PostgreSQL connection string to connect to your Supabase database.
>
> You can find this in the Supabase Dashboard by clicking the **Connect** button:
>
> - **Direct connection** (requires IPv4 add-on): `postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres`
> - **Pooler connection** (works without IPv4): `postgres://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`
>
> Please provide your connection string, or set `SUPABASE_DB_URL` in your `.env` file.

**User:** postgresql://postgres:mypassword@db.abc123.supabase.co:5432/postgres

**AI runs export:**

> Running the export...
>
> ```bash
> bun export:supabase -- --db-url "postgresql://postgres:mypassword@db.abc123.supabase.co:5432/postgres"
> ```
>
> Export complete! Found 1,247 users:
>
> - ● 1247/1247 have email
> - ● 1247/1247 email confirmed
> - ● 1247/1247 have password hash
> - ○ 89/1247 have phone
> - ○ 1102/1247 have first name
> - ○ 987/1247 have last name
>
> The file was saved to `exports/supabase-export.json`.
>
> **Next step:** Run `bun migrate` and select "Supabase" with the file `exports/supabase-export.json`. Make sure `CLERK_SECRET_KEY` is set in your `.env` file first.

---

### Example 2: Missing Environment Variable

**User:** Export my Clerk users

**AI checks environment:**

> To export from Clerk, I need your `CLERK_SECRET_KEY`. I don't see it in the `.env` file.
>
> You can find it in the [Clerk Dashboard](https://dashboard.clerk.com/) → API Keys → Secret keys.
>
> Please provide your secret key.

**User:** sk_test_abc123...

**AI creates .env and runs export:**

> I've added `CLERK_SECRET_KEY` to your `.env` file. Running the export now...

---

## Post-Export

After exporting, use the file with the migration tool:

```bash
# Start migration (interactive)
bun migrate

# Or non-interactive
bun migrate -y --transformer supabase --file exports/supabase-export.json
```

### Troubleshooting

**Connection refused / ETIMEDOUT**: For Supabase, try using a pooler connection string instead of a direct connection. Direct connections require the IPv4 add-on.

**Permission denied**: Ensure you're connecting with the `postgres` role, not an application-level role.

**Table does not exist**: For Better Auth, ensure the database has been migrated (`npx @better-auth/cli migrate`). For AuthJS, ensure Prisma migrations have run. For Supabase, ensure Auth is enabled in the Dashboard.

**Auth0 Unauthorized (401/403)**: Verify your Machine-to-Machine application has the `read:users` scope enabled in the Auth0 Dashboard.

**Firebase INVALID_CREDENTIAL**: Ensure your service account JSON file is valid and for the correct project. Download a fresh key from the Firebase Console → Project Settings → Service Accounts.
