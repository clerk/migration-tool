import 'dotenv/config';

import { parseArgs, runCLI, runNonInteractive } from './cli';
import { loadUsersFromFile } from './functions';
import { getLastProcessedUserId, importUsers } from './import-users';
import * as p from '@clack/prompts';
import color from 'picocolors';

/**
 * Main entry point for the user migration tool
 *
 * Workflow:
 * 1. Parses CLI arguments to determine mode (interactive vs non-interactive)
 * 2. Runs the appropriate CLI mode to gather migration parameters
 * 3. Loads and transforms users from the source file
 * 4. Filters users if resuming after a specific user ID
 * 5. Imports users to Clerk
 *
 * @returns A promise that resolves when migration is complete
 */
async function main() {
	const cliArgs = parseArgs(process.argv.slice(2));

	// Run in non-interactive mode if --yes flag is provided with required args
	const args = cliArgs.nonInteractive
		? await runNonInteractive(cliArgs)
		: await runCLI(cliArgs);

	// Load all users from file
	const { users, validationFailed } = await loadUsersFromFile(
		args.file,
		args.key
	);

	// Display validation failures if any
	if (validationFailed > 0) {
		p.log.warn(
			color.yellow(
				`${validationFailed} user${validationFailed === 1 ? '' : 's'} failed validation and will be skipped. See the migration log in logs/ for more details.`
			)
		);
	}

	// If resuming after a specific user ID, filter to start after that user
	let usersToImport = users;
	if (args.resumeAfter) {
		const resumeIndex = users.findIndex((u) => u.userId === args.resumeAfter);
		if (resumeIndex !== -1) {
			usersToImport = users.slice(resumeIndex + 1);
		}
	}

	await importUsers(
		usersToImport,
		args.skipPasswordRequirement,
		validationFailed
	);
}

main().catch((error: unknown) => {
	p.log.error(color.red('\nMigration failed with error:'));

	const errorMessage = error instanceof Error ? error.message : String(error);
	p.log.error(color.red(errorMessage));

	const lastUserId = getLastProcessedUserId();
	if (lastUserId) {
		p.log.warn(color.yellow(`Last processed user ID: ${lastUserId}`));
		p.note(
			`To resume this migration, use:\n  bun migrate --resume-after="${lastUserId}"`,
			'Resume Migration'
		);
	}

	if (error instanceof Error && error.stack) {
		p.log.error(error.stack);
	}
	process.exit(1);
});
