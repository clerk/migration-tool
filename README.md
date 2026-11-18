# Clerk User Migration Tool (deprecated)

> [!WARNING]
> This tool is deprecated. Use `clerk migrate` in the [Clerk CLI](https://github.com/clerk/cli) instead.

The Clerk CLI exports your users, checks each one against your Clerk instance before it writes anything, and imports them. If something goes wrong, it can undo the import.

- [Migrate to Clerk docs](https://clerk.com/docs/guides/development/migrating/overview): a guide for each supported source (Auth0, Auth.js, Better Auth, Firebase, Supabase, WorkOS, and another Clerk instance), and for writing a custom source for any other platform.
- [Clerk CLI](https://github.com/clerk/cli#installation): install the CLI (4.2.0 or later, or run `clerk update`), then run `clerk migrate -h`.
- [`clerk-migrate` skill](https://github.com/clerk/skills#install): lets your AI coding agent run the migration with the Clerk CLI. It exports your users, runs a dry run, and imports only after you approve. Install it with the Clerk plugin or `npx skills add clerk/skills`.

## Last version of the tool

The last version of the tool is at [bbf7558](https://github.com/clerk/migration-tool/tree/bbf75584668e9f10a239b545adbce57e1308c974). To run it, clone the repo and check out that commit:

```sh
git clone https://github.com/clerk/migration-tool && git -C migration-tool checkout bbf75584668e9f10a239b545adbce57e1308c974
```
