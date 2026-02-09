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
 *   SUPABASE_DB_URL - Postgres connection string (alternative to --db-url flag)
 */
import 'dotenv/config';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { exportSupabaseUsers, displayExportSummary } from './supabase';

async function main() {
	p.intro(color.bgCyan(color.black('Supabase User Export')));

	// Parse CLI flags
	const args = process.argv.slice(2);
	let dbUrl = process.env.SUPABASE_DB_URL;
	let outputFile = 'supabase-export.json';

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--db-url' && args[i + 1]) {
			dbUrl = args[i + 1];
			i++;
		} else if (args[i] === '--output' && args[i + 1]) {
			outputFile = args[i + 1];
			i++;
		}
	}

	// Prompt for DB URL if not provided
	if (!dbUrl) {
		p.note(
			`Find this in the Supabase Dashboard by clicking the ${color.bold('Connect')} button.\n\n` +
				`${color.bold('Direct connection')} (requires IPv6):\n` +
				`  ${color.dim('postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres')}\n\n` +
				`${color.bold('Pooler connection')} (works on IPv4 — use this if direct fails):\n` +
				`  ${color.dim('postgres://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres')}\n\n` +
				color.dim(
					'Alternatively, run the export SQL in the Supabase SQL Editor and save the result as JSON.'
				),
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
				if (
					!value.startsWith('postgresql://') &&
					!value.startsWith('postgres://')
				) {
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

main();
