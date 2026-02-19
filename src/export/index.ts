/**
 * Supabase user export CLI
 *
 * Exports users from a Supabase Postgres database to a JSON file
 * compatible with the migration script's Supabase transformer.
 *
 * Usage:
 *   bun run export:supabase
 *   bun run export:supabase --db-url postgresql://... --output users.json
 *
 * Environment variables:
 *   SUPABASE_DB_URL - Postgres connection string
 *
 * Priority: --db-url flag > SUPABASE_DB_URL env var > interactive prompt
 */
import 'dotenv/config';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { displayExportSummary, exportSupabaseUsers } from './supabase';
import { isValidConnectionString, resolveConnectionString } from '../utils';

async function main() {
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
				`Next step: run ${color.bold('bun run migrate')} and select "Supabase" with file "${outputFile}"`
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

void main();
