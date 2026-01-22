import { createClerkClient } from '@clerk/backend';
import { ClerkAPIError } from '@clerk/types';
import { env } from '../envs-constants';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { errorLogger, importLogger, closeAllStreams } from '../logger';
import { getDateTimeStamp, tryCatch } from '../utils';
import { userSchema } from './validator';
import { ImportSummary, User } from '../types';
import pLimit from 'p-limit';

const s = p.spinner();
let processed = 0;
let successful = 0;
let failed = 0;
const errorCounts = new Map<string, number>();
let lastProcessedUserId: string | null = null;

/**
 * Gets the last processed user ID
 * @returns The user ID of the last processed user, or null if none processed
 */
export const getLastProcessedUserId = (): string | null => lastProcessedUserId;

/**
 * Maximum number of retries for rate limit (429) errors
 */
const MAX_RETRIES = 5;

/**
 * Delay in milliseconds when retrying after a 429 error (10 seconds)
 */
const RETRY_DELAY_MS = 10000;

/**
 * Creates a single user in Clerk with all associated data
 *
 * Handles the full user creation process:
 * 1. Creates the user with primary email/phone and core fields
 * 2. Adds additional emails and phones (rate-limited via shared limiter)
 * 3. Adds verified and unverified email addresses
 * 4. Adds verified and unverified phone numbers
 * 5. Handles password with appropriate hasher
 * 6. Supports backup codes if enabled
 *
 * @param userData - The validated user data
 * @param skipPasswordRequirement - Whether to skip password requirement for users without passwords
 * @param limit - Shared p-limit instance for rate limiting all API calls
 * @returns The created Clerk user object
 * @throws Will throw if user creation fails
 */
const createUser = async (
	userData: User,
	skipPasswordRequirement: boolean,
	limit: ReturnType<typeof pLimit>
) => {
	const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

	// Extract primary email and additional emails
	const emails = userData.email
		? Array.isArray(userData.email)
			? userData.email
			: [userData.email]
		: [];
	const primaryEmail = emails[0];
	const additionalEmails = emails.slice(1);

	// Extract primary phone and additional phones
	const phones = userData.phone
		? Array.isArray(userData.phone)
			? userData.phone
			: [userData.phone]
		: [];
	const primaryPhone = phones[0];
	const additionalPhones = phones.slice(1);

	// Build user params dynamically based on available fields
	// Using Record type to allow dynamic property assignment for password hashing params
	const userParams: Record<string, unknown> = {
		externalId: userData.userId,
	};

	// Add email if present
	if (primaryEmail) userParams.emailAddress = [primaryEmail];

	// Add optional fields only if they have values
	if (userData.firstName) userParams.firstName = userData.firstName;
	if (userData.lastName) userParams.lastName = userData.lastName;
	if (userData.username) userParams.username = userData.username;
	if (primaryPhone) userParams.phoneNumber = [primaryPhone];
	if (userData.totpSecret) userParams.totpSecret = userData.totpSecret;
	if (userData.backupCodes) userParams.backupCodes = userData.backupCodes;
	if (userData.unsafeMetadata)
		userParams.unsafeMetadata = userData.unsafeMetadata;
	if (userData.privateMetadata)
		userParams.privateMetadata = userData.privateMetadata;
	if (userData.publicMetadata)
		userParams.publicMetadata = userData.publicMetadata;

	// Additional Clerk API fields
	if (userData.bypassClientTrust !== undefined)
		userParams.bypassClientTrust = userData.bypassClientTrust;
	if (userData.createOrganizationEnabled !== undefined)
		userParams.createOrganizationEnabled = userData.createOrganizationEnabled;
	if (userData.createOrganizationsLimit !== undefined)
		userParams.createOrganizationsLimit = userData.createOrganizationsLimit;
	if (userData.createdAt) userParams.createdAt = userData.createdAt;
	if (userData.deleteSelfEnabled !== undefined)
		userParams.deleteSelfEnabled = userData.deleteSelfEnabled;
	if (userData.legalAcceptedAt)
		userParams.legalAcceptedAt = userData.legalAcceptedAt;
	if (userData.skipLegalChecks !== undefined)
		userParams.skipLegalChecks = userData.skipLegalChecks;
	if (userData.skipPasswordChecks !== undefined)
		userParams.skipPasswordChecks = userData.skipPasswordChecks;

	// Handle password - if present, include digest and hasher; otherwise skip password requirement if allowed
	if (userData.password && userData.passwordHasher) {
		userParams.passwordDigest = userData.password;
		userParams.passwordHasher = userData.passwordHasher;
	} else if (skipPasswordRequirement) {
		userParams.skipPasswordRequirement = true;
	}
	// If user has no password and skipPasswordRequirement is false, the API will return an error

	// Create the user with the primary email
	// Rate-limited via the shared limiter
	const [createdUser, createError] = await tryCatch(
		limit(() =>
			clerk.users.createUser(
				userParams as Parameters<typeof clerk.users.createUser>[0]
			)
		)
	);

	if (createError) {
		throw createError;
	}

	// Add additional emails to the created user
	// Each API call is rate-limited via the shared limiter
	// Use tryCatch to make these non-fatal - if they fail, log but continue
	const emailPromises = additionalEmails
		.filter((email) => email)
		.map((email) =>
			limit(async () => {
				const [, emailError] = await tryCatch(
					clerk.emailAddresses.createEmailAddress({
						userId: createdUser.id,
						emailAddress: email,
						primary: false,
					})
				);

				if (emailError) {
					// Log warning but don't fail the entire user creation
					console.warn(
						`Failed to add additional email ${email} for user ${userData.userId}: ${emailError.message}`
					);
				}
			})
		);

	// Add additional phones to the created user
	// Each API call is rate-limited via the shared limiter
	// Use tryCatch to make these non-fatal - if they fail, log but continue
	const phonePromises = additionalPhones
		.filter((phone) => phone)
		.map((phone) =>
			limit(async () => {
				const [, phoneError] = await tryCatch(
					clerk.phoneNumbers.createPhoneNumber({
						userId: createdUser.id,
						phoneNumber: phone,
						primary: false,
					})
				);

				if (phoneError) {
					// Log warning but don't fail the entire user creation
					console.warn(
						`Failed to add additional phone ${phone} for user ${userData.userId}: ${phoneError.message}`
					);
				}
			})
		);

	// Wait for all additional identifiers to be created
	await Promise.all([...emailPromises, ...phonePromises]);

	return createdUser;
};

