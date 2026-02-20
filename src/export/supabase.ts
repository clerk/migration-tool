/**
 * Supabase user export module
 *
 * Connects to a Supabase Postgres database and exports users from the auth.users table
 * in a format compatible with the Supabase migration transformer.
 *
 * Includes:
 * - encrypted_password (bcrypt hashes) — not available via Supabase Admin API
 * - first_name extracted from raw_user_meta_data.display_name
 * - All standard auth fields (email, phone, confirmation status, metadata)
 */
import { Client } from 'pg';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
	displayFieldCoverage,
	getDbConnectionErrorHint,
	isValidConnectionString,
	resolveConnectionString,
	writeExportOutput,
} from '../lib';
import type { BaseExportResult } from '../types';

/**
 * SQL query that exports users in the format expected by the Supabase transformer.
 *
 * Extracts display_name from raw_user_meta_data as first_name so the transformer
 * can map it directly without custom SQL from the user.
 */
const EXPORT_QUERY = `
  SELECT
    id,
    email,
    email_confirmed_at,
    encrypted_password,
    phone,
    phone_confirmed_at,
    COALESCE(
      raw_user_meta_data->>'display_name',
      raw_user_meta_data->>'first_name',
      raw_user_meta_data->>'name'
    ) as first_name,
    raw_user_meta_data->>'last_name' as last_name,
    raw_user_meta_data,
    raw_app_meta_data,
    created_at
  FROM auth.users
  ORDER BY created_at
`;

interface SupabaseExportResult extends BaseExportResult {
	fieldCoverage: {
		email: number;
		emailConfirmed: number;
		password: number;
		phone: number;
		firstName: number;
		lastName: number;
	};
}

/**
 * Exports users from a Supabase Postgres database to a JSON file.
 *
 * @param dbUrl - Postgres connection string (e.g., postgresql://postgres:password@db.xxx.supabase.co:5432/postgres)
 * @param outputFile - Output file path (relative to project root)
 * @returns Export result with user count and field coverage stats
 */
export async function exportSupabaseUsers(
	dbUrl: string,
	outputFile: string
): Promise<SupabaseExportResult> {
	const client = new Client({ connectionString: dbUrl });

	try {
		await client.connect();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const hint = getDbConnectionErrorHint(message, 'supabase');
		throw new Error(
			`Failed to connect to Supabase database: ${message}\n\n${hint}`
		);
	}

	try {
		interface SupabaseUserRow {
			email: string | null;
			email_confirmed_at: string | null;
			encrypted_password: string | null;
			phone: string | null;
			first_name: string | null;
			last_name: string | null;
			[key: string]: unknown;
		}

		let rows: SupabaseUserRow[];
		try {
			({ rows } = await client.query<SupabaseUserRow>(EXPORT_QUERY));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (
				message.includes('does not exist') ||
				message.includes('permission denied')
			) {
				throw new Error(
					`Could not read from auth.users: ${message}\n\n` +
						'The auth.users table is created automatically when Supabase Auth is enabled.\n' +
						'Ensure Auth is enabled in Supabase Dashboard → Authentication, and that\n' +
						'you are connecting with the postgres role (not an application-level role).'
				);
			}
			throw err;
		}

		// Calculate field coverage
		const coverage = {
			email: 0,
			emailConfirmed: 0,
			password: 0,
			phone: 0,
			firstName: 0,
			lastName: 0,
		};

		for (const row of rows) {
			if (row.email) coverage.email++;
			if (row.email_confirmed_at) coverage.emailConfirmed++;
			if (row.encrypted_password) coverage.password++;
			if (row.phone) coverage.phone++;
			if (row.first_name) coverage.firstName++;
			if (row.last_name) coverage.lastName++;
		}

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
 * Displays the export results as a field coverage report and success message.
 *
 * @param result - Export result containing user count, output path, and per-field coverage stats
 */
export function displayExportSummary(result: SupabaseExportResult): void {
	const { userCount, outputPath, fieldCoverage } = result;

	displayFieldCoverage(
		[
			{ label: 'have email', count: fieldCoverage.email },
			{ label: 'email confirmed', count: fieldCoverage.emailConfirmed },
			{ label: 'have password hash', count: fieldCoverage.password },
			{ label: 'have phone', count: fieldCoverage.phone },
			{ label: 'have first name', count: fieldCoverage.firstName },
			{ label: 'have last name', count: fieldCoverage.lastName },
		],
		userCount,
		outputPath
	);
}

/**
 * CLI wrapper for the Supabase export command
 *
 * Prompts for a connection string if not provided via --db-url flag or
 * SUPABASE_DB_URL environment variable, then exports users to a JSON file.
 */
export async function runSupabaseExport(): Promise<void> {
	p.intro(color.bgCyan(color.black('Supabase User Export')));

	const {
		dbUrl: resolvedUrl,
		outputFile,
		warning,
	} = resolveConnectionString(
		process.argv.slice(2),
		process.env as Record<string, string | undefined>
	);

	let dbUrl = resolvedUrl;

	if (warning) {
		p.log.warn(color.yellow(warning));
	}

	// Prompt for connection string if not resolved from flag or env
	if (!dbUrl) {
		p.note(
			`Find this in the Supabase Dashboard by clicking the ${color.bold('Connect')} button.\n\n${color.bold('Direct connection')} (requires IPv4 add-on):\n  ${color.dim('postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres')}\n\n${color.bold('Pooler connection')} (works without IPv4 add-on):\n  ${color.dim('postgres://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres')}`,
			'Connection String'
		);

		const input = await p.text({
			message: 'Enter your Supabase Postgres connection string',
			placeholder:
				'postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres',
			validate: (value) => {
				if (!value || value.trim() === '') {
					return 'Connection string is required';
				}
				if (!isValidConnectionString(value)) {
					return 'Must be a valid Postgres connection string (postgresql://...)';
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
	spinner.start('Connecting to Supabase database...');

	try {
		const result = await exportSupabaseUsers(dbUrl, outputFile);
		spinner.stop(`Found ${result.userCount} users`);

		displayExportSummary(result);

		p.log.info(
			color.dim(
				`Next step: run ${color.bold('bun run migrate')} and select "Supabase" with file "exports/${outputFile}"`
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
