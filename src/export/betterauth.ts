/**
 * Better Auth user export module
 *
 * Connects to a database used by Better Auth and exports users from the
 * "user" and "account" tables to a JSON file.
 *
 * Supports PostgreSQL, MySQL, and SQLite via the shared database abstraction.
 *
 * Dynamically detects installed Better Auth plugins (username, phone number,
 * admin, two-factor) and includes those columns when present.
 *
 * Core tables:
 *   - "user"    (core user identity)
 *   - "account" (hashed passwords, provider info — joined on providerId='credential')
 *
 * Usage:
 *   bun run export:betterauth
 *   bun run export:betterauth -- --db-url postgresql://... --output users.json
 *
 * Environment variables:
 *   BETTER_AUTH_DB_URL - Database connection string
 *
 * Priority: --db-url flag > BETTER_AUTH_DB_URL env var > interactive prompt
 */
import * as p from '@clack/prompts';
import color from 'picocolors';
import { createDbClient, type DbClient, type DbType } from '../lib/db';
import {
	displayFieldCoverage,
	getDateTimeStamp,
	getDbConnectionErrorHint,
	isValidConnectionString,
	resolveConnectionString,
	writeExportOutput,
} from '../lib';
import { closeAllStreams, exportLogger } from '../logger';
import type { BaseExportResult } from '../types';

/**
 * Plugin columns that may exist on the "user" table depending on installed plugins.
 *
 * - username plugin:    username, displayUsername
 * - phone number plugin: phoneNumber, phoneNumberVerified
 * - admin plugin:       role, banned, banReason, banExpires
 * - two-factor plugin:  twoFactorEnabled
 */
const PLUGIN_COLUMNS = [
	'username',
	'displayUsername',
	'phoneNumber',
	'phoneNumberVerified',
	'role',
	'banned',
	'banReason',
	'banExpires',
	'twoFactorEnabled',
] as const;

type PluginColumn = (typeof PLUGIN_COLUMNS)[number];

/**
 * Detects which Better Auth plugin columns exist on the "user" table.
 *
 * For PostgreSQL/MySQL, queries information_schema.columns.
 * For SQLite, uses PRAGMA table_info.
 *
 * @param client - Connected DbClient
 * @returns Set of detected plugin column names
 */
