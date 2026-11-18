# Clerk User Migration Tool (deprecated)

> [!WARNING]
> This tool is deprecated. Use `clerk migrate` in the [Clerk CLI](https://github.com/clerk/cli) instead.

- [Migrate to Clerk docs](https://clerk.com/docs/guides/development/migrating/overview): guides for each supported platform, for moving users between Clerk instances, and for writing a custom source for other platforms. AWS Cognito has its own guide; it uses a password migrator instead of `clerk migrate`.
- [Clerk CLI](https://github.com/clerk/cli#installation): install the CLI, then run `clerk migrate -h`.
- [Clerk plugin](https://github.com/clerk/skills#install): its `clerk-migrate` skill covers supported platforms and custom sources for any other platform.
- [Clerk Skills](https://github.com/clerk/skills#agent-skills): installs `clerk-migrate` and the other skills without the plugin.

## Last version of the tool

To get the last version of `migration-tool` before deprecation, clone the repo and check out commit `bbf7558`:

```sh
git clone https://github.com/clerk/migration-tool && git -C migration-tool checkout bbf75584668e9f10a239b545adbce57e1308c974
```
