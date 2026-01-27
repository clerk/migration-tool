import 'dotenv/config';
import { createClerkClient } from '@clerk/backend';
import type { User } from '@clerk/backend';
import type { ClerkAPIError } from '@clerk/types';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
	createImportFilePath,
	getDateTimeStamp,
	getFileType,
	getRetryDelay,
	tryCatch,
} from '../utils';
import { env, MAX_RETRIES, RETRY_DELAY_MS } from '../envs-constants';
import { closeAllStreams, deleteErrorLogger, deleteLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import csvParser from 'csv-parser';
import pLimit from 'p-limit';

const LIMIT = 500;
const users: User[] = [];
const s = p.spinner();
let total: number;
let count = 0;
let failed = 0;

/**
 * Reads the .settings file to get the migration source file path
 * @returns The file path of the migration source
 * @throws Exits the process if .settings file is not found or missing the file property
 */
export const readSettings = (): string => {
	const settingsPath = path.join(process.cwd(), '.settings');

	if (!fs.existsSync(settingsPath)) {
		p.log.error(
			color.red(
				'No migration has been performed yet. Unable to find .settings file with migration source.'
			)
		);
		process.exit(1);
	}

	const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
		file?: string;
	};

	if (!settings.file) {
		p.log.error(
			color.red(
				'No migration source found in .settings file. Please perform a migration first.'
			)
		);
		process.exit(1);
	}

	return settings.file;
};

/**
 * Reads a migration file and extracts user IDs
 * Supports both JSON and CSV files
 * @param filePath - The relative path to the migration file
 * @returns A Promise that resolves to a Set of user IDs from the migration file
 * @throws Exits the process if the migration file is not found
 */
export const readMigrationFile = async (
	filePath: string
): Promise<Set<string>> => {
	const fullPath = createImportFilePath(filePath);

	if (!fs.existsSync(fullPath)) {
		p.log.error(color.red(`Migration file not found at: ${fullPath}`));
		process.exit(1);
	}

	const type = getFileType(fullPath);
	const userIds = new Set<string>();

	// Handle CSV files
	if (type === 'text/csv') {
		return new Promise((resolve, reject) => {
			fs.createReadStream(fullPath)
				.pipe(csvParser({ skipComments: true }))
				.on('data', (data: { id?: string }) => {
					// CSV files have 'id' column for user IDs
					if (data.id) {
						userIds.add(data.id);
					}
				})
				.on('error', (err) => {
					p.log.error(color.red(`Error reading CSV file: ${err.message}`));
					reject(err);
				})
				.on('end', () => {
					resolve(userIds);
				});
		});
	}

	// Handle JSON files
	const fileContent = fs.readFileSync(fullPath, 'utf-8');
	const users = JSON.parse(fileContent) as Array<{
		userId?: string;
		id?: string;
	}>;

	// Extract user IDs from the migration file
	for (const user of users) {
		// JSON files have 'userId' property
		if (user.userId) {
			userIds.add(user.userId);
		}
		// Also check for 'id' property as fallback
		else if (user.id) {
			userIds.add(user.id);
		}
	}

	return userIds;
};

/**
 * Recursively fetches all users from Clerk, paginating through results
 * @param offset - The offset for pagination (starts at 0)
 * @returns An array of all Clerk users
 */
export const fetchUsers = async (offset: number): Promise<User[]> => {
	// Clear the users array on the initial call (offset 0)
	if (offset === 0) {
		users.length = 0;
	}

	const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
	const { data } = await clerk.users.getUserList({ offset, limit: LIMIT });

	if (data.length > 0) {
		for (const user of data) {
			users.push(user);
		}
	}

	if (data.length === LIMIT) {
		// No delay needed - pagination is sequential by design
		return fetchUsers(offset + LIMIT);
	}

	return users;
};

/**
 * Finds the intersection of Clerk users and migration file users
 *
 * Matches Clerk users whose externalId matches a userId in the migration file.
 * This identifies which migrated users exist in Clerk.
 *
 * @param clerkUsers - Array of users fetched from Clerk
 * @param migrationUserIds - Set of user IDs from the migration file
 * @returns Array of Clerk users that were part of the migration
 */
