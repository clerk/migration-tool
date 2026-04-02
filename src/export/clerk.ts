/**
 * Clerk user export module
 *
 * Exports users from a Clerk instance to a JSON file compatible with the
 * migration script's Clerk transformer for instance-to-instance migration.
 *
 * Note: The Clerk API does not return sensitive fields like passwords,
 * TOTP secrets, or backup codes. Only `passwordEnabled`, `totpEnabled`,
 * and `backupCodeEnabled` booleans are available.
 *
 * Usage:
 *   bun run export:clerk
 *   bun run export:clerk -- --output my-users.json
 */
import 'dotenv/config';
import { createClerkClient } from '@clerk/backend';
import type { User } from '@clerk/backend';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
	displayFieldCoverage,
	getDateTimeStamp,
	writeExportOutput,
} from '../lib';
import { env } from '../envs-constants';
import { closeAllStreams, exportLogger } from '../logger';
import type { BaseExportResult } from '../types';

const LIMIT = 500;

/**
 * Recursively fetches all users from a Clerk instance using pagination
 * @param allUsers - Accumulator for collected users
 * @param offset - Current pagination offset
 * @returns Array of all Clerk User objects
 */
async function fetchAllUsers(
	allUsers: User[] = [],
	offset: number = 0
): Promise<User[]> {
	const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
	const { data } = await clerk.users.getUserList({
		offset,
		limit: LIMIT,
	});
	allUsers.push(...data);

	if (data.length === LIMIT) {
		return fetchAllUsers(allUsers, offset + LIMIT);
	}

	return allUsers;
}

/**
 * Maps a Clerk User object to the export format compatible with the migration schema.
 *
 * Categorizes emails and phones by verification status, placing primary identifiers
 * first. Only includes fields that have values.
 *
 * @param user - A Clerk User object from the API
 * @returns A record with migration-compatible field names
 */
export function mapUserToExport(user: User): Record<string, unknown> {
	const exported: Record<string, unknown> = {};

	exported.userId = user.id;

	// Categorize emails by verification status
	const verifiedEmails: string[] = [];
	const unverifiedEmails: string[] = [];
	for (const ea of user.emailAddresses) {
		if (ea.verification?.status === 'verified') {
			verifiedEmails.push(ea.emailAddress);
		} else {
			unverifiedEmails.push(ea.emailAddress);
		}
	}

	// Primary email first, then additional verified
	const primaryEmailAddr = user.primaryEmailAddress?.emailAddress;
	if (primaryEmailAddr) {
		exported.email = primaryEmailAddr;
		const additional = verifiedEmails.filter((e) => e !== primaryEmailAddr);
		if (additional.length > 0) exported.emailAddresses = additional;
	} else if (verifiedEmails.length > 0) {
		exported.email = verifiedEmails[0];
		if (verifiedEmails.length > 1)
			exported.emailAddresses = verifiedEmails.slice(1);
	}
	if (unverifiedEmails.length > 0)
		exported.unverifiedEmailAddresses = unverifiedEmails;

	// Categorize phones by verification status
	const verifiedPhones: string[] = [];
	const unverifiedPhones: string[] = [];
	for (const pn of user.phoneNumbers) {
		if (pn.verification?.status === 'verified') {
			verifiedPhones.push(pn.phoneNumber);
		} else {
			unverifiedPhones.push(pn.phoneNumber);
		}
	}

	const primaryPhoneNum = user.primaryPhoneNumber?.phoneNumber;
	if (primaryPhoneNum) {
		exported.phone = primaryPhoneNum;
		const additional = verifiedPhones.filter((ph) => ph !== primaryPhoneNum);
		if (additional.length > 0) exported.phoneNumbers = additional;
	} else if (verifiedPhones.length > 0) {
		exported.phone = verifiedPhones[0];
		if (verifiedPhones.length > 1)
			exported.phoneNumbers = verifiedPhones.slice(1);
	}
	if (unverifiedPhones.length > 0)
		exported.unverifiedPhoneNumbers = unverifiedPhones;

	// Simple fields
	if (user.username) exported.username = user.username;
	if (user.firstName) exported.firstName = user.firstName;
	if (user.lastName) exported.lastName = user.lastName;

	// Metadata (include only when non-empty)
	if (Object.keys(user.publicMetadata).length > 0)
		exported.publicMetadata = user.publicMetadata;
	if (Object.keys(user.privateMetadata).length > 0)
		exported.privateMetadata = user.privateMetadata;
	if (Object.keys(user.unsafeMetadata).length > 0)
		exported.unsafeMetadata = user.unsafeMetadata;

	// Clerk API fields
	if (user.banned) exported.banned = user.banned;
	exported.createOrganizationEnabled = user.createOrganizationEnabled;
	if (user.createOrganizationsLimit !== null)
		exported.createOrganizationsLimit = user.createOrganizationsLimit;
	exported.deleteSelfEnabled = user.deleteSelfEnabled;

	// Timestamps: convert from unix ms to ISO string
	if (user.createdAt)
		exported.createdAt = new Date(user.createdAt).toISOString();
	if (user.legalAcceptedAt)
		exported.legalAcceptedAt = new Date(user.legalAcceptedAt).toISOString();

	return exported;
}

