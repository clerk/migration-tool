/**
 * Export entry point
 *
 * Dispatches to the appropriate platform-specific export based on
 * CLI flags or interactive selection. Reads available exports from
 * the registry in registry.ts.
 *
 * Usage:
 *   bun run export                             # Interactive platform picker
 *   bun run export -- --platform clerk         # Direct Clerk export
 *   bun run export -- --platform supabase      # Direct Supabase export
 *   bun run export -- --platform betterauth    # Direct Better Auth export
 */
import 'dotenv/config';
import * as p from '@clack/prompts';
import { exports } from './registry';

/**
 * Parses the --platform flag from CLI arguments
 * @returns The platform value or undefined if not provided
 */
function parsePlatformArg(): string | undefined {
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--platform' && args[i + 1]) {
			return args[i + 1];
		}
	}
	return undefined;
}

async function main() {
	const platformArg = parsePlatformArg();

	let platform = platformArg;

	if (!platform) {
		const selected = await p.select({
			message: 'Which platform would you like to export from?',
			options: exports.map((e) => ({
				value: e.key,
				label: e.label,
				description: e.description,
			})),
		});

		if (p.isCancel(selected)) {
			p.cancel('Export cancelled.');
			process.exit(0);
		}
		platform = selected;
	}

	const entry = exports.find((e) => e.key === platform);

	if (!entry) {
		p.log.error(`Unknown platform: ${platform}`);
		process.exit(1);
	}

	await entry.run();
}

void main();