export async function detectPluginColumns(
	client: DbClient
): Promise<Set<PluginColumn>> {
	if (client.dbType === 'sqlite') {
		const result = await client.query<{ name: string }>(
			`PRAGMA table_info("user")`
		);
		const columnNames = new Set(result.rows.map((r) => r.name));
		const detected = new Set<PluginColumn>();
		for (const col of PLUGIN_COLUMNS) {
			if (columnNames.has(col)) detected.add(col);
		}
		return detected;
	}

	if (client.dbType === 'mysql') {
		const result = await client.query<{ column_name: string }>(
			`SELECT column_name
			 FROM information_schema.columns
			 WHERE table_name = 'user'
			   AND table_schema = DATABASE()
			   AND column_name IN (${PLUGIN_COLUMNS.map(() => '?').join(', ')})`,
			[...PLUGIN_COLUMNS]
		);
		return new Set(result.rows.map((r) => r.column_name as PluginColumn));
	}

	// PostgreSQL
	const result = await client.query<{ column_name: string }>(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_name = 'user'
		   AND table_schema = current_schema()
		   AND column_name = ANY($1)`,
		[PLUGIN_COLUMNS as unknown as string[]]
	);

	return new Set(result.rows.map((r) => r.column_name as PluginColumn));
}

/**
 * Builds the export SQL query dynamically based on available plugin columns.
 *
 * Always includes core user fields and credential password from the account table.
 * Adds plugin-specific columns only if they were detected by detectPluginColumns.
 * Uses correct identifier quoting based on the database type.
 *
 * @param pluginColumns - Set of detected plugin column names
 * @param dbType - Database type for correct identifier quoting
 * @returns SQL SELECT query string
 */
export function buildExportQuery(
	pluginColumns: Set<PluginColumn>,
	dbType: DbType = 'postgres'
): string {
	// MySQL uses backticks, PostgreSQL/SQLite use double quotes
	const q =
		dbType === 'mysql' ? (s: string) => `\`${s}\`` : (s: string) => `"${s}"`;

	const selects: string[] = [
		// Core columns (always present)
		`u.${q('id')}              AS user_id`,
		`u.${q('email')}`,
		`u.${q('emailVerified')}   AS email_verified`,
		`u.${q('name')}`,
		`u.${q('createdAt')}       AS created_at`,
		`u.${q('updatedAt')}       AS updated_at`,
		// Credential password from account table
		`a.${q('password')}        AS password_hash`,
	];

	// Username plugin
	if (pluginColumns.has('username')) selects.push(`u.${q('username')}`);
	if (pluginColumns.has('displayUsername'))
		selects.push(`u.${q('displayUsername')}  AS display_username`);

	// Phone number plugin
	if (pluginColumns.has('phoneNumber'))
		selects.push(`u.${q('phoneNumber')}          AS phone_number`);
	if (pluginColumns.has('phoneNumberVerified'))
		selects.push(`u.${q('phoneNumberVerified')}  AS phone_number_verified`);

	// Admin plugin
	if (pluginColumns.has('role')) selects.push(`u.${q('role')}`);
	if (pluginColumns.has('banned')) selects.push(`u.${q('banned')}`);
	if (pluginColumns.has('banReason'))
		selects.push(`u.${q('banReason')}   AS ban_reason`);
	if (pluginColumns.has('banExpires'))
		selects.push(`u.${q('banExpires')}  AS ban_expires`);

	// Two-factor plugin
	if (pluginColumns.has('twoFactorEnabled'))
		selects.push(`u.${q('twoFactorEnabled')} AS two_factor_enabled`);

	return [
		'SELECT',
		`    ${selects.join(',\n    ')}`,
		`FROM ${q('user')} u`,
		`LEFT JOIN ${q('account')} a ON a.${q('userId')} = u.${q('id')} AND a.${q('providerId')} = 'credential'`,
		`ORDER BY u.${q('createdAt')} ASC`,
	].join('\n');
}

/**
 * Determines which Better Auth plugins are installed based on detected columns.
 *
 * @param pluginColumns - Set of detected plugin column names
 * @returns Array of human-readable plugin names
 */
export function getDetectedPluginNames(
	pluginColumns: Set<PluginColumn>
): string[] {
	const plugins: string[] = [];
	if (pluginColumns.has('username') || pluginColumns.has('displayUsername'))
		plugins.push('username');
	if (
		pluginColumns.has('phoneNumber') ||
		pluginColumns.has('phoneNumberVerified')
	)
		plugins.push('phone number');
	if (
		pluginColumns.has('role') ||
		pluginColumns.has('banned') ||
		pluginColumns.has('banReason') ||
		pluginColumns.has('banExpires')
	)
		plugins.push('admin');
	if (pluginColumns.has('twoFactorEnabled')) plugins.push('two-factor');
	return plugins;
}

interface BetterAuthExportResult extends BaseExportResult {
	detectedPlugins: string[];
	fieldCoverage: {
		email: number;
		emailVerified: number;
		name: number;
		password: number;
		username: number;
		phone: number;
	};
}

interface BetterAuthUserRow {
	user_id: string;
	email: string | null;
	email_verified: boolean | null;
	name: string | null;
	password_hash: string | null;
	username?: string | null;
	phone_number?: string | null;
	[key: string]: unknown;
}

/**
 * Exports users from a Better Auth database to a JSON file.
 *
 * Connects to the database, detects installed plugins, builds a dynamic
 * query, and writes the results to the exports/ directory.
 *
 * Supports PostgreSQL, MySQL, and SQLite databases.
 *
 * @param dbUrl - Database connection string or file path
 * @param outputFile - Output file name (written inside exports/ directory)
 * @returns Export result with user count, detected plugins, and field coverage stats
 */
export async function exportBetterAuthUsers(
	dbUrl: string,
	outputFile: string
): Promise<BetterAuthExportResult> {
	let client: DbClient;

	try {
		client = await createDbClient(dbUrl);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const hint = getDbConnectionErrorHint(message, 'betterauth');
		throw new Error(`Failed to connect to database: ${message}\n\n${hint}`);
	}

	try {
		// Detect which plugin columns exist
		let pluginColumns: Set<PluginColumn>;
		try {
			pluginColumns = await detectPluginColumns(client);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (
				message.includes('does not exist') ||
				message.includes("doesn't exist") ||
				message.includes('no such table') ||
				message.includes('permission denied')
			) {
				throw new Error(
					`Could not read from "user" table: ${message}\n\n` +
						'The "user" table is created by Better Auth when the database is initialized.\n' +
						'Ensure Better Auth has been set up and the database has been migrated.\n' +
						'If you customized table names in your Better Auth config, update the\n' +
						'table references in this export script to match.'
				);
			}
			throw err;
		}

		const detectedPlugins = getDetectedPluginNames(pluginColumns);

		// Build and execute the dynamic query
		const query = buildExportQuery(pluginColumns, client.dbType);

		let rows: BetterAuthUserRow[];
		try {
			({ rows } = await client.query<BetterAuthUserRow>(query));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (
				message.includes('does not exist') ||
				message.includes("doesn't exist") ||
				message.includes('no such table') ||
				message.includes('permission denied')
			) {
				throw new Error(
					`Could not query Better Auth tables: ${message}\n\n` +
						'Ensure the "user" and "account" tables exist and the database\n' +
						'user has SELECT permission on them.'
				);
			}
			throw err;
		}

		// Calculate field coverage and log each user
		const dateTime = getDateTimeStamp();
		const coverage = {
			email: 0,
			emailVerified: 0,
			name: 0,
			password: 0,
			username: 0,
			phone: 0,
		};

		for (const row of rows) {
			if (row.email) coverage.email++;
			if (row.email_verified) coverage.emailVerified++;
			if (row.name) coverage.name++;
			if (row.password_hash) coverage.password++;
			if (row.username) coverage.username++;
			if (row.phone_number) coverage.phone++;

			exportLogger({ userId: row.user_id, status: 'success' }, dateTime);
		}

		closeAllStreams();

		const outputPath = writeExportOutput(rows, outputFile);

		return {
			userCount: rows.length,
			outputPath,
			detectedPlugins,
			fieldCoverage: coverage,
		};
	} finally {
		await client.end();
	}
}

/**
 * Displays the Better Auth export results as a field coverage report.
 *
 * Shows detected plugins and per-field coverage with colored icons.
 *
 * @param result - Export result containing user count, detected plugins, and per-field coverage stats
 */
export function displayBetterAuthExportSummary(
	result: BetterAuthExportResult
): void {
	const { userCount, outputPath, detectedPlugins, fieldCoverage } = result;

	// Show detected plugins
	if (detectedPlugins.length > 0) {
		p.log.info(
			`Detected plugins: ${detectedPlugins.map((pl) => color.cyan(pl)).join(', ')}`
		);
	}

	displayFieldCoverage(
		[
			{ label: 'have email', count: fieldCoverage.email },
			{ label: 'email verified', count: fieldCoverage.emailVerified },
			{ label: 'have name', count: fieldCoverage.name },
			{ label: 'have password hash', count: fieldCoverage.password },
			{ label: 'have username', count: fieldCoverage.username },
			{ label: 'have phone', count: fieldCoverage.phone },
		],
		userCount,
		outputPath
	);
}

/**
 * CLI wrapper for the Better Auth export command
 *
 * Prompts for a connection string if not provided via --db-url flag or
 * BETTER_AUTH_DB_URL environment variable, then exports users to a JSON file.
 */
export async function runBetterAuthExport(): Promise<void> {
	p.intro(color.bgCyan(color.black('Better Auth User Export')));

	const {
		dbUrl: resolvedUrl,
		outputFile,
		warning,
	} = resolveConnectionString(
		process.argv.slice(2),
		process.env as Record<string, string | undefined>,
		{
			envVarName: 'BETTER_AUTH_DB_URL',
			defaultOutputFile: 'betterauth-export.json',
		}
	);

	let dbUrl = resolvedUrl;

	if (warning) {
		p.log.warn(color.yellow(warning));
	}

	// Prompt for connection string if not resolved from flag or env
	if (!dbUrl) {
		p.note(
			`Better Auth stores data in your application database.\n\n${color.bold('PostgreSQL')}:\n  ${color.dim('postgresql://user:password@host:5432/database')}\n\n${color.bold('MySQL')}:\n  ${color.dim('mysql://user:password@host:3306/database')}\n\n${color.bold('SQLite')}:\n  ${color.dim('/path/to/database.sqlite')}`,
			'Connection String'
		);

		const input = await p.text({
			message: 'Enter your database connection string',
			placeholder: 'postgresql://user:password@host:5432/database',
			validate: (value) => {
				if (!value || value.trim() === '') {
					return 'Connection string is required';
				}
				if (!isValidConnectionString(value)) {
					return 'Must be a valid database connection string (postgresql://, mysql://, or a file path)';
				}
			},
		});

		if (p.isCancel(input)) {
			p.cancel('Export cancelled.');
			process.exit(0);
		}

		dbUrl = input;
	}

	const spinner = p.spinner();
	spinner.start('Connecting to database...');

	try {
		const result = await exportBetterAuthUsers(dbUrl, outputFile);
		spinner.stop(`Found ${result.userCount} users`);

		displayBetterAuthExportSummary(result);

		p.log.info(
			color.dim(
				`Next step: run ${color.bold('bun run migrate')} with file "exports/${outputFile}"`
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
