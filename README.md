# Clerk User Migration Tool (deprecated)

> [!WARNING]
> This tool is deprecated. Use `clerk migrate` in the [Clerk CLI](https://clerk.com/docs/cli) instead.

Install the CLI with npm:

```sh
npm install -g clerk
```

Or with Homebrew:

```sh
brew install clerk/stable/clerk
```

Then list the migrate commands and options:

```sh
clerk migrate -h
```

[Migrate to Clerk](https://clerk.com/docs/guides/development/migrating/overview) in the Clerk docs lists the supported platforms and links to a guide for each.

If you use a coding agent, install the Clerk plugin. Its `clerk-migrate` skill covers migrations from supported platforms and writing a custom source for any other platform. See [Clerk Skills](https://clerk.com/docs/guides/ai/skills) for installation.