interface ClerkExportResult extends BaseExportResult {
	fieldCoverage: {
		email: number;
		username: number;
		firstName: number;
		lastName: number;
		phone: number;
		password: number;
	};
}

/**
 * Exports all users from a Clerk instance to a JSON file.
 *
 * Fetches all users via pagination, maps them to the migration schema format,
 * and writes the result to the exports/ directory.
 *
 * @param outputFile - Output file name (written inside exports/ directory)
 * @returns Export result with user count, output path, and field coverage stats
 */
export async function exportClerkUsers(
	outputFile: string
): Promise<ClerkExportResult> {
	const allUsers = await fetchAllUsers();
	const dateTime = getDateTimeStamp();
	const exportedUsers: Record<string, unknown>[] = [];

	const coverage = {
		email: 0,
		username: 0,
		firstName: 0,
		lastName: 0,
		phone: 0,
		password: 0,
	};

	for (const user of allUsers) {
		try {
			const mapped = mapUserToExport(user);
			exportedUsers.push(mapped);

			// Track field coverage
			if (mapped.email) coverage.email++;
			if (mapped.username) coverage.username++;
			if (mapped.firstName) coverage.firstName++;
			if (mapped.lastName) coverage.lastName++;
			if (mapped.phone) coverage.phone++;
			if (user.passwordEnabled) coverage.password++;

			exportLogger({ userId: user.id, status: 'success' }, dateTime);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			exportLogger(
				{ userId: user.id, status: 'error', error: message },
				dateTime
			);
		}
	}

	closeAllStreams();

	const outputPath = writeExportOutput(exportedUsers, outputFile);

	return {
		userCount: exportedUsers.length,
		outputPath,
		fieldCoverage: coverage,
	};
}

/**
 * Displays the Clerk export results as a field coverage report.
 *
 * @param result - Export result containing user count, output path, and per-field coverage stats
 */
export function displayClerkExportSummary(result: ClerkExportResult): void {
	const { userCount, outputPath, fieldCoverage } = result;

	displayFieldCoverage(
		[
			{ label: 'have email', count: fieldCoverage.email },
			{ label: 'have username', count: fieldCoverage.username },
			{ label: 'have first name', count: fieldCoverage.firstName },
			{ label: 'have last name', count: fieldCoverage.lastName },
			{ label: 'have phone', count: fieldCoverage.phone },
			{
				label: 'have password (passwordEnabled)',
				count: fieldCoverage.password,
			},
		],
		userCount,
		outputPath
	);
}

/**
 * Parses the --output flag from CLI arguments
 * @returns The output file name or undefined if not provided
 */
function parseOutputArg(): string | undefined {
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--output' && args[i + 1]) {
			return args[i + 1];
		}
	}
	return undefined;
}

/**
 * CLI wrapper for the Clerk export command
 *
 * Displays an interactive CLI with spinner, fetches all users,
 * and writes them to a JSON file in exports/.
 */
export async function runClerkExport(): Promise<void> {
	p.intro(color.bgCyan(color.black('Clerk User Export')));

	const outputFile = parseOutputArg() || 'clerk-export.json';

	const spinner = p.spinner();
	spinner.start('Fetching users from Clerk...');

	try {
		const result = await exportClerkUsers(outputFile);
		spinner.stop(`Found ${result.userCount} users`);
		displayClerkExportSummary(result);
		p.log.info(
			color.dim(
				`Next step: run ${color.bold('bun run migrate')} and select "Clerk" with file "exports/${outputFile}"`
			)
		);
		p.outro(color.green('Export complete!'));
	} catch (err) {
		spinner.stop('Export failed');
		const message = err instanceof Error ? err.message : String(err);
		p.log.error(color.red(message));
		process.exit(1);
	}
}
