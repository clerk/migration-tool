/**
 * Auth0 user export module
 *
 * Exports users from an Auth0 tenant via the Management API to a JSON file
 * compatible with the migration script's Auth0 transformer.
 *
 * Note: The Auth0 Management API does not return password hashes. Contact
 * Auth0 support to request a password hash export separately.
 *
 * Usage:
 *   bun run export:auth0
 *   bun run export:auth0 -- --domain my-tenant.us.auth0.com --client-id xxx --client-secret xxx
 *
 * Environment variables:
 *   AUTH0_DOMAIN - Auth0 tenant domain
 *   AUTH0_CLIENT_ID - M2M app client ID
 *   AUTH0_CLIENT_SECRET - M2M app client secret
 *
 * Priority: CLI flags > env vars > interactive prompt
 */
import 'dotenv/config';
import { ManagementClient } from 'auth0';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
	displayFieldCoverage,
	getDateTimeStamp,
	writeExportOutput,
} from '../lib';
import { closeAllStreams, exportLogger } from '../logger';
import type { BaseExportResult } from '../types';

const PAGE_SIZE = 100;

interface Auth0ExportResult extends BaseExportResult {
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
 * Maps an Auth0 user object to the export format expected by the Auth0 transformer.
 *
 * Preserves the field names that the Auth0 transformer maps from.
 *
 * @param user - An Auth0 user object from the Management API
 * @returns A record with Auth0 transformer-compatible field names
 */
export function mapAuth0UserToExport(
	user: Record<string, unknown>
): Record<string, unknown> {
	const exported: Record<string, unknown> = {};

	if (user.user_id) exported.user_id = user.user_id;
	if (user.email) exported.email = user.email;
	if (user.email_verified !== undefined)
		exported.email_verified = user.email_verified;
	if (user.username) exported.username = user.username;
	if (user.given_name) exported.given_name = user.given_name;
	if (user.family_name) exported.family_name = user.family_name;
	if (user.phone_number) exported.phone_number = user.phone_number;
	if (user.phone_verified !== undefined)
		exported.phone_verified = user.phone_verified;
	if (
		user.user_metadata &&
		Object.keys(user.user_metadata as object).length > 0
	)
		exported.user_metadata = user.user_metadata;
	if (user.app_metadata && Object.keys(user.app_metadata as object).length > 0)
		exported.app_metadata = user.app_metadata;
	if (user.created_at) exported.created_at = user.created_at;

	return exported;
}

/**
 * Exports all users from an Auth0 tenant to a JSON file.
 *
 * Fetches users via the Management API with pagination (100 per page),
 * maps them to the Auth0 transformer format, and writes to exports/.
 *
 * @param domain - Auth0 tenant domain (e.g., my-tenant.us.auth0.com)
 * @param clientId - M2M application client ID
 * @param clientSecret - M2M application client secret
 * @param outputFile - Output file name (written inside exports/ directory)
 * @returns Export result with user count, output path, and field coverage stats
 */
export async function exportAuth0Users(
	domain: string,
	clientId: string,
	clientSecret: string,
	outputFile: string
): Promise<Auth0ExportResult> {
	const management = new ManagementClient({
		domain,
		clientId,
		clientSecret,
	});

	const dateTime = getDateTimeStamp();
	const allUsers: Record<string, unknown>[] = [];

	const coverage = {
		email: 0,
		username: 0,
		firstName: 0,
		lastName: 0,
		phone: 0,
		password: 0,
	};

	let page = 0;
	let hasMore = true;

	while (hasMore) {
		const response = await management.users.getAll({
			page,
			per_page: PAGE_SIZE,
			include_totals: true,
		});

		const users = response.data.users;

		for (const user of users) {
			const mapped = mapAuth0UserToExport(
				user as unknown as Record<string, unknown>
			);
			allUsers.push(mapped);

			if (mapped.email) coverage.email++;
			if (mapped.username) coverage.username++;
			if (mapped.given_name) coverage.firstName++;
			if (mapped.family_name) coverage.lastName++;
			if (mapped.phone_number) coverage.phone++;
			// Password hashes are never available from the Management API
			// coverage.password stays at 0

			exportLogger(
				{
					userId:
						typeof mapped.user_id === 'string'
							? mapped.user_id
							: `row_${allUsers.length}`,
					status: 'success',
				},
				dateTime
			);
		}

		hasMore = users.length === PAGE_SIZE;
		page++;
	}

	closeAllStreams();

	const outputPath = writeExportOutput(allUsers, outputFile);

	return {
		userCount: allUsers.length,
		outputPath,
		fieldCoverage: coverage,
	};
}

/**
 * Displays the Auth0 export results as a field coverage report.
 *
 * @param result - Export result containing user count, output path, and per-field coverage stats
 */
export function displayAuth0ExportSummary(result: Auth0ExportResult): void {
	const { userCount, outputPath, fieldCoverage } = result;

	displayFieldCoverage(
		[
			{ label: 'have email', count: fieldCoverage.email },
			{ label: 'have username', count: fieldCoverage.username },
			{ label: 'have first name', count: fieldCoverage.firstName },
			{ label: 'have last name', count: fieldCoverage.lastName },
			{ label: 'have phone', count: fieldCoverage.phone },
			{ label: 'have password hash', count: fieldCoverage.password },
		],
		userCount,
		outputPath
	);

	p.log.info(
		color.dim(
			'Password hashes are not available from the Auth0 Management API.\n' +
				'Contact Auth0 support to request a password hash export.'
		)
	);
}

/**
 * Parses Auth0-specific CLI flags from process arguments.
 */
function parseAuth0Args(): {
	domain?: string;
	clientId?: string;
	clientSecret?: string;
	output?: string;
} {
	const args = process.argv.slice(2);
	const result: Record<string, string | undefined> = {};

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--domain' && args[i + 1]) {
			result.domain = args[i + 1];
			i++;
		} else if (args[i] === '--client-id' && args[i + 1]) {
			result.clientId = args[i + 1];
			i++;
		} else if (args[i] === '--client-secret' && args[i + 1]) {
			result.clientSecret = args[i + 1];
			i++;
		} else if (args[i] === '--output' && args[i + 1]) {
			result.output = args[i + 1];
			i++;
		}
	}

	return result;
}

