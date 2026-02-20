# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Overview

This is a CLI tool for migrating users from various authentication platforms (Clerk, Auth0, Supabase, AuthJS, Firebase) to a Clerk instance. It handles rate limiting, validates user data with Zod schemas, and provides comprehensive logging of successes and failures.

## Project Structure

```
src/
├── clean-logs/          # Log cleanup utility
├── convert-logs/        # NDJSON to JSON converter
├── delete/              # User deletion functionality
├── export/              # User export (Auth0, AuthJS, Better Auth, Clerk, Firebase, Supabase)
│   ├── index.ts         # Entry point (platform dispatcher)
│   ├── registry.ts      # Export registry (array-based, like transformers)
│   ├── auth0.ts         # Auth0 export (Management API → JSON)
│   ├── authjs.ts        # AuthJS export (DB query → JSON, supports PG/MySQL/SQLite)
│   ├── betterauth.ts    # Better Auth export (DB query → JSON, supports PG/MySQL/SQLite)
│   ├── clerk.ts         # Clerk export (API → JSON)
│   ├── firebase.ts      # Firebase export (Admin SDK → JSON)
│   └── supabase.ts      # Supabase export (Postgres → JSON)
├── lib/                 # Shared utilities and helpers
│   ├── index.ts         # General utils (file paths, tryCatch, transformKeys, etc.)
│   ├── db.ts            # Database abstraction (PostgreSQL, MySQL, SQLite)
│   ├── export.ts        # Shared export utils (coverage display, file writing, DB error hints)
│   ├── settings.ts      # Settings persistence (loadSettings, saveSettings)
│   ├── analysis.ts      # User data analysis (analyzeFields, validateUsers)
│   ├── supabase.ts      # Supabase provider analysis (fetchSupabaseProviders, etc.)
│   └── clerk.ts         # Clerk API helpers (detectInstanceType, fetchClerkConfig)
├── migrate/             # Main migration logic
│   ├── cli.ts           # Interactive CLI
│   ├── functions.ts     # Data loading and transformation
│   ├── import-users.ts  # User creation with Clerk API
│   ├── index.ts         # Entry point
│   └── validator.ts     # Zod schema validation
├── transformers/        # Platform-specific transformers
│   ├── index.ts         # Re-exports from registry
│   ├── registry.ts      # Transformer registry (array-based, like exports)
│   ├── auth0.ts
│   ├── authjs.ts
│   ├── betterauth.ts
│   ├── clerk.ts
│   ├── firebase.ts
│   └── supabase.ts
├── envs-constants.ts    # Environment configuration
├── logger.ts            # NDJSON logging
└── types.ts             # TypeScript types
```

## Common Commands

### Development Commands

- `bun migrate` - Start the migration process (interactive CLI)
- `bun export` - Export users (interactive platform picker)
- `bun export:auth0` - Export users from Auth0 tenant
- `bun export:authjs` - Export users from AuthJS database (PostgreSQL, MySQL, or SQLite)
- `bun export:betterauth` - Export users from Better Auth database (PostgreSQL, MySQL, or SQLite)
- `bun export:clerk` - Export users from Clerk instance
- `bun export:firebase` - Export users from Firebase project
- `bun export:supabase` - Export users from Supabase database
- `bun delete` - Delete all migrated users (uses externalId to identify users)
- `bun clean-logs` - Remove all log files from the `./logs` folder
- `bun convert-logs` - Convert NDJSON log files to JSON array format for easier analysis
- `bun run test` - Run all tests with Vitest
- `bun lint` - Run ESLint
- `bun lint:fix` - Auto-fix ESLint issues
- `bun format` - Format code with Prettier
- `bun format:test` - Check formatting without making changes

### Testing

- `bun run test` - Run all test files
- `bun run test <filename>` - Run a specific test file (e.g., `bun run test validator.test.ts`)
- `bun run test --watch` - Run tests in watch mode

## After Making Changes

Always run after changes:

- `bun lint:fix` - Fix linting issues
- `bun format` - Format code
- `bun run test` - Run all tests

When adding/modifying features, add or update tests in the corresponding test files.

Always perform these checks after **any** change.

## Architecture

### Transformer System

The migration tool uses a **transformer pattern** to support different source platforms. Each transformer defines:

1. **Field Transformer**: Maps source platform fields to Clerk's schema
   - Example: Auth0's `_id.$oid` → Clerk's `userId`
   - Example: Supabase's `encrypted_password` → Clerk's `password`
   - Handles nested field flattening (see `flattenObjectSelectively` in `src/lib/index.ts`)

2. **Optional Default Fields**: Applied to all users from that platform
   - Example: Supabase defaults `passwordHasher` to `"bcrypt"`

3. **Optional Pre-Transform**: Pre-processing before field transformation
   - Example: Firebase adds CSV headers or extracts users from JSON wrapper

4. **Optional Post-Transform**: Custom logic applied after field mapping
   - Example: Auth0 converts metadata from string to objects

**Transformer locations**: `src/transformers/`

**Adding a new transformer**:

1. Create a new file in `src/transformers/` with a transformer config satisfying `TransformerRegistryEntry`
2. Import and register it in `src/transformers/registry.ts`
3. The CLI will automatically include it in the platform selection

### Export System

The export tool (`src/export/`) exports users from various platforms to JSON files compatible with the migration tool.

**Architecture**:

- `registry.ts` — Registry of available exports (array-based, like transformers)
- `index.ts` — CLI entry point / dispatcher (reads from registry)
- `src/lib/export.ts` — Shared utilities (coverage display, file writing, DB error hints)
- `[platform].ts` — Platform-specific export logic

**Adding a new export**:

1. Create `src/export/[platform].ts` with an export function, display summary, and CLI wrapper (`runXxxExport`)
2. Register in `src/export/registry.ts`
3. Add `"export:[platform]"` script to `package.json`

### Data Flow

```
User File (CSV/JSON)
  ↓
loadUsersFromFile (functions.ts)
  ↓ Run preTransform (if defined)
  ↓ Parse file
  ↓ Apply transformer defaults
  ↓
transformUsers (functions.ts)
  ↓ Transform field names via transformer
  ↓ Apply transformer postTransform
  ↓ Validate with Zod schema
  ↓ Log validation errors
  ↓
importUsers (import-users.ts)
  ↓ Process sequentially with rate limiting
  ↓
createUser (import-users.ts)
  ↓ Create user with primary email/phone
  ↓ Add additional emails/phones
  ↓ Handle errors and logging
```

### Schema Validation

User validation is centralized in `src/migrate/validator.ts`:

- Uses Zod for schema validation
- Enforces: at least one identifier (email, phone, or username)
- Enforces: passwordHasher required when password is present
- Fields can be single values or arrays (e.g., `email: string | string[]`)
- All fields except `userId` are optional

**Adding a new field**: Edit `userSchema` in `src/migrate/validator.ts`

### Rate Limiting

Rate limits are auto-configured based on instance type (detected from `CLERK_SECRET_KEY`):

- **Production** (`sk_live_*`): 100 requests/second (Clerk's limit: 1000 req/10s)
- **Development** (`sk_test_*`): 10 requests/second (Clerk's limit: 100 req/10s)

Configuration in `src/envs-constants.ts`:

- `RATE_LIMIT` - Requests per second (auto-configured based on instance type)
- `CONCURRENCY_LIMIT` - Number of concurrent requests (defaults to ~95% of rate limit)
- Override defaults via `.env` file with `RATE_LIMIT` or `CONCURRENCY_LIMIT`

The tool uses **p-limit for concurrency control** across all API calls.

**Retry logic**:

- If a 429 occurs, uses Retry-After value from API response
- Falls back to 10 second default if Retry-After not available
- Centralized in `getRetryDelay()` function in `src/lib/index.ts`
- Automatically retries up to 5 times (configurable via MAX_RETRIES)

### Logging System

All operations create timestamped logs in `./logs/` using NDJSON (Newline-Delimited JSON) format:

- `{timestamp}-migration.log` - Combined log with all import entries
- `{timestamp}-user-deletion.log` - Combined log with all deletion entries
- `{timestamp}-export.log` - Combined log with all export entries

**Log Entry Types** (defined in `src/types.ts`):

- `ImportLogEntry` - Success/error for user imports
- `DeleteLogEntry` - Success/error for user deletions
- `ExportLogEntry` - Success/error for user exports
- `ValidationErrorPayload` - Validation failures with path and row
- `ErrorLog` - Additional identifier errors

### Error Handling

The codebase uses a consistent error handling pattern:

- `tryCatch()` utility (in `src/lib/index.ts`) - Returns `[result, error]` (error is null on success)
- Used extensively to make additional emails/phones non-fatal
- Rate limit errors (429) trigger automatic retry with delay
- Validation errors are logged but don't stop the migration

## Important Implementation Notes

### Clerk-to-Clerk Migrations

When migrating from Clerk to Clerk (`key === "clerk"`), the transformer consolidates email and phone arrays:

- Merges `email`, `emailAddresses`, `unverifiedEmailAddresses` into single array
- Merges `phone`, `phoneNumbers`, `unverifiedPhoneNumbers` into single array
- First item becomes primary, rest are added as additional identifiers
- See `transformUsers()` in `src/migrate/functions.ts`

### Password Hasher Validation

Invalid password hashers cause immediate failure:

- Valid hashers are defined in `PASSWORD_HASHERS` constant (`src/types.ts`)
- Detection logic in `transformUsers()` checks if hasher exists but is invalid
- Throws detailed error with user ID, row number, and list of valid hashers

### User Creation Multi-Step Process

Creating a user involves multiple API calls, all managed by the shared concurrency limiter:

1. Create user with primary email/phone + core fields (rate-limited)
2. Add additional emails (each rate-limited individually, non-fatal)
3. Add additional phones (each rate-limited individually, non-fatal)

This is necessary because Clerk's API only accepts one primary identifier per creation call.

### Environment Variable Detection

The tool auto-detects instance type from `CLERK_SECRET_KEY`:

- Checks if key contains `"live"` → production
- Otherwise → development
- Used to set default delays and enforce user limits
- See `detectInstanceType()` and `createEnvSchema()` in `src/envs-constants.ts`

## Additional Documentation

- [docs/schema-fields.md](docs/schema-fields.md) - Complete field reference
- [docs/creating-transformers.md](docs/creating-transformers.md) - Transformer development guide
- [prompts/migration-prompt.md](prompts/migration-prompt.md) - AI prompt for running migrations
- [prompts/transformer-prompt.md](prompts/transformer-prompt.md) - AI prompt for generating transformers
- [prompts/export-prompt.md](prompts/export-prompt.md) - AI prompt for exporting users