/**
 * Processes a single user for import to Clerk
 *
 * Validates the user data, creates the user in Clerk, and handles errors.
 * Implements retry logic for rate limit errors (429) with a maximum of 5 retries.
 * Updates progress counters and logs results.
 *
 * @param userData - The user data to import
 * @param total - Total number of users being processed (for progress display)
 * @param dateTime - Timestamp for log file naming
 * @param skipPasswordRequirement - Whether to skip password requirement
 * @param limit - Shared p-limit instance for rate limiting all API calls
 * @param retryCount - Current retry attempt count (default 0)
 * @returns A promise that resolves when the user is processed
 */
async function processUserToClerk(
	userData: User,
	total: number,
	dateTime: string,
	skipPasswordRequirement: boolean,
	limit: ReturnType<typeof pLimit>,
	retryCount: number = 0
) {
	try {
		// Validate user data
		const parsedUserData = userSchema.safeParse(userData);
		if (!parsedUserData.success) {
			throw parsedUserData.error;
		}

		// Create user (may throw for main user creation, but additional emails/phones use tryCatch internally)
		await createUser(parsedUserData.data, skipPasswordRequirement, limit);

		// Success
		successful++;
		processed++;
		lastProcessedUserId = userData.userId;

		// Log successful import
		importLogger({ userId: userData.userId, status: 'success' }, dateTime);
	} catch (error: unknown) {
		// Retry on rate limit error (429) with 10 second delay
		const clerkError = error as { status?: number; errors?: ClerkAPIError[] };
		if (clerkError.status === 429) {
			if (retryCount < MAX_RETRIES) {
				// Wait 10 seconds before retrying
				await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
				return processUserToClerk(
					userData,
					total,
					dateTime,
					skipPasswordRequirement,
					limit,
					retryCount + 1
				);
			} else {
				// Max retries exceeded - log as permanent failure
				const errorMessage = `Rate limit exceeded after ${MAX_RETRIES} retries`;
				failed++;
				processed++;
				lastProcessedUserId = userData.userId;
				s.message(`Migrating users: [${processed}/${total}]`);
				errorCounts.set(errorMessage, (errorCounts.get(errorMessage) ?? 0) + 1);

				// Log to error log file
				errorLogger(
					{
						userId: userData.userId,
						status: '429',
						errors: [
							{
								code: 'rate_limit_exceeded',
								message: errorMessage,
								longMessage: errorMessage,
							},
						],
					},
					dateTime
				);

				// Log to import log file
				importLogger(
					{ userId: userData.userId, status: 'error', error: errorMessage },
					dateTime
				);
				return;
			}
		}

		// Track error for summary
		failed++;
		processed++;
		lastProcessedUserId = userData.userId;
		s.message(`Migrating users: [${processed}/${total}]`);

		const errorMessage =
			clerkError.errors?.[0]?.longMessage ??
			clerkError.errors?.[0]?.message ??
			'Unknown error';
		errorCounts.set(errorMessage, (errorCounts.get(errorMessage) ?? 0) + 1);

		// Log to error log file
		errorLogger(
			{
				userId: userData.userId,
				status: String(clerkError.status ?? 'unknown'),
				errors: clerkError.errors ?? [],
			},
			dateTime
		);

		// Log to import log file
		importLogger(
			{ userId: userData.userId, status: 'error', error: errorMessage },
			dateTime
		);
	}
	s.message(
		`Migrating users: [${processed}/${total}] (${successful} successful, ${failed} failed)`
	);
}