/**
 * CLI wrapper for the Auth0 export command.
 *
 * Resolves credentials from CLI flags, env vars, or interactive prompts,
 * then exports users to a JSON file.
 */
export async function runAuth0Export(): Promise<void> {
	p.intro(color.bgCyan(color.black('Auth0 User Export')));

	const cliArgs = parseAuth0Args();
	const env = process.env as Record<string, string | undefined>;

	let domain = cliArgs.domain || env.AUTH0_DOMAIN;
	let clientId = cliArgs.clientId || env.AUTH0_CLIENT_ID;
	let clientSecret = cliArgs.clientSecret || env.AUTH0_CLIENT_SECRET;
	const outputFile = cliArgs.output || 'auth0-export.json';

	// Prompt for missing credentials
	if (!domain) {
		const input = await p.text({
			message: 'Enter your Auth0 domain',
			placeholder: 'my-tenant.us.auth0.com',
			validate: (value) => {
				if (!value || value.trim() === '') {
					return 'Auth0 domain is required';
				}
			},
		});
		if (p.isCancel(input)) {
			p.cancel('Export cancelled.');
			process.exit(0);
		}
		domain = input;
	}

	if (!clientId) {
		const input = await p.text({
			message: 'Enter your Auth0 M2M application Client ID',
			placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
			validate: (value) => {
				if (!value || value.trim() === '') {
					return 'Client ID is required';
				}
			},
		});
		if (p.isCancel(input)) {
			p.cancel('Export cancelled.');
			process.exit(0);
		}
		clientId = input;
	}

	if (!clientSecret) {
		const input = await p.text({
			message: 'Enter your Auth0 M2M application Client Secret',
			placeholder:
				'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
			validate: (value) => {
				if (!value || value.trim() === '') {
					return 'Client Secret is required';
				}
			},
		});
		if (p.isCancel(input)) {
			p.cancel('Export cancelled.');
			process.exit(0);
		}
		clientSecret = input;
	}

	const spinner = p.spinner();
	spinner.start('Fetching users from Auth0...');

	try {
		const result = await exportAuth0Users(
			domain,
			clientId,
			clientSecret,
			outputFile
		);
		spinner.stop(`Found ${result.userCount} users`);

		displayAuth0ExportSummary(result);

		p.log.info(
			color.dim(
				`Next step: run ${color.bold('bun run migrate')} and select "Auth0" with file "exports/${outputFile}"`
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
