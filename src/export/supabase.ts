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
import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

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

interface ExportResult {
	userCount: number;
	outputPath: string;
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
): Promise<ExportResult> {
	const client = new Client({ connectionString: dbUrl });

	try {
		await client.connect();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Failed to connect to Supabase database: ${message}\n\n` +
				`Connection string format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres\n` +
				`Find this in Supabase Dashboard → Settings → Database → Connection string`
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

		const { rows } = await client.query<SupabaseUserRow>(EXPORT_QUERY);

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

		// Write output
		const outputPath = path.isAbsolute(outputFile)
			? outputFile
			: path.join(process.cwd(), outputFile);

		fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));

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
 * Shows each field with an icon indicating coverage level:
 * - ● green — all users have this field
 * - ○ yellow — some users have this field
 * - ○ dim — no users have this field
 *
 * @param result - Export result containing user count, output path, and per-field coverage stats
 */
export function displayExportSummary(result: ExportResult): void {
	const { userCount, outputPath, fieldCoverage } = result;

	/** Returns a colored icon based on how many users have a given field. */
	const getCoverageIcon = (count: number, total: number): string => {
		if (count === total) return color.green('●');
		if (count > 0) return color.yellow('○');
		return color.dim('○');
	};

	let summary = '';
	summary += `${getCoverageIcon(fieldCoverage.email, userCount)} ${color.dim(`${fieldCoverage.email}/${userCount} have email`)}\n`;
	summary += `${getCoverageIcon(fieldCoverage.emailConfirmed, userCount)} ${color.dim(`${fieldCoverage.emailConfirmed}/${userCount} email confirmed`)}\n`;
	summary += `${getCoverageIcon(fieldCoverage.password, userCount)} ${color.dim(`${fieldCoverage.password}/${userCount} have password hash`)}\n`;
	summary += `${getCoverageIcon(fieldCoverage.phone, userCount)} ${color.dim(`${fieldCoverage.phone}/${userCount} have phone`)}\n`;
	summary += `${getCoverageIcon(fieldCoverage.firstName, userCount)} ${color.dim(`${fieldCoverage.firstName}/${userCount} have first name`)}\n`;
	summary += `${getCoverageIcon(fieldCoverage.lastName, userCount)} ${color.dim(`${fieldCoverage.lastName}/${userCount} have last name`)}`;

	p.note(summary, 'Field Coverage');
	p.log.success(
		`Exported ${color.bold(String(userCount))} users to ${color.dim(outputPath)}`
	);
}