export const findIntersection = (
	clerkUsers: User[],
	migrationUserIds: Set<string>
) => {
	return clerkUsers.filter((user) => {
		// Match Clerk user's externalId with migration file's userId
		return user.externalId && migrationUserIds.has(user.externalId);
	});
};

// Track error messages and counts
const errorCounts = new Map<string, number>();

/**
 * Normalizes error messages by sorting field arrays to group similar errors
 *
 * Example: Converts both:
 * - ["first_name" "last_name"] data doesn't match...
 * - ["last_name" "first_name"] data doesn't match...
 * into: ["first_name" "last_name"] data doesn't match...
 *
 * @param errorMessage - The original error message
 * @returns The normalized error message with sorted field arrays
 */
export function normalizeErrorMessage(errorMessage: string): string {
	// Match array-like patterns in error messages: ["field1" "field2"]
	const arrayPattern = /\[([^\]]+)\]/g;

	return errorMessage.replace(arrayPattern, (_match, fields: string) => {
		// Split by spaces and quotes, filter out empty strings
		const fieldNames = fields
			.split(/["'\s]+/)
			.filter((f: string) => f.trim().length > 0);

		// Sort field names alphabetically
		fieldNames.sort();

		// Reconstruct the array notation
		return `[${fieldNames.map((f: string) => `"${f}"`).join(' ')}]`;
	});
}

/**
 * Deletes a single user from Clerk with retry logic for rate limits
 *
 * @param user - The Clerk user to delete
 * @param dateTime - Timestamp for error logging
 * @param retryCount - Current retry attempt count (default 0)
 * @returns A promise that resolves when the user is deleted
 */
const deleteUser = async (
	user: User,
	dateTime: string,
	retryCount: number = 0
): Promise<void> => {
	const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
	const [, error] = await tryCatch(clerk.users.deleteUser(user.id));

	if (error) {
		// Check for rate limit error (429)
		const clerkError = error as {
			status?: number;
			errors?: ClerkAPIError[];
			message?: string;
		};

		if (clerkError.status === 429) {
			// Extract Retry-After value from response (in seconds)
			// @ts-expect-error - this does exist despite the type error
			const retryAfterSeconds = clerkError.errors?.[0]?.meta?.retryAfter as
				| number
				| undefined;

			if (retryCount < MAX_RETRIES) {
				// Calculate retry delay using shared utility function
				const { delayMs, delaySeconds } = getRetryDelay(
					retryAfterSeconds,
					RETRY_DELAY_MS
				);

				// Log retry attempt
				const retryMessage = `Rate limit hit (429), retrying in ${delaySeconds}s (attempt ${retryCount + 1}/${MAX_RETRIES})`;

				deleteErrorLogger(
					{
						userId: user.externalId || user.id,
						status: '429_retry',
						errors: [
							{
								code: 'rate_limit_retry',
								message: retryMessage,
								longMessage: retryMessage,
							},
						],
					},
					dateTime
				);

				// Wait before retrying
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				return deleteUser(user, dateTime, retryCount + 1);
			}

			// Max retries exceeded - log as permanent failure
			const errorMessage = `Rate limit exceeded after ${MAX_RETRIES} retries`;
			failed++;
			const normalizedError = normalizeErrorMessage(errorMessage);
			errorCounts.set(
				normalizedError,
				(errorCounts.get(normalizedError) ?? 0) + 1
			);

			// Log to delete log file
			deleteLogger(
				{
					userId: user.externalId || user.id,
					status: 'error',
					error: errorMessage,
					code: '429',
				},
				dateTime
			);
		} else {
			// Non-429 error
			failed++;
			const errorMessage = clerkError.message || 'Unknown error';
			const normalizedError = normalizeErrorMessage(errorMessage);
			errorCounts.set(
				normalizedError,
				(errorCounts.get(normalizedError) ?? 0) + 1
			);

			// Log to delete log file
			deleteLogger(
				{
					userId: user.externalId || user.id,
					status: 'error',
					error: errorMessage,
					code: String(clerkError.status ?? 'unknown'),
				},
				dateTime
			);
		}
	} else {
		count++;

		// Log successful deletion
		deleteLogger(
			{ userId: user.externalId || user.id, status: 'success' },
			dateTime
		);
	}

	const processed = count + failed;
	s.message(
		`Deleting users: [${processed}/${total}] (${count} successful, ${failed} failed)`
	);
};

/**
 * Deletes an array of users from Clerk
 *
 * Deletes users concurrently with rate limiting.
 * Updates a spinner progress message after each deletion.
 * Logs any errors that occur during deletion.
 *
 * @param users - Array of Clerk users to delete
 * @param dateTime - Timestamp for error logging
 * @returns A promise that resolves when all users are processed
 */
export const deleteUsers = async (users: User[], dateTime: string) => {
	// Reset error counts
	errorCounts.clear();

	s.message(`Deleting users: [0/${total}]`);

	// Set up concurrency limiter
	const limit = pLimit(env.CONCURRENCY_LIMIT);

	// Process all users concurrently with the limit
	const promises = users.map((user) => limit(() => deleteUser(user, dateTime)));

	await Promise.all(promises);

	// Close all log streams
	closeAllStreams();

	const summaryMessage =
		failed > 0
			? `Deleted ${count} users (${failed} failed)`
			: `Deleted ${count} users`;
	s.stop(summaryMessage);
};

/**
 * Displays a formatted summary of the deletion operation
 *
 * Shows:
 * - Total users processed
 * - Successful deletions
 * - Failed deletions
 * - Breakdown of errors by type (wrapped to 75 characters)
 */
const displaySummary = () => {
	if (failed === 0) {
		// No summary needed if all succeeded
		return;
	}

	let message = `Total users processed: ${total}\n`;
	message += `${color.green('Successfully deleted:')} ${count}\n`;
	message += `${color.red('Failed with errors:')} ${failed}`;

	if (errorCounts.size > 0) {
		message += `\n\n${color.bold('Error Breakdown:')}\n`;
		for (const [error, errorCount] of errorCounts) {
			const prefix = `${color.red('•')} ${errorCount} user${errorCount === 1 ? '' : 's'}: `;
			message += `${prefix}${error}\n`;
		}
	}

	p.note(message.trim(), 'Deletion Summary');
};

/**
 * Main function to process and delete migrated users
 *
 * Workflow:
 * 1. Reads the migration source file from .settings
 * 2. Extracts user IDs from the migration file
 * 3. Fetches all users from Clerk
 * 4. Finds the intersection (migrated users that exist in Clerk)
 * 5. Deletes the intersecting users
 *
 * @returns A promise that resolves when the deletion process is complete
 */
export const processUsers = async () => {
	p.intro(
		`${color.bgCyan(color.black('Clerk User Migration Utility - Deleting Migrated Users'))}`
	);

	// Read settings and migration file
	const migrationFilePath = readSettings();
	s.start();
	s.message('Reading migration file');
	const migrationUserIds = await readMigrationFile(migrationFilePath);
	s.stop(`Found ${migrationUserIds.size} users in migration file`);

	// Fetch Clerk users
	s.start();
	s.message('Fetching current user list from Clerk');
	const allClerkUsers = await fetchUsers(0);
	s.stop(`Found ${allClerkUsers.length} users in Clerk`);

	// Find intersection
	s.start();
	s.message(
		'Finding users to delete (intersection of migrated users and Clerk users)'
	);
	const usersToDelete = findIntersection(allClerkUsers, migrationUserIds);
	total = usersToDelete.length;
	s.stop(`Found ${total} migrated users to delete`);

	if (total === 0) {
		p.log.info(
			color.yellow('No migrated users found in Clerk. Nothing to delete.')
		);
		p.outro('User deletion complete');
		return;
	}

	// Delete users
	const dateTime = getDateTimeStamp();
	s.start();
	await deleteUsers(usersToDelete, dateTime);

	// Display summary if there were errors
	displaySummary();

	p.outro('User deletion complete');
};

// Only run if not in test environment
if (process.env.VITEST !== 'true') {
	processUsers().catch((error: Error) => {
		p.log.error(color.red('\nError during user deletion:'));
		p.log.error(color.red(error.message));
		if (error.stack) {
			p.log.error(error.stack);
		}
		process.exit(1);
	});
}
