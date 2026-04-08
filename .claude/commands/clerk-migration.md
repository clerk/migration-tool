---
description: Unified entry point for the Clerk user migration tool. Routes to the right skill based on your task (export, migrate, create transformer, or Clerk-to-Clerk migration).
---

Help the user with their Clerk user migration task.

## Workflow

### Step 1: Verify Environment

1. Check if dependencies are installed. If not, run `bun install`.
2. Check if `.env` exists with `CLERK_SECRET_KEY`. If missing, ask for the key (https://dashboard.clerk.com/~/api-keys) and create/update `.env`.

### Step 2: Identify task type

Analyze $ARGUMENTS to determine the task:

| User wants to...                                 | Skill to use           |
| ------------------------------------------------ | ---------------------- |
| Export users from a source platform              | `/export`              |
| Import/migrate users into Clerk from a file      | `/migrate`             |
| Create a custom transformer for unsupported data | `/transformer`         |
| Move users between Clerk instances (dev → prod)  | `/clerk-migration`     |
| Not sure / general help                          | Show the options below |

If the task is unclear, present the options:

> I can help with these migration tasks:
>
> 1. **Export users** — Export from Auth0, AuthJS, Better Auth, Clerk, Firebase, or Supabase (`/export`)
> 2. **Migrate users** — Import users into Clerk from a JSON/CSV file (`/migrate`)
> 3. **Create a transformer** — Generate a custom transformer for unsupported data formats (`/transformer`)
> 4. **Clerk-to-Clerk migration** — Move users between Clerk instances, e.g. dev → prod (`/clerk-migration`)
>
> What would you like to do?

### Step 3: Load the appropriate skill

Based on the identified task, load the skill:

- **Export**: `skill({ name: 'export' })`
- **Migrate**: `skill({ name: 'migrate' })`
- **Transformer**: `skill({ name: 'transformer' })`
- **Clerk-to-Clerk**: `skill({ name: 'clerk-migration' })`

### Step 4: Execute task

Follow the loaded skill's instructions to complete the user's request.

### Step 5: Summarize

After the task completes, summarize what was done:

- Number of users exported/migrated
- Any errors or warnings from the logs
- Suggested next steps (e.g., "run `bun migrate`" after an export)

<user-request>
$ARGUMENTS
</user-request>
