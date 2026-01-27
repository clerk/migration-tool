import { createClerkClient } from '@clerk/backend';
import type { ClerkAPIError } from '@clerk/types';
import { env, MAX_RETRIES, RETRY_DELAY_MS } from '../envs-constants';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { closeAllStreams, errorLogger, importLogger } from '../logger';
import { getDateTimeStamp, getRetryDelay, tryCatch } from '../utils';
import { userSchema } from './validator';
import type { ImportSummary, User } from '../types';
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
export function getLastProcessedUserId(): string | null {
	return lastProcessedUserId;
}

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
 * @param dateTime - Timestamp for log file naming
 * @returns The created Clerk user object
 * @throws Will throw if user creation fails
 */
async function createUser(
	userData: User,
	skipPasswordRequirement: boolean,
	limit: ReturnType<typeof pLimit>,
	dateTime: string
) {
	const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

	// Extract primary email and additional emails
	let emails: string[] = [];
	if (userData.email) {
		emails = Array.isArray(userData.email) ? userData.email : [userData.email];
	}
	const primaryEmail = emails[0];
	const additionalEmails = emails.slice(1);

	// Extract primary phone and additional phones
	let phones: string[] = [];
	if (userData.phone) {
		phones = Array.isArray(userData.phone) ? userData.phone : [userData.phone];
	}
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
					// Log error but don't fail the entire user creation
					errorLogger(
						{
							userId: userData.userId,
							status: 'additional_email_error',
							errors: [
								{
									code: 'additional_email_failed',
									message: `Failed to add additional email ${email}`,
									longMessage: `Failed to add additional email ${email}: ${emailError.message}`,
								},
							],
						},
						dateTime
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
					// Log error but don't fail the entire user creation
					errorLogger(
						{
							userId: userData.userId,
							status: 'additional_phone_error',
							errors: [
								{
									code: 'additional_phone_failed',
									message: `Failed to add additional phone ${phone}`,
									longMessage: `Failed to add additional phone ${phone}: ${phoneError.message}`,
								},
							],
						},
						dateTime
					);
				}
			})
		);

	// Wait for all additional identifiers to be created
	await Promise.all([...emailPromises, ...phonePromises]);

	return createdUser;
}

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
		const createdUser = await createUser(
			parsedUserData.data,
			skipPasswordRequirement,
			limit,
			dateTime
		);

		// Success
		successful++;
		processed++;
		lastProcessedUserId = userData.userId;

		// Log successful import with Clerk user ID
		importLogger(
			{
				userId: userData.userId,
				status: 'success',
				clerkUserId: createdUser.id,
			},
			dateTime
		);
	} catch (error: unknown) {
		// Retry on rate limit error (429)
		const clerkError = error as { status?: number; errors?: ClerkAPIError[] };
		if (clerkError.status === 429) {
			// Extract Retry-After value from response (in seconds)
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

				errorLogger(
					{
						userId: userData.userId,
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
				return processUserToClerk(
					userData,
					total,
					dateTime,
					skipPasswordRequirement,
					limit,
					retryCount + 1
				);
			}
			// Max retries exceeded - log as permanent failure
			const errorMessage = `Rate limit exceeded after ${MAX_RETRIES} retries`;
			failed++;
			processed++;
			lastProcessedUserId = userData.userId;
			s.message(`Migrating users: [${processed}/${total}]`);
			errorCounts.set(errorMessage, (errorCounts.get(errorMessage) ?? 0) + 1);

			// Log to import log file
			importLogger(
				{
					userId: userData.userId,
					status: 'error',
					error: errorMessage,
					code: '429',
				},
				dateTime
			);
			return;
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

		// Log to import log file
		importLogger(
			{
				userId: userData.userId,
				status: 'error',
				error: errorMessage,
				code: String(clerkError.status ?? 'unknown'),
			},
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
 * - Validation failures
 * - Breakdown of errors by type
 *
 * @param summary - The import summary statistics
 */
function displaySummary(summary: ImportSummary) {
	let message = `${color.green('Successfully imported:')} ${summary.successful}\n`;
	message += `${color.red('Failed with errors:')} ${summary.failed}\n`;

	if (summary.validationFailed > 0) {
		message += `${color.yellow('Failed validation:')} ${summary.validationFailed}\n`;
	}

	const totalAttempted = summary.totalProcessed + summary.validationFailed;
	message += `${color.bold('Total users in file:')} ${totalAttempted}`;

	if (summary.validationFailed > 0) {
		message += `\n${color.dim(`(${summary.totalProcessed} attempted, ${summary.validationFailed} skipped due to validation errors)`)}`;
	}

	if (summary.errorBreakdown.size > 0) {
		message += `\n\n${color.bold('Error Breakdown:')}\n`;
		for (const [error, count] of summary.errorBreakdown) {
			const prefix = `${color.red('•')} ${count} user${count === 1 ? '' : 's'}: `;
			message += `${prefix}${error}\n`;
		}
	}

	p.note(message.trim(), 'Migration Summary');
}

/**
 * Imports an array of users to Clerk
 *
 * Main entry point for user migration. Processes users concurrently with
 * rate limiting, displays progress, and shows a summary at completion.
 * Logs all results to timestamped log files.
 *
 * @param users - Array of validated users to import
 * @param skipPasswordRequirement - Whether to allow users without passwords (default: false)
 * @param validationFailed - Number of users that failed validation (default: 0)
 * @returns A promise that resolves when all users are processed
 */
export async function importUsers(
	users: User[],
	skipPasswordRequirement: boolean = false,
	validationFailed: number = 0
) {
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

	s.stop(`Processed ${total} user${total === 1 ? '' : 's'}`);

	// Close all log streams
	closeAllStreams();

	// Display summary
	const summary: ImportSummary = {
		totalProcessed: total,
		successful,
		failed,
		validationFailed,
		errorBreakdown: errorCounts,
	};
	displaySummary(summary);
}
