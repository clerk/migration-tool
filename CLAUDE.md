# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a CLI tool for migrating users from various authentication platforms (Clerk, Auth0, Supabase, AuthJS) to a Clerk instance. It handles rate limiting, validates user data with Zod schemas, and provides comprehensive logging of successes and failures.

## Common Commands

### Development Commands

- `bun migrate` - Start the migration process (interactive CLI)
- `bun delete` - Delete all migrated users (uses externalId to identify users)
- `bun clean-logs` - Remove all log files from the `./logs` folder
- `bun run test` - Run all tests with Vitest
- `bun lint` - Run ESLint
- `bun lint:fix` - Auto-fix ESLint issues
- `bun format` - Format code with Prettier
- `bun format:test` - Check formatting without making changes

### Testing

- `bun run test` - Run all test files
- `bun run test <filename>` - Run a specific test file (e.g., `bun test validators.test.ts`)
- `bun run test --watch` - Run tests in watch mode

## Architecture

### Handler System

The migration tool uses a **handler pattern** to support different source platforms. Each handler defines:

1. **Field Transformer**: Maps source platform fields to Clerk's schema
   - Example: Auth0's `_id.$oid` → Clerk's `userId`
   - Example: Supabase's `encrypted_password` → Clerk's `password`
   - Handles nested field flattening (see `flattenObjectSelectively` in `src/create/functions.ts`)

2. **Optional Default Fields**: Applied to all users from that platform
   - Example: Supabase defaults `passwordHasher` to `"bcrypt"`

3. **Optional Post-Transform**: Custom logic applied after field mapping
   - Example: Auth0 converts metadata from string to objects

**Handler locations**: `src/create/handlers/`

- `clerk.ts` - Clerk-to-Clerk migrations
- `auth0.ts` - Auth0 migrations
- `supabase.ts` - Supabase migrations
- `authjs.ts` - AuthJS migrations
- `index.ts` - Exports all handlers as array

**Adding a new handler**:

1. Create a new file in `src/create/handlers/` with transformer config
2. Export it in `src/create/handlers/index.ts`
3. The CLI will automatically include it in the platform selection

### Data Flow

```
User File (CSV/JSON)
  ↓
loadUsersFromFile (functions.ts)
  ↓ Parse file
  ↓ Apply handler defaults
  ↓
transformUsers (functions.ts)
  ↓ Transform field names via handler
  ↓ Apply handler postTransform
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

User validation is centralized in `src/create/validators.ts`:

- Uses Zod for schema validation
- Enforces: at least one verified identifier (email or phone)
- Enforces: passwordHasher required when password is present
- Fields can be single values or arrays (e.g., `email: string | string[]`)
- All fields except `userId` are optional

**Adding a new field**: Edit `userSchema` in `src/create/validators.ts`

### Rate Limiting

Rate limits are auto-configured based on instance type (detected from `CLERK_SECRET_KEY`):

- **Production** (`sk_live_*`): 1000 req/10s → 10ms delay
- **Development** (`sk_test_*`): 100 req/10s → 100ms delay

Configuration in `src/envs-constants.ts`:

- `DELAY` - Delay between normal requests
- `RETRY_DELAY_MS` - Additional delay when hitting 429 errors
- Override defaults via `.env` file

### Logging System

All operations create timestamped logs in `./logs/`:

- `{timestamp}-import.log` - Success/failure for each user
- `{timestamp}-import-errors.log` - Detailed error information
- `{timestamp}-delete.log` - User deletion results
- `{timestamp}-delete-errors.log` - Deletion errors

Logger functions in `src/logger.ts`:

- `importLogger()` - Log import attempt
- `errorLogger()` - Log creation errors
- `validationLogger()` - Log validation errors
- `deleteLogger()` - Log deletion attempt
- `deleteErrorLogger()` - Log deletion errors

### CLI Analysis Features

The CLI (in `src/create/cli.ts`) analyzes the import file before migration and provides:

1. **Identifier Analysis**: Shows which users have emails, phones, usernames
2. **Password Analysis**: Prompts whether to migrate users without passwords
3. **User Model Analysis**: Shows first/last name coverage
4. **Dashboard Configuration Guidance**: Tells user which fields to enable/require in Clerk Dashboard
5. **Instance Type Detection**: Prevents importing >500 users to dev instances

**Key CLI functions**:

- `runCLI()` - Main CLI orchestrator
- `analyzeFields()` - Analyzes user data for field coverage
- `displayIdentifierAnalysis()` - Shows identifier stats + Dashboard guidance
- `displayPasswordAnalysis()` - Shows password stats + prompts for skipPasswordRequirement
- `loadSettings()` / `saveSettings()` - Persists CLI choices in `.settings` file

### Error Handling

The codebase uses a consistent error handling pattern:

- `tryCatch()` utility (in `src/utils.ts`) - Returns `[result, null]` or `[null, error]`
- Used extensively to make additional emails/phones non-fatal
- Rate limit errors (429) trigger automatic retry with `cooldown()` delay
- Validation errors are logged but don't stop the migration

## Important Implementation Notes

### Clerk-to-Clerk Migrations

When migrating from Clerk to Clerk (`key === "clerk"`), the handler consolidates email and phone arrays:

- Merges `email`, `emailAddresses`, `unverifiedEmailAddresses` into single array
- Merges `phone`, `phoneNumbers`, `unverifiedPhoneNumbers` into single array
- First item becomes primary, rest are added as additional identifiers
- See `transformUsers()` in `src/create/functions.ts` around line 129

### Password Hasher Validation

Invalid password hashers cause immediate failure:

- Valid hashers are defined in `PASSWORD_HASHERS` constant (`src/types.ts`)
- Detection logic in `transformUsers()` checks if hasher exists but is invalid
- Throws detailed error with user ID, row number, and list of valid hashers

### User Creation Multi-Step Process

Creating a user involves multiple API calls:

1. Create user with primary email/phone + core fields
2. Add additional emails (non-fatal, logs warning on failure)
3. Add additional phones (non-fatal, logs warning on failure)

This is necessary because Clerk's API only accepts one primary identifier per creation call.

### Environment Variable Detection

The script auto-detects instance type from `CLERK_SECRET_KEY`:

- Checks if key contains `"live"` → production
- Otherwise → development
- Used to set default delays and enforce user limits
- See `detectInstanceType()` and `createEnvSchema()` in `src/envs-constants.ts`
