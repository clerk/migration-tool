import 'dotenv/config';

import { env } from '../envs-constants';
import { runCLI } from './cli';
import { loadUsersFromFile } from './functions';
import { importUsers } from './import-users';

/**
 * Main entry point for the user migration script
 *
 * Workflow:
 * 1. Runs the CLI to gather migration parameters
 * 2. Loads and transforms users from the source file
 * 3. Applies offset if specified
 * 4. Imports users to Clerk
 *
 * @returns A promise that resolves when migration is complete
 */
async function main() {
	const args = await runCLI();

	// we can use Zod to validate the args.keys to ensure it is TransformKeys type
	const users = await loadUsersFromFile(args.file, args.key);

	const usersToImport = users.slice(
		parseInt(args.offset) > env.OFFSET ? parseInt(args.offset) : env.OFFSET
	);

	importUsers(usersToImport, args.skipPasswordRequirement);
}

main();