/**
 * Displays a formatted summary of the import operation
 *
 * Shows:
 * - Total users processed
 * - Successful imports
 * - Failed imports
 * - Breakdown of errors by type
 *
 * @param summary - The import summary statistics
 */
const displaySummary = (summary: ImportSummary) => {
	let message = `Total users processed: ${summary.totalProcessed}\n`;
	message += `${color.green('Successfully imported:')} ${summary.successful}\n`;
	message += `${color.red('Failed with errors:')} ${summary.failed}`;

	if (summary.errorBreakdown.size > 0) {
		message += `\n\n${color.bold('Error Breakdown:')}\n`;
		for (const [error, count] of summary.errorBreakdown) {
			const prefix = `${color.red('•')} ${count} user${count === 1 ? '' : 's'}: `;
			message += `${prefix}${error}\n`;
		}
	}

	p.note(message.trim(), 'Migration Summary');
};

/**
 * Imports an array of users to Clerk
 *
 * Main entry point for user migration. Processes users concurrently with
 * rate limiting, displays progress, and shows a summary at completion.
 * Logs all results to timestamped log files.
 *
 * @param users - Array of validated users to import
 * @param skipPasswordRequirement - Whether to allow users without passwords (default: false)
 * @returns A promise that resolves when all users are processed
 */
export const importUsers = async (
	users: User[],
	skipPasswordRequirement: boolean = false
) => {
	const dateTime = getDateTimeStamp();

	// Reset counters for each import run
	processed = 0;
	successful = 0;
	failed = 0;
	lastProcessedUserId = null;
	errorCounts.clear();

	// Set up interruption handler
	const handleInterrupt = () => {
		s.stop('Migration interrupted by user');
		p.log.warn(`Last processed user ID: ${lastProcessedUserId ?? 'none'}`);
		if (lastProcessedUserId) {
			p.note(
				`To resume this migration, use the --resume-after flag:\n  bun migrate --resume-after="${lastProcessedUserId}"`,
				'Resume Migration'
			);
		}
		closeAllStreams();
		process.exit(130); // Standard exit code for SIGINT
	};

	process.on('SIGINT', handleInterrupt);

	s.start();
	const total = users.length;
	s.message(`Migrating users: [0/${total}]`);

	// Set up concurrency limiter based on rate limit
	// This limiter is shared across ALL API calls (user creation, emails, phones)
	const limit = pLimit(env.CONCURRENCY_LIMIT);

	// Process all users concurrently
	// Note: We don't wrap processUserToClerk with limit() here because
	// individual API calls inside createUser are rate-limited instead
	const promises = users.map((user) =>
		processUserToClerk(user, total, dateTime, skipPasswordRequirement, limit)
	);

	await Promise.all(promises);

	// Remove interruption handler now that we're done
	process.off('SIGINT', handleInterrupt);

	s.stop(`Migrated ${total} users`);

	// Close all log streams
	closeAllStreams();

	// Display summary
	const summary: ImportSummary = {
		totalProcessed: total,
		successful: successful,
		failed: failed,
		errorBreakdown: errorCounts,
	};
	displaySummary(summary);
};
