/**
 * Firebase user export module
 *
 * Exports users from a Firebase project via the Admin SDK to a JSON file
 * compatible with the migration script's Firebase transformer.
 *
 * Uses admin.auth().listUsers() for paginated user fetching. The Admin SDK
 * returns UserRecord objects including passwordHash and passwordSalt fields
 * when available.
 *
 * Usage:
 *   bun run export:firebase
 *   bun run export:firebase -- --service-account ./service-account.json --output users.json
 *
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS - Path to Firebase service account JSON key file
 *
 * Priority: --service-account flag > GOOGLE_APPLICATION_CREDENTIALS env var > interactive prompt
 */
import 'dotenv/config';
import fs from 'fs';
import * as admin from 'firebase-admin';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
	displayFieldCoverage,
	getDateTimeStamp,
	writeExportOutput,
} from '../lib';
import { closeAllStreams, exportLogger } from '../logger';
import type { BaseExportResult } from '../types';

const PAGE_SIZE = 1000;

interface FirebaseExportResult extends BaseExportResult {
	fieldCoverage: {
		email: number;
		emailVerified: number;
		passwordHash: number;
		phone: number;
		displayName: number;
	};
}

/**
 * Maps a Firebase UserRecord to the export format expected by the Firebase transformer.
 *
 * @param user - A Firebase UserRecord from the Admin SDK
 * @returns A record with Firebase transformer-compatible field names
 */
export function mapFirebaseUserToExport(
	user: admin.auth.UserRecord
): Record<string, unknown> {
	const exported: Record<string, unknown> = {};

	exported.localId = user.uid;
	if (user.email) exported.email = user.email;
	exported.emailVerified = user.emailVerified;
	if (user.passwordHash) exported.passwordHash = user.passwordHash;
	if (user.passwordSalt) exported.passwordSalt = user.passwordSalt;
	if (user.displayName) exported.displayName = user.displayName;
	if (user.phoneNumber) exported.phoneNumber = user.phoneNumber;
	if (user.disabled) exported.disabled = user.disabled;
	if (user.metadata.creationTime)
		exported.createdAt = new Date(user.metadata.creationTime).getTime();
	if (user.metadata.lastSignInTime)
		exported.lastSignedInAt = new Date(user.metadata.lastSignInTime).getTime();

	return exported;
}

/**
 * Exports all users from a Firebase project to a JSON file.
 *
 * Fetches users via the Admin SDK with pagination (1000 per page),
 * maps them to the Firebase transformer format, and writes to exports/.
 *
 * @param serviceAccountPath - Path to the Firebase service account JSON key file
 * @param outputFile - Output file name (written inside exports/ directory)
 * @returns Export result with user count, output path, and field coverage stats
 */
export async function exportFirebaseUsers(
	serviceAccountPath: string,
	outputFile: string
): Promise<FirebaseExportResult> {
	const serviceAccount = JSON.parse(
		fs.readFileSync(serviceAccountPath, 'utf-8')
	) as admin.ServiceAccount;

	const app = admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
	});

	try {
		const dateTime = getDateTimeStamp();
		const allUsers: Record<string, unknown>[] = [];

		const coverage = {
			email: 0,
			emailVerified: 0,
			passwordHash: 0,
			phone: 0,
			displayName: 0,
		};

		let pageToken: string | undefined;

		do {
			const listResult = await admin.auth().listUsers(PAGE_SIZE, pageToken);

			for (const user of listResult.users) {
				const mapped = mapFirebaseUserToExport(user);
				allUsers.push(mapped);

				if (mapped.email) coverage.email++;
				if (mapped.emailVerified) coverage.emailVerified++;
				if (mapped.passwordHash) coverage.passwordHash++;
				if (mapped.phoneNumber) coverage.phone++;
				if (mapped.displayName) coverage.displayName++;

				exportLogger({ userId: user.uid, status: 'success' }, dateTime);
			}

			pageToken = listResult.pageToken;
		} while (pageToken);

		closeAllStreams();

		const outputPath = writeExportOutput(allUsers, outputFile);

		return {
			userCount: allUsers.length,
			outputPath,
			fieldCoverage: coverage,
		};
	} finally {
		await app.delete();
	}
}

/**
 * Displays the Firebase export results as a field coverage report.
 *
 * @param result - Export result containing user count, output path, and per-field coverage stats
 */
export function displayFirebaseExportSummary(
	result: FirebaseExportResult
): void {
	const { userCount, outputPath, fieldCoverage } = result;

	displayFieldCoverage(
		[
			{ label: 'have email', count: fieldCoverage.email },
			{ label: 'email verified', count: fieldCoverage.emailVerified },
			{ label: 'have password hash', count: fieldCoverage.passwordHash },
			{ label: 'have phone', count: fieldCoverage.phone },
			{ label: 'have display name', count: fieldCoverage.displayName },
		],
		userCount,
		outputPath
	);

	if (fieldCoverage.passwordHash === 0 && userCount > 0) {
		p.log.info(
			color.dim(
				'No password hashes found. Ensure you are using a project-level service account.'
			)
		);
	}
}

/**
 * Parses Firebase-specific CLI flags from process arguments.
 */
function parseFirebaseArgs(): {
	serviceAccount?: string;
	output?: string;
} {
	const args = process.argv.slice(2);
	const result: Record<string, string | undefined> = {};

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--service-account' && args[i + 1]) {
			result.serviceAccount = args[i + 1];
			i++;
		} else if (args[i] === '--output' && args[i + 1]) {
			result.output = args[i + 1];
			i++;
		}
	}

	return result;
}

/**
 * CLI wrapper for the Firebase export command.
 *
 * Resolves the service account path from CLI flags, env vars, or interactive prompt,
 * then exports users to a JSON file.
 */
export async function runFirebaseExport(): Promise<void> {
	p.intro(color.bgCyan(color.black('Firebase User Export')));

	const cliArgs = parseFirebaseArgs();
	const env = process.env as Record<string, string | undefined>;

	let serviceAccountPath =
		cliArgs.serviceAccount || env.GOOGLE_APPLICATION_CREDENTIALS;
	const outputFile = cliArgs.output || 'firebase-export.json';

	// Prompt for service account path if not resolved
	if (!serviceAccountPath) {
		const input = await p.text({
			message: 'Enter the path to your Firebase service account JSON key file',
			placeholder: './service-account.json',
			validate: (value) => {
				if (!value || value.trim() === '') {
					return 'Service account path is required';
				}
				if (!fs.existsSync(value)) {
					return `File not found: ${value}`;
				}
			},
		});
		if (p.isCancel(input)) {
			p.cancel('Export cancelled.');
			process.exit(0);
		}
		serviceAccountPath = input;
	}

	// Validate the file exists and is valid JSON
	if (!fs.existsSync(serviceAccountPath)) {
		p.log.error(color.red(`File not found: ${serviceAccountPath}`));
		process.exit(1);
	}

	try {
		JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
	} catch {
		p.log.error(
			color.red(`Invalid JSON in service account file: ${serviceAccountPath}`)
		);
		process.exit(1);
	}

	const spinner = p.spinner();
	spinner.start('Fetching users from Firebase...');

	try {
		const result = await exportFirebaseUsers(serviceAccountPath, outputFile);
		spinner.stop(`Found ${result.userCount} users`);

		displayFirebaseExportSummary(result);

		p.log.info(
			color.dim(
				`Next step: run ${color.bold('bun run migrate')} and select "Firebase" with file "exports/${outputFile}"`
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
