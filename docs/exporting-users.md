# Exporting Users

Some platforms require exporting users directly from their database before migrating to Clerk. This guide covers the available export commands and how to use them.

## Supabase

The Supabase export connects directly to your Supabase Postgres database and exports users from the `auth.users` table. This is the recommended approach because it includes `encrypted_password` (bcrypt hashes), which are not available through the Supabase Admin API.

### Prerequisites

- A Supabase project with **Auth enabled** (Authentication section in the Supabase Dashboard)
- A Postgres connection string from your Supabase project

### Getting Your Connection String

1. Open your Supabase project dashboard
2. Click the **Connect** button
3. Copy one of the connection strings below

**Pooler connection** (recommended):

```
postgres://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

**Direct connection** (requires the IPv4 add-on):

```
postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
```

Replace `[PASSWORD]` with your database password. If your password contains special characters (`@`, `#`, `%`, etc.), they must be URL-encoded (e.g. `@` becomes `%40`).

### Environment Variables

| Variable          | Description                |
| ----------------- | -------------------------- |
| `SUPABASE_DB_URL` | Postgres connection string |

Add this to your `.env` file to skip the interactive prompt:

```bash
SUPABASE_DB_URL=postgres://postgres.ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### Usage

```bash
bun export:supabase
```

If no connection string is found in environment variables, the CLI will prompt you to enter one.

### CLI Options

| Option            | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `--db-url <url>`  | Postgres connection string (takes priority over env vars) |
| `--output <path>` | Output file path (default: `supabase-export.json`)        |

```bash
# Specify connection string and output file
bun export:supabase --db-url "postgres://..." --output users.json
```

### Connection String Priority

The export resolves the connection string in this order:

1. `--db-url` CLI flag
2. `SUPABASE_DB_URL` environment variable
3. Interactive prompt

### Output

The export produces a JSON file (default: `supabase-export.json`) containing an array of user objects with the following fields:

| Field                | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `id`                 | Supabase user ID                                                   |
| `email`              | User email address                                                 |
| `email_confirmed_at` | Email verification timestamp                                       |
| `encrypted_password` | Bcrypt password hash                                               |
| `phone`              | Phone number                                                       |
| `phone_confirmed_at` | Phone verification timestamp                                       |
| `first_name`         | Extracted from `display_name`, `first_name`, or `name` in metadata |
| `last_name`          | Extracted from `last_name` in metadata                             |
| `raw_user_meta_data` | Full user metadata object                                          |
| `raw_app_meta_data`  | Full app metadata object                                           |
| `created_at`         | Account creation timestamp                                         |

After exporting, a field coverage summary shows how many users have each field populated.

### Next Step

Once the export is complete, run the migration:

```bash
bun migrate --transformer supabase --file supabase-export.json
```

### Troubleshooting

#### ENOTFOUND — hostname could not be resolved

The project ref in the connection string is incorrect. Verify it matches your Supabase project by checking the URL in your Supabase Dashboard.

#### ETIMEDOUT or ENETUNREACH — connection timed out

Direct connections (`db.[REF].supabase.co`) require the IPv4 add-on. Use a pooler connection instead, or enable IPv4 in Supabase Dashboard under Settings > Add-Ons.

#### Authentication failed

The database password is incorrect. Reset it in Supabase Dashboard under Settings > Database > Database Password. If the new password contains special characters, URL-encode them in the connection string.

#### Could not read from auth.users

The `auth.users` table is created automatically when Supabase Auth is enabled. Ensure Auth is enabled in Supabase Dashboard under Authentication, and that you are connecting with the `postgres` role (not an application-level role).

#### Connection string cannot be parsed as a URL

The connection string contains characters that break URL parsing. Ensure special characters in the password are URL-encoded:

| Character | Encoded |
| --------- | ------- |
| `@`       | `%40`   |
| `#`       | `%23`   |
| `%`       | `%25`   |
| `?`       | `%3F`   |
| space     | `%20`   |
