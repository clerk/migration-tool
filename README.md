# Clerk User Migration Tool

## Description

This repository contains a tool that takes a JSON file as input, containing a list of users, and creates a user in Clerk using Clerk's backend API. The tool respects rate limits and handles errors.

## Table of Contents

- [Getting Started](#getting-started)
- [Exporting Users](#exporting-users)
- [Migrating OAuth Connections](#migrating-oauth-connections)
- [Handle Existing User IDs and Foreign Key Constraints](#handle-existing-user-ids-and-foreign-key-constraints)
- [Configuration](#configuration)
- [Commands](#commands)
- [Convert Logs Utility](#convert-logs-utility)

### Documentation

- [Exporting Users](docs/exporting-users.md)
- [Schema Fields Reference](docs/schema-fields.md)
- [Creating Custom Transformers](docs/creating-transformers.md)
- [AI Migration Prompt](prompts/migration-prompt.md)
- [AI Transformer Generation Prompt](prompts/transformer-prompt.md)
- [AI Export Prompt](prompts/export-prompt.md)

## Getting Started

Clone the repository and install the dependencies.

```bash
git clone git@github.com:clerk/migration-tool

cd migration-tool

bun install
```

### Users file

The tool is designed to import from multiple sources, including moving users from one Clerk instance to another. You may need to edit the transformer for your source. Please see below for more information on that.

The tool will import from a CSV or JSON. It accounts for empty fields in a CSV and will remove them when converting from CSV to a javascript object.

The only required fields are `userId` and an identifier (one of `email`, `phone` or `username`).

#### Samples

The samples/ folder contains some samples you can test with. The samples include issues that will produce errors when running the import.

Some sample users have passwords. The password is `Kk4aPMeiaRpAs2OeX1NE`.

### Secret Key

You have several options for providing your Clerk secret key:

**Option 1: Create a `.env` file** (recommended for repeated use)

```bash
CLERK_SECRET_KEY=your-secret-key
```

**Option 2: Pass via command line** (useful for automation/AI agents)

```bash
bun migrate --clerk-secret-key sk_test_xxx
```

**Option 3: Set environment variable**

```bash
export CLERK_SECRET_KEY=sk_test_xxx
bun migrate
```

**Option 4: Enter interactively**

If no key is found, the interactive CLI will prompt you to enter one and optionally save it to a `.env` file.

You can find your secret key in the [Clerk Dashboard](https://dashboard.clerk.dev/) under **API Keys**.

### Run the tool

```bash
bun migrate
```

The tool will begin processing users and attempting to import them into Clerk. The tool respects rate limits for the Clerk Backend API. If the tool hits a rate limit, it will wait 10 seconds and retry (up to 5 times). Any errors will be logged to timestamped log files in the `./logs` folder.

The tool can be run on the same data multiple times. Clerk automatically uses the email as a unique key so users won't be created again.

**Error Handling & Resuming**: If the migration stops for any reason (error, interruption, etc.), the tool will display the last processed user ID. You can resume the migration from that point by providing the user ID when prompted, or by using:

```bash
bun migrate --resume-after="user_xxx"
```

## CLI Reference

The migration tool supports both interactive and non-interactive modes.

### Usage

```bash
bun migrate [OPTIONS]
```

### Options

| Option                            | Description                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `-t, --transformer <transformer>` | Source transformer (clerk, auth0, authjs, firebase, supabase)                            |
| `-f, --file <path>`               | Path to the user data file (JSON or CSV)                                                 |
| `-r, --resume-after <userId>`     | Resume migration after this user ID                                                      |
| `--require-password`              | Only migrate users who have passwords (by default, users without passwords are migrated) |
| `--skip-unsupported-providers`    | Skip users whose only providers are not enabled in Clerk (Supabase only, no prompt)      |
| `-y, --yes`                       | Non-interactive mode (skip all confirmations)                                            |
| `-h, --help`                      | Show help message                                                                        |

### Authentication Options

| Option                     | Description                                 |
| -------------------------- | ------------------------------------------- |
| `--clerk-secret-key <key>` | Clerk secret key (alternative to .env file) |

### Firebase Options

Required when `--transformer` is `firebase`:

| Option                            | Description                       |
| --------------------------------- | --------------------------------- |
| `--firebase-signer-key <key>`     | Firebase hash signer key (base64) |
| `--firebase-salt-separator <sep>` | Firebase salt separator (base64)  |
| `--firebase-rounds <num>`         | Firebase hash rounds              |
| `--firebase-mem-cost <num>`       | Firebase memory cost              |

### Examples

```bash
# Interactive mode (default)
bun migrate

# Non-interactive mode with required options
bun migrate -y -t auth0 -f users.json

# Non-interactive with secret key (no .env needed)
bun migrate -y -t clerk -f users.json --clerk-secret-key sk_test_xxx

# Resume a failed migration
bun migrate -y -t clerk -f users.json -r user_abc123

# Firebase migration with hash config
bun migrate -y -t firebase -f users.csv \
  --firebase-signer-key "abc123..." \
  --firebase-salt-separator "Bw==" \
  --firebase-rounds 8 \
  --firebase-mem-cost 14
```

### Non-Interactive Mode

For automation and AI agent usage, use the `-y` flag with required options:

```bash
bun migrate -y \
  --transformer clerk \
  --file users.json \
  --clerk-secret-key sk_test_xxx
```

**Required in non-interactive mode:**

- `--transformer` (or `-t`)
- `--file` (or `-f`)
- `CLERK_SECRET_KEY` (via `--clerk-secret-key`, environment variable, or `.env` file)

## Exporting Users

The tool supports exporting users from multiple platforms. Exported files are saved to the `exports/` directory.

```bash
# Interactive platform picker
bun export

# Export directly from a specific platform
bun export:auth0
bun export:authjs
bun export:betterauth
bun export:clerk
bun export:firebase
bun export:supabase
```

### Auth0 Export

Exports all users from your Auth0 tenant via the Management API. Requires a Machine-to-Machine application with the `read:users` scope.

```bash
bun export:auth0
bun export:auth0 -- --domain my-tenant.us.auth0.com --client-id xxx --client-secret xxx
bun export:auth0 -- --output my-users.json
```

You can set `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_CLIENT_SECRET` in your `.env` file to avoid being prompted.

**Note:** Password hashes are not available from the Auth0 Management API. Contact Auth0 support to request a password hash export if you need to migrate passwords.

Output: `exports/auth0-export.json` (default)

### AuthJS Export

Exports all users from an AuthJS (Next-Auth) database. Supports PostgreSQL, MySQL, and SQLite databases.

```bash
bun export:authjs
bun export:authjs -- --db-url postgresql://user:password@host:5432/database
bun export:authjs -- --db-url mysql://user:password@host:3306/database
bun export:authjs -- --db-url /path/to/database.sqlite
bun export:authjs -- --output my-users.json
```

You can set `AUTHJS_DB_URL` in your `.env` file to avoid being prompted for the connection string.

The export reads from the standard AuthJS Prisma adapter tables (`User` and `Account`). If the PascalCase table names are not found, it retries with lowercase names automatically.

Output: `exports/authjs-export.json` (default)

### Better Auth Export

Exports all users from a Better Auth database to a JSON file. Supports PostgreSQL, MySQL, and SQLite databases. The export dynamically detects installed Better Auth plugins (username, phone number, admin, two-factor) and includes those columns when present.

```bash
bun export:betterauth
bun export:betterauth -- --db-url postgresql://user:password@host:5432/database
bun export:betterauth -- --db-url mysql://user:password@host:3306/database
bun export:betterauth -- --db-url /path/to/database.sqlite
bun export:betterauth -- --output my-users.json
```

You can set `BETTER_AUTH_DB_URL` in your `.env` file to avoid being prompted for the connection string.

The export joins the `"user"` table with the `"account"` table (filtered to `providerId = 'credential'`) to include password hashes. If you customized table names in your Better Auth config, you'll need to update the table references in the export module.

Output: `exports/betterauth-export.json` (default)

### Clerk Export

Exports all users from your Clerk instance to a JSON file. Requires `CLERK_SECRET_KEY` in your `.env` file or environment.

```bash
bun export:clerk
bun export:clerk -- --output my-users.json
```

The export includes all fields available from the Clerk API: emails, phones, usernames, names, metadata, and account settings. Note that passwords, TOTP secrets, and backup codes are **not** available from the API — only `passwordEnabled`, `totpEnabled`, and `backupCodeEnabled` booleans are included in the field coverage report.

Output: `exports/clerk-export.json` (default)

### Firebase Export

Exports all users from your Firebase project via the Admin SDK. Requires a service account JSON key file.

```bash
bun export:firebase
bun export:firebase -- --service-account /path/to/service-account.json
bun export:firebase -- --output my-users.json
```

You can set `GOOGLE_APPLICATION_CREDENTIALS` in your `.env` file to avoid being prompted for the service account path.

The export includes password hashes and salts when available. Ensure you're using a project-level service account for full access.

Output: `exports/firebase-export.json` (default)

### Supabase Export

See the [Exporting Users](docs/exporting-users.md) guide for Supabase setup, CLI options, and troubleshooting.

```bash
bun export:supabase
```

Output: `exports/supabase-export.json` (default)

## Migrating OAuth Connections

OAuth connections can not be directly migrated. The creation of the connection requires the user to consent, which can't happen on a migration like this. Instead you can rely on Clerk's [Account Linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking) to handle this.

## Handle Existing User IDs and Foreign Key Constraints

When migrating from another authentication system, you likely have data in your database tied to your previous system's user IDs. To maintain data consistency as you move to Clerk, you'll need a strategy to handle these foreign key relationships. Below are several approaches.

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

## Configuration

The tool can be configured through the following environment variables:

| Variable                        | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY`              | Your Clerk secret key (required)                                          |
| `CLERK_PUBLISHABLE_KEY`         | Clerk publishable key (enables automatic Dashboard config checking)       |
| `RATE_LIMIT`                    | Rate limit in requests/second (auto-configured: 100 for prod, 10 for dev) |
| `CONCURRENCY_LIMIT`             | Number of concurrent requests (auto-configured: ~9 for prod, ~1 for dev)  |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (enables OAuth provider cross-referencing)           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (enables OAuth provider cross-referencing)              |

The tool automatically detects production vs development instances from your `CLERK_SECRET_KEY` and sets appropriate rate limits and concurrency:

- **Production** (`sk_live_*`):
  - Rate limit: 100 requests/second (Clerk's limit: 1000 requests per 10 seconds)
  - Concurrency: 9 concurrent requests (~95% of rate limit with 100ms API latency)
  - Typical migration speed: ~3,500 users in ~35 seconds
- **Development** (`sk_test_*`):
  - Rate limit: 10 requests/second (Clerk's limit: 100 requests per 10 seconds)
  - Concurrency: 1 concurrent request (~95% of rate limit with 100ms API latency)
  - Typical migration speed: ~3,500 users in ~350 seconds

You can override these values by setting `RATE_LIMIT` or `CONCURRENCY_LIMIT` in your `.env` file.

**Tuning Concurrency**: If you want faster migrations, you can increase `CONCURRENCY_LIMIT` (e.g., `CONCURRENCY_LIMIT=15` for ~150 req/s). Note that higher concurrency may trigger rate limit errors (429), which are automatically retried.

## Commands

### Run migration

```bash
bun migrate
```

### Delete users

```bash
bun delete
```

This will delete all migrated users from the instance. It should not delete pre-existing users, but it is not recommended to use this with a production instance that has pre-existing users. Please use caution with this command.

### Clean logs

```bash
bun clean-logs
```

All migrations and deletions will create logs in the `./logs` folder. This command will delete those logs.

### Convert logs from NDJSON to JSON

```bash
bun convert-logs
```

## Convert Logs Utility

Converts NDJSON (Newline-Delimited JSON) log files to standard JSON array format for easier analysis in spreadsheets, databases, or other tools.

### Usage

```bash
bun convert-logs
```

The utility will:

1. List all `.log` files in the `./logs` directory
2. Let you select which files to convert
3. Create corresponding `.json` files with the converted data

### Example

**Input** (`migration-2026-01-27T12:00:00.log`):

```
{"userId":"user_1","status":"success","clerkUserId":"clerk_abc123"}
{"userId":"user_2","status":"error","error":"Email already exists"}
{"userId":"user_3","status":"fail","error":"invalid_type for required field.","path":["email"],"row":5}
```

**Output** (`migration-2026-01-27T12:00:00.json`):

```json
[
	{
		"userId": "user_1",
		"status": "success",
		"clerkUserId": "clerk_abc123"
	},
	{
		"userId": "user_2",
		"status": "error",
		"error": "Email already exists"
	},
	{
		"userId": "user_3",
		"status": "fail",
		"error": "invalid_type for required field.",
		"path": ["email"],
		"row": 5
	}
]
```

### Why NDJSON for Logs?

The tool uses NDJSON for log files because:

- **Streaming**: Can append entries as they happen without rewriting the file
- **Crash-safe**: If the process crashes, all entries written so far are valid
- **Memory efficient**: Can process line-by-line without loading entire log
- **Scalable**: Works efficiently with thousands or millions of entries
- **Real-time**: Can monitor with `tail -f` and see entries as they're written

### When to Convert

Convert logs to JSON arrays when you need to:

- Import into Excel, Google Sheets, or other spreadsheet tools
- Load into a database for analysis
- Process with tools that expect JSON arrays
- Share logs with team members less familiar with NDJSON

### Analyzing Logs

#### With NDJSON (original format)

```bash
# Count successful imports
grep '"status":"success"' logs/migration-2026-01-27T12:00:00.log | wc -l

# Find all errors
grep '"status":"error"' logs/migration-2026-01-27T12:00:00.log

# Get specific user
grep '"userId":"user_123"' logs/migration-2026-01-27T12:00:00.log
```

#### With JSON Arrays (converted format)

```javascript
// Load in Node.js/JavaScript
const logs = require('./logs/migration-2026-01-27T12:00:00.json');

// Filter successful imports
const successful = logs.filter((entry) => entry.status === 'success');

// Count errors by type
const errorCounts = logs
	.filter((entry) => entry.status === 'error')
	.reduce((acc, entry) => {
		acc[entry.error] = (acc[entry.error] || 0) + 1;
		return acc;
	}, {});
```

```python
# Load in Python
import json
with open('logs/migration-2026-01-27T12:00:00.json') as f:
    logs = json.load(f)

# Count by status
from collections import Counter
status_counts = Counter(entry['status'] for entry in logs)
```
