/**
 * AuthJS (Next-Auth) user export module
 *
 * Connects to a database used by AuthJS (Prisma adapter) and exports users
 * from the "User" and "Account" tables to a JSON file.
 *
 * Supports PostgreSQL, MySQL, and SQLite via the shared database abstraction.
 *
 * Core tables (Prisma adapter default names):
 *   - "User"    (core user identity)
 *   - "Account" (OAuth providers — joined to detect provider usage)
 *
 * Usage:
 *   bun run export:authjs
 *   bun run export:authjs -- --db-url postgresql://... --output users.json
 *
 * Environment variables:
 *   AUTHJS_DB_URL - Database connection string (PostgreSQL, MySQL, or SQLite path)
 *
 * Priority: --db-url flag > AUTHJS_DB_URL env var > interactive prompt
 */
import * as p from '@clack/prompts';
import color from 'picocolors';
import { createDbClient, type DbClient } from '../lib/db';
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

interface AuthJSExportResult extends BaseExportResult {
	fieldCoverage: {
		email: number;
		emailVerified: number;
		name: number;
	};
}

interface AuthJSUserRow {
	id: string;
	name: string | null;
	email: string | null;
	email_verified: string | boolean | null;
	[key: string]: unknown;
}

/**
 * Builds the export SQL query with correct identifier quoting for the database type.
 *
 * @param dbType - The database type (postgres, mysql, sqlite)
 * @param tableCasing - Whether to use PascalCase or lowercase table names
 * @returns SQL SELECT query string
 */
function buildExportQuery(
	dbType: 'postgres' | 'mysql' | 'sqlite',
	tableCasing: 'pascal' | 'lower' = 'pascal'
): string {
	if (dbType === 'mysql') {
		const user = tableCasing === 'pascal' ? '`User`' : '`user`';
		return `SELECT u.\`id\`, u.\`name\`, u.\`email\`, u.\`emailVerified\` AS email_verified FROM ${user} u ORDER BY u.\`id\` ASC`;
	}

	// PostgreSQL and SQLite use double-quoted identifiers
	const user = tableCasing === 'pascal' ? '"User"' : '"user"';
	return `SELECT u."id", u."name", u."email", u."emailVerified" AS email_verified FROM ${user} u ORDER BY u."id" ASC`;
}

/**
 * Exports users from an AuthJS database to a JSON file.
 *
 * Connects to the database, queries the User table with appropriate
 * identifier quoting, and writes results to the exports/ directory.
 *
 * If the initial query fails with a "does not exist" error, retries
 * with lowercase table names as a fallback.
 *
 * @param dbUrl - Database connection string (PostgreSQL, MySQL, or SQLite path)
 * @param outputFile - Output file name (written inside exports/ directory)
 * @returns Export result with user count and field coverage stats
 */
export async function exportAuthJSUsers(
	dbUrl: string,
	outputFile: string
): Promise<AuthJSExportResult> {
	let client: DbClient;

	try {
		client = await createDbClient(dbUrl);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const hint = getDbConnectionErrorHint(message, 'authjs');
		throw new Error(`Failed to connect to database: ${message}\n\n${hint}`);
	}

	try {
		let rows: AuthJSUserRow[];

		// Try PascalCase table names first (Prisma adapter default)
		const query = buildExportQuery(client.dbType, 'pascal');

		try {
			({ rows } = await client.query<AuthJSUserRow>(query));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			// If table not found, retry with lowercase
			if (
				message.includes('does not exist') ||
				message.includes("doesn't exist") ||
				message.includes('no such table')
			) {
				const fallbackQuery = buildExportQuery(client.dbType, 'lower');
				try {
					({ rows } = await client.query<AuthJSUserRow>(fallbackQuery));
				} catch (retryErr) {
					const retryMessage =
						retryErr instanceof Error ? retryErr.message : String(retryErr);
					throw new Error(
						`Could not find AuthJS tables: ${retryMessage}\n\n` +
							'The AuthJS Prisma adapter creates "User" and "Account" tables.\n' +
							'Ensure AuthJS has been set up and the database has been migrated\n' +
							'(npx prisma migrate deploy).'
					);
				}
			} else if (message.includes('permission denied')) {
				throw new Error(
					`Could not read from AuthJS tables: ${message}\n\n` +
						'Ensure the database user has SELECT permission on the "User" table.'
				);
			} else {
				throw err;
			}
		}

		// Calculate field coverage and log each user
		const dateTime = getDateTimeStamp();
		const coverage = {
			email: 0,
			emailVerified: 0,
			name: 0,
		};

		for (const row of rows) {
			if (row.email) coverage.email++;
			if (row.email_verified) coverage.emailVerified++;
			if (row.name) coverage.name++;

			exportLogger({ userId: row.id, status: 'success' }, dateTime);
		}

		closeAllStreams();

		const outputPath = writeExportOutput(rows, outputFile);

		return {
			userCount: rows.length,
			outputPath,
			fieldCoverage: coverage,
		};
	} finally {
		await client.end();
	}
}

/**
 * Displays the AuthJS export results as a field coverage report.
 *
 * @param result - Export result containing user count, output path, and per-field coverage stats
 */
export function displayAuthJSExportSummary(result: AuthJSExportResult): void {
	const { userCount, outputPath, fieldCoverage } = result;

	displayFieldCoverage(
		[
			{ label: 'have email', count: fieldCoverage.email },
			{ label: 'email verified', count: fieldCoverage.emailVerified },
			{ label: 'have name', count: fieldCoverage.name },
		],
		userCount,
		outputPath
	);
}

/**
 * CLI wrapper for the AuthJS export command.
 *
 * Prompts for a connection string if not provided via --db-url flag or
 * AUTHJS_DB_URL environment variable, then exports users to a JSON file.
 */
export async function runAuthJSExport(): Promise<void> {
	p.intro(color.bgCyan(color.black('AuthJS User Export')));

	const {
		dbUrl: resolvedUrl,
		outputFile,
		warning,
	} = resolveConnectionString(
		process.argv.slice(2),
		process.env as Record<string, string | undefined>,
		{
			envVarName: 'AUTHJS_DB_URL',
			defaultOutputFile: 'authjs-export.json',
		}
	);

	let dbUrl = resolvedUrl;

	if (warning) {
		p.log.warn(color.yellow(warning));
	}

	// Prompt for connection string if not resolved from flag or env
	if (!dbUrl) {
		p.note(
			`AuthJS stores data in your application database.\n\n${color.bold('PostgreSQL')}:\n  ${color.dim('postgresql://user:password@host:5432/database')}\n\n${color.bold('MySQL')}:\n  ${color.dim('mysql://user:password@host:3306/database')}\n\n${color.bold('SQLite')}:\n  ${color.dim('/path/to/database.sqlite')}`,
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
		const result = await exportAuthJSUsers(dbUrl, outputFile);
		spinner.stop(`Found ${result.userCount} users`);

		displayAuthJSExportSummary(result);

		p.log.info(
			color.dim(
				`Next step: run ${color.bold('bun run migrate')} and select "AuthJS" with file "exports/${outputFile}"`
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
