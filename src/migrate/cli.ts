import * as p from '@clack/prompts';
import color from 'picocolors';
import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { transformers } from '../transformers';
import {
	firebaseHashConfig,
	isFirebaseHashConfigComplete,
	setFirebaseHashConfig,
} from '../transformers/firebase';
import {
	checkIfFileExists,
	createImportFilePath,
	getFileType,
	transformKeys as transformKeysFromFunctions,
	tryCatch,
} from '../lib';
import {
	hasClerkSecretKey,
	requireValidEnv,
	setClerkSecretKey,
} from '../envs-constants';
import type { FieldAnalysis, FirebaseHashConfig, Settings } from '../types';
import { loadSettings, saveSettings } from '../lib/settings';
import { analyzeFields, validateUsers } from '../lib/analysis';
import {
	analyzeUserProviders,
	fetchSupabaseProviders,
	findUsersWithDisabledProviders,
	OAUTH_PROVIDER_LABELS,
} from '../lib/supabase';
import { detectInstanceType, fetchClerkConfig } from '../lib/clerk';

/**
 * Parsed command-line arguments for the migration tool
 */
export type CLIArgs = {
	transformer?: string;
	file?: string;
	resumeAfter?: string;
	skipPasswordRequirement: boolean;
	skipUnsupportedProviders?: boolean;
	nonInteractive: boolean;
	help: boolean;
	// Authentication
	clerkSecretKey?: string;
	// Firebase-specific options
	firebaseSignerKey?: string;
	firebaseSaltSeparator?: string;
	firebaseRounds?: number;
	firebaseMemCost?: number;
};

const DEV_USER_LIMIT = 500;

/**
 * Displays help information for the CLI
 */
function showHelp(): void {
	const validPlatforms = transformers.map((t) => t.key).join(', ');

	// eslint-disable-next-line no-console
	console.log(`
Clerk User Migration Utility

USAGE:
  bun migrate [OPTIONS]

OPTIONS:
  -t, --transformer <transformer>   Source transformer (${validPlatforms})
  -f, --file <path>                 Path to the user data file (JSON or CSV)
  -r, --resume-after <userId>       Resume migration after this user ID
  --require-password                Only migrate users who have passwords (default: false)
  --skip-unsupported-providers      Skip users who only have unsupported providers (no prompt)
  -y, --yes                         Non-interactive mode (skip all confirmations)
  -h, --help                        Show this help message

AUTHENTICATION:
  --clerk-secret-key <key>      Clerk secret key (alternative to .env file)
                                Can also be set via CLERK_SECRET_KEY env var

FIREBASE OPTIONS (required when transformer is 'firebase'):
  --firebase-signer-key <key>       Firebase hash signer key (base64)
  --firebase-salt-separator <sep>   Firebase salt separator (base64)
  --firebase-rounds <num>           Firebase hash rounds
  --firebase-mem-cost <num>         Firebase memory cost

EXAMPLES:
  # Interactive mode (default)
  bun migrate

  # Non-interactive mode with all options
  bun migrate -y -t auth0 -f users.json

  # Non-interactive with secret key (no .env needed)
  bun migrate -y -t clerk -f users.json --clerk-secret-key sk_test_xxx

  # Resume a failed migration
  bun migrate -y -t clerk -f users.json -r user_abc123

  # Firebase migration with hash config
  bun migrate -y -t firebase -f users.csv \\
    --firebase-signer-key "abc123..." \\
    --firebase-salt-separator "Bw==" \\
    --firebase-rounds 8 \\
    --firebase-mem-cost 14

ENVIRONMENT VARIABLES:
  CLERK_SECRET_KEY      Your Clerk secret key (required, or use --clerk-secret-key)
  RATE_LIMIT            Override requests per second (default: 100 prod, 10 dev)
  CONCURRENCY_LIMIT     Override concurrent requests (default: ~9 prod, ~1 dev)

NOTES:
  - In non-interactive mode (-y), --transformer and --file are required
  - Firebase migrations require all four --firebase-* options
  - The tool auto-detects dev/prod instance from CLERK_SECRET_KEY
`);
}

/**
 * Prompts the user to provide the CLERK_SECRET_KEY if it's missing
 *
 * In interactive mode, prompts the user to enter the key directly.
 * In non-interactive mode, shows an error message with instructions.
 *
 * @param nonInteractive - Whether running in non-interactive mode
 * @param cliProvidedKey - Optional key provided via --clerk-secret-key flag
 * @returns true if the key was provided and validated, false otherwise
 */
async function ensureClerkSecretKey(
	nonInteractive: boolean,
	cliProvidedKey?: string
): Promise<boolean> {
	// If key was provided via CLI flag, use it
	if (cliProvidedKey) {
		const isValid = setClerkSecretKey(cliProvidedKey);
		if (!isValid) {
			if (nonInteractive) {
				// eslint-disable-next-line no-console
				console.error('Error: Invalid CLERK_SECRET_KEY provided.');
			} else {
				p.log.error('Invalid CLERK_SECRET_KEY provided.');
			}
			return false;
		}
		return true;
	}

	if (hasClerkSecretKey()) {
		requireValidEnv();
		return true;
	}

	if (nonInteractive) {
		// eslint-disable-next-line no-console
		console.error('Error: CLERK_SECRET_KEY is not set.\n');
		// eslint-disable-next-line no-console
		console.error('To fix this, either:');
		// eslint-disable-next-line no-console
		console.error('  1. Create a .env file with: CLERK_SECRET_KEY=sk_test_...');
		// eslint-disable-next-line no-console
		console.error(
			'  2. Set the environment variable: export CLERK_SECRET_KEY=sk_test_...\n'
		);
		// eslint-disable-next-line no-console
		console.error(
			'You can find your secret key in the Clerk Dashboard under API Keys.'
		);
		return false;
	}

	// Interactive mode - prompt for the key
	p.note(
		`${color.yellow('CLERK_SECRET_KEY is not set.')}\n\n` +
			`You can find your secret key in the Clerk Dashboard:\n` +
			`${color.cyan('Dashboard → API Keys → Secret keys')}\n\n` +
			`Alternatively, create a ${color.bold('.env')} file with:\n` +
			`${color.dim('CLERK_SECRET_KEY=sk_test_...')}`,
		'Missing API Key'
	);

	const secretKey = await p.text({
		message: 'Enter your Clerk Secret Key',
		placeholder: 'sk_test_... or sk_live_...',
		validate: (value) => {
			if (!value || value.trim() === '') {
				return 'Secret key is required';
			}
			if (!value.startsWith('sk_test_') && !value.startsWith('sk_live_')) {
				return 'Secret key must start with sk_test_ or sk_live_';
			}
		},
	});

	if (p.isCancel(secretKey)) {
		p.cancel('Migration cancelled.');
		process.exit(0);
	}

	const trimmedKey = secretKey.trim();
	const isValid = setClerkSecretKey(trimmedKey);
	if (!isValid) {
		p.log.error('Failed to validate the secret key.');
		return false;
	}

	p.log.success('Secret key validated successfully.');

	// Ask if user wants to save the key to .env file
	const envPath = path.join(process.cwd(), '.env');
	const envExists = fs.existsSync(envPath);

	const saveToEnv = await p.confirm({
		message: envExists
			? 'Would you like to add CLERK_SECRET_KEY to your existing .env file?'
			: 'Would you like to create a .env file with your secret key?',
		initialValue: true,
	});

	if (p.isCancel(saveToEnv)) {
		// User cancelled, but key is still valid for this session
		return true;
	}

	if (saveToEnv) {
		try {
			const envLine = `CLERK_SECRET_KEY=${trimmedKey}\n`;
			if (envExists) {
				// Check if CLERK_SECRET_KEY already exists in the file
				const existingContent = fs.readFileSync(envPath, 'utf-8');
				if (existingContent.includes('CLERK_SECRET_KEY=')) {
					// Replace existing key
					const updatedContent = existingContent.replace(
						/CLERK_SECRET_KEY=.*/,
						`CLERK_SECRET_KEY=${trimmedKey}`
					);
					fs.writeFileSync(envPath, updatedContent);
					p.log.success('Updated CLERK_SECRET_KEY in .env file.');
				} else {
					// Append to existing file
					fs.appendFileSync(envPath, envLine);
					p.log.success('Added CLERK_SECRET_KEY to .env file.');
				}
			} else {
				// Create new .env file
				fs.writeFileSync(envPath, envLine);
				p.log.success('Created .env file with CLERK_SECRET_KEY.');
			}
		} catch {
			p.log.warn(
				'Could not save to .env file. The key will still work for this session.'
			);
		}
	}

	return true;
}

/**
 * Parses command-line arguments into a CLIArgs object
 *
 * @param argv - Array of command-line arguments (without node/bun and tool path)
 * @returns Parsed CLI arguments
 */
export function parseArgs(argv: string[]): CLIArgs {
	const args: CLIArgs = {
		skipPasswordRequirement: true,
		nonInteractive: false,
		help: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const nextArg = argv[i + 1];

		switch (arg) {
			case '-h':
			case '--help':
				args.help = true;
				break;
			case '-y':
			case '--yes':
				args.nonInteractive = true;
				break;
			case '-t':
			case '--transformer':
				args.transformer = nextArg;
				i++;
				break;
			case '-f':
			case '--file':
				args.file = nextArg;
				i++;
				break;
			case '-r':
			case '--resume-after':
				args.resumeAfter = nextArg;
				i++;
				break;
			case '--skip-password-requirement':
				// Legacy flag, kept for backwards compatibility (now default)
				args.skipPasswordRequirement = true;
				break;
			case '--require-password':
				args.skipPasswordRequirement = false;
				break;
			case '--skip-unsupported-providers':
				args.skipUnsupportedProviders = true;
				break;
			case '--clerk-secret-key':
				args.clerkSecretKey = nextArg;
				i++;
				break;
			case '--firebase-signer-key':
				args.firebaseSignerKey = nextArg;
				i++;
				break;
			case '--firebase-salt-separator':
				args.firebaseSaltSeparator = nextArg;
				i++;
				break;
			case '--firebase-rounds':
				args.firebaseRounds = parseInt(nextArg, 10);
				i++;
				break;
			case '--firebase-mem-cost':
				args.firebaseMemCost = parseInt(nextArg, 10);
				i++;
				break;
		}
	}

	return args;
}

/**
 * Validates CLI arguments for non-interactive mode
 *
 * @param args - Parsed CLI arguments
 * @returns Error message if validation fails, null if valid
 */
function validateNonInteractiveArgs(args: CLIArgs): string | null {
	if (!args.transformer) {
		return 'Missing required argument: --transformer (-t)';
	}

	const validTransformers = transformers.map((t) => t.key);
	if (!validTransformers.includes(args.transformer)) {
		return `Invalid transformer: ${args.transformer}. Valid options: ${validTransformers.join(', ')}`;
	}

	if (!args.file) {
		return 'Missing required argument: --file (-f)';
	}

	if (!checkIfFileExists(args.file)) {
		return `File not found: ${args.file}`;
	}

	const fileType = getFileType(args.file);
	if (fileType !== 'text/csv' && fileType !== 'application/json') {
		return 'Invalid file type. Please supply a valid JSON or CSV file';
	}

	// Firebase-specific validation
	if (args.transformer === 'firebase') {
		const hasAnyFirebaseArg =
			args.firebaseSignerKey ||
			args.firebaseSaltSeparator ||
			args.firebaseRounds ||
			args.firebaseMemCost;

		const hasAllFirebaseArgs =
			args.firebaseSignerKey &&
			args.firebaseSaltSeparator &&
			args.firebaseRounds &&
			args.firebaseMemCost;

		// Check if config is already set in transformer or settings
		if (!isFirebaseHashConfigComplete() && !hasAllFirebaseArgs) {
			const savedSettings = loadSettings();
			const savedConfig = savedSettings.firebaseHashConfig;
			const hasSettingsConfig =
				savedConfig &&
				savedConfig.base64_signer_key &&
				savedConfig.base64_salt_separator &&
				savedConfig.rounds &&
				savedConfig.mem_cost;

			if (!hasSettingsConfig) {
				if (hasAnyFirebaseArg) {
					return 'Firebase migration requires all hash config options: --firebase-signer-key, --firebase-salt-separator, --firebase-rounds, --firebase-mem-cost';
				}
				return 'Firebase migration requires hash configuration. Provide all --firebase-* options or run in interactive mode to configure.';
			}
		}
	}

	return null;
}

/**
 * Runs the migration in non-interactive mode using CLI arguments
 *
 * @param args - Parsed CLI arguments
 * @returns Configuration object for the migration
 */
/* eslint-disable no-console */
export async function runNonInteractive(args: CLIArgs): Promise<{
	key: string;
	file: string;
	resumeAfter: string;
	instance: 'dev' | 'prod';
	begin: boolean;
	skipPasswordRequirement: boolean;
	excludedUserIds: Set<string>;
}> {
	// Handle help flag
	if (args.help) {
		showHelp();
		process.exit(0);
	}

	// Ensure CLERK_SECRET_KEY is set (via CLI flag, env var, or .env file)
	const hasKey = await ensureClerkSecretKey(true, args.clerkSecretKey);
	if (!hasKey) {
		process.exit(1);
	}

	// Validate arguments
	const validationError = validateNonInteractiveArgs(args);
	if (validationError) {
		console.error(`Error: ${validationError}`);
		console.error('Run "bun migrate --help" for usage information.');
		process.exit(1);
	}

	// These are guaranteed to be defined after validation
	const transformer = args.transformer as string;
	const file = args.file as string;

	console.log(`\nClerk User Migration Utility (non-interactive mode)\n`);
	console.log(`Transformer: ${transformer}`);
	console.log(`File: ${file}`);
	if (args.resumeAfter) {
		console.log(`Resume after: ${args.resumeAfter}`);
	}

	// Handle Firebase hash configuration
	if (transformer === 'firebase') {
		if (
			args.firebaseSignerKey &&
			args.firebaseSaltSeparator &&
			args.firebaseRounds &&
			args.firebaseMemCost
		) {
			// Use CLI-provided config
			const firebaseConfig: FirebaseHashConfig = {
				base64_signer_key: args.firebaseSignerKey,
				base64_salt_separator: args.firebaseSaltSeparator,
				rounds: args.firebaseRounds,
				mem_cost: args.firebaseMemCost,
			};
			setFirebaseHashConfig(firebaseConfig);
			console.log('Firebase hash configuration: provided via CLI');
		} else if (!isFirebaseHashConfigComplete()) {
			// Use saved settings
			const savedSettings = loadSettings();
			if (savedSettings.firebaseHashConfig) {
				setFirebaseHashConfig(savedSettings.firebaseHashConfig);
				console.log('Firebase hash configuration: loaded from .settings');
			}
		} else {
			console.log('Firebase hash configuration: found in transformer');
		}
	}

	// Load and analyze users
	console.log('\nAnalyzing import file...');

	const [users, error] = await tryCatch(loadRawUsers(file, transformer));

	if (error) {
		console.error(
			'Failed to analyze import file. Please check the file format.'
		);
		process.exit(1);
	}

	// Filter users if resuming
	let filteredUsers = users;
	if (args.resumeAfter) {
		const resumeIndex = users.findIndex((u) => u.userId === args.resumeAfter);
		if (resumeIndex === -1) {
			console.error(
				`Could not find user ID "${args.resumeAfter}" in the import file.`
			);
			process.exit(1);
		}
		filteredUsers = users.slice(resumeIndex + 1);
		console.log(
			`Resuming after user ID: ${args.resumeAfter} (skipping ${resumeIndex + 1} users)`
		);
	}

	const userCount = filteredUsers.length;
	console.log(`Found ${userCount} users to migrate`);

	// Check instance type
	const instanceType = detectInstanceType();
	console.log(`Instance type: ${instanceType}`);

	if (instanceType === 'dev' && userCount > DEV_USER_LIMIT) {
		console.error(
			`Cannot import ${userCount} users to a development instance. ` +
				`Development instances are limited to ${DEV_USER_LIMIT} users.`
		);
		process.exit(1);
	}

	// Analyze fields for validation feedback
	const analysis = analyzeFields(filteredUsers);

	if (analysis.identifiers.hasAnyIdentifier === 0) {
		console.error(
			'No users can be imported. All users are missing an identifier (verified email, verified phone, or username).'
		);
		process.exit(1);
	}

	// Check for users without identifiers
	const usersWithoutIdentifier =
		analysis.totalUsers - analysis.identifiers.hasAnyIdentifier;
	if (usersWithoutIdentifier > 0) {
		console.warn(
			`Warning: ${usersWithoutIdentifier} user(s) will be skipped (missing identifier)`
		);
	}

	// Determine skipPasswordRequirement
	let skipPasswordRequirement = args.skipPasswordRequirement;
	const usersWithPasswords = analysis.fieldCounts.password || 0;
	if (usersWithPasswords === 0) {
		skipPasswordRequirement = true;
	} else if (usersWithPasswords < userCount && skipPasswordRequirement) {
		console.log(
			`Note: ${userCount - usersWithPasswords} user(s) don't have passwords and will be migrated. ` +
				`Use --require-password to skip them.`
		);
	}

	console.log('\nStarting migration...\n');

	// Save settings for future runs
	saveSettings({
		key: transformer,
		file,
	});

	return {
		key: transformer,
		file,
		resumeAfter: args.resumeAfter || '',
		instance: instanceType,
		begin: true,
		skipPasswordRequirement,
		excludedUserIds: new Set<string>(),
	};
}

/**
 * Loads and transforms users from a file without validation
 *
 * Reads users from JSON or CSV files and applies the transformer's field transformations
 * and postTransform logic. Used for analyzing file contents before migration.
 * Does not validate against the schema.
 *
 * @param file - The file path to load users from
 * @param transformerKey - The transformer key identifying which platform to migrate from
 * @returns Array of transformed user objects (not validated)
 * @throws Error if transformer is not found for the given key
 */
export const loadRawUsers = async (
	file: string,
	transformerKey: string
): Promise<Record<string, unknown>[]> => {
	let filePath = createImportFilePath(file);
	const type = getFileType(filePath);
	const transformer = transformers.find((h) => h.key === transformerKey);

	if (!transformer) {
		throw new Error(`Transformer not found for key: ${transformerKey}`);
	}

	// Run preTransform if defined (e.g., Firebase needs to add CSV headers or extract JSON users array)
	let preExtractedData: Record<string, unknown>[] | undefined;
	if ('preTransform' in transformer) {
		const preTransformResult = await Promise.resolve(
			transformer.preTransform(filePath, type || '')
		);
		filePath = preTransformResult.filePath;
		preExtractedData = preTransformResult.data as
			| Record<string, unknown>[]
			| undefined;
	}

	const transformUser = (
		data: Record<string, unknown>
	): Record<string, unknown> => {
		const transformed = transformKeysFromFunctions(data, transformer);
		// Apply postTransform if defined
		if (
			'postTransform' in transformer &&
			typeof transformer.postTransform === 'function'
		) {
			transformer.postTransform(transformed);
		}
		return transformed;
	};

	if (type === 'text/csv') {
		return new Promise((resolve, reject) => {
			const users: Record<string, unknown>[] = [];
			fs.createReadStream(filePath)
				.pipe(csvParser({ skipComments: true }))
				.on('data', (data: Record<string, unknown>) =>
					users.push(transformUser(data))
				)
				.on('error', (err) => reject(err))
				.on('end', () => resolve(users));
		});
	}

	// Use pre-extracted data if available (from preTransform), otherwise parse the file
	const rawUsers = preExtractedData
		? preExtractedData
		: (JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
				string,
				unknown
			>[]);
	return rawUsers.map((data) => transformUser(data));
};

// --- Cross-Reference Display ---

interface ReadinessItem {
	label: string;
	userCount: number;
	clerkEnabled: boolean | null; // null = Clerk config not available
	clerkRequired: boolean | null; // null = Clerk config not available
	section: 'identifiers' | 'auth' | 'social' | 'model';
}

interface ConfigStatus {
	clerk: 'loaded' | 'failed' | 'skipped';
	supabase?: 'loaded' | 'failed' | 'skipped'; // undefined = not a supabase migration
}

/**
 * Displays a unified migration readiness report.
 *
 * Combines configuration check status, validation results, and user data
 * analysis into a single report. Sections:
 *
 * 1. **Clerk Configuration** — whether the config was loaded, failed, or skipped,
 *    with actionable guidance for non-success cases
 * 2. **Supabase Configuration** (Supabase migrations only) — same pattern
 * 3. **Import File** — total users, validation failures, and per-field readiness:
 *    - ✓ enabled in Clerk (green)
 *    - ✗ not enabled in Clerk (red, needs attention)
 *    - ⚠ required in Clerk but not all users have it (yellow, will cause failures)
 *    - ○ status unknown, enable in Dashboard (yellow, no Clerk config available)
 *
 * For identifiers (email, phone, username), provides actionable guidance on
 * whether the field can safely be required based on user coverage.
 *
 * @param items - List of readiness items to display
 * @param analysis - Field analysis results for total user count and identifier check
 * @param configStatus - Whether Clerk/Supabase config checks succeeded, failed, or were skipped
 * @param validation - Validation results: failure count and log file path (0 failures hides the line)
 */
export function displayCrossReference(
	items: ReadinessItem[],
	analysis: FieldAnalysis,
	configStatus: ConfigStatus = { clerk: 'skipped' },
	validation: { validationFailed: number; logFile: string } = {
		validationFailed: 0,
		logFile: '',
	}
): void {
	let message = '';

	// --- Clerk Configuration section ---
	message += color.bold(color.whiteBright('Clerk Configuration\n'));
	if (configStatus.clerk === 'loaded') {
		message += `  ${color.green('✓')} ${color.dim('Configuration loaded from Clerk')}\n`;
	} else if (configStatus.clerk === 'failed') {
		message += `  ${color.yellow('⚠')} ${color.yellow('Could not fetch Clerk configuration')}\n`;
		message += `  ${color.dim('  Verify your Clerk Dashboard settings match the report below')}\n`;
	} else {
		message += `  ${color.yellow('○')} ${color.dim('Add CLERK_PUBLISHABLE_KEY to .env and restart to enable automatic checking,')}\n`;
		message += `  ${color.dim('  or verify your Clerk Dashboard settings match the report below')}\n`;
	}
	message += '\n';

	// --- Supabase Configuration section (only for Supabase migrations) ---
	if (configStatus.supabase !== undefined) {
		message += color.bold(color.whiteBright('Supabase Configuration\n'));
		if (configStatus.supabase === 'loaded') {
			message += `  ${color.green('✓')} ${color.dim('Auth settings loaded from Supabase')}\n`;
		} else if (configStatus.supabase === 'failed') {
			message += `  ${color.yellow('⚠')} ${color.yellow('Could not fetch Supabase auth settings')}\n`;
			message += `  ${color.dim('  Social connections were not checked')}\n`;
		} else {
			message += `  ${color.yellow('○')} ${color.dim('Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env')}\n`;
			message += `  ${color.dim('  and restart to check social connections')}\n`;
		}
		message += '\n';
	}

	// --- Import File section ---
	const total = analysis.totalUsers;
	message += color.bold(color.whiteBright('Import File\n'));
	message += `  ${color.dim(`${total} user${total === 1 ? '' : 's'} in file`)}\n`;

	if (validation.validationFailed > 0) {
		message += `  ${color.yellow(`${validation.validationFailed} user${validation.validationFailed === 1 ? '' : 's'} failed validation and will be skipped`)} — ${color.dim(`see logs/${validation.logFile}`)}\n`;
	}
	message += '\n';

	// --- Field readiness sections ---
	const sections: Partial<Record<string, ReadinessItem[]>> = {};
	for (const item of items) {
		if (!sections[item.section]) sections[item.section] = [];
		sections[item.section].push(item);
	}

	const needsAttention: ReadinessItem[] = [];

	const sectionLabels: Record<string, string> = {
		identifiers: 'Identifiers',
		auth: 'Authentication',
		social: 'Social Connections',
		model: 'User Model',
	};

	const sectionOrder = ['identifiers', 'auth', 'social', 'model'];

	for (const section of sectionOrder) {
		const sectionItems = sections[section];
		if (!sectionItems || sectionItems.length === 0) continue;

		message += color.bold(color.whiteBright(`${sectionLabels[section]}\n`));

		for (const item of sectionItems) {
			const allUsers = item.userCount === total;
			const countStr = allUsers
				? 'all users'
				: `${item.userCount}/${total} users`;
			const isIdentifier = item.section === 'identifiers';

			if (item.clerkEnabled === true) {
				// Enabled + required but not all users have it → will cause import failures
				if (isIdentifier && item.clerkRequired === true && !allUsers) {
					const missing = total - item.userCount;
					message += `  ${color.yellow('⚠')} ${item.label} — ${color.yellow('required in Clerk')} — ${color.dim(`${countStr} (${missing} will fail without ${item.label.toLowerCase()})`)}\n`;
					needsAttention.push(item);
				} else {
					message += `  ${color.green('✓')} ${item.label} — ${color.dim(`enabled in Clerk — ${countStr}`)}\n`;
				}
			} else if (item.clerkEnabled === false) {
				message += `  ${color.red('✗')} ${item.label} — ${color.red('not enabled in Clerk')} — ${color.dim(countStr)}\n`;
				needsAttention.push(item);
			} else if (isIdentifier && allUsers) {
				// No Clerk config — all users have this identifier, safe to require
				message += `  ${color.yellow('○')} ${item.label} — ${color.dim(`${countStr} — enable in Clerk Dashboard (can be required)`)}\n`;
			} else if (isIdentifier) {
				// No Clerk config — not all users have this identifier, requiring would cause failures
				message += `  ${color.yellow('○')} ${item.label} — ${color.dim(`${countStr} — enable in Clerk Dashboard (do not require)`)}\n`;
			} else {
				// No Clerk config — non-identifier item
				message += `  ${color.yellow('○')} ${item.label} — ${color.dim(`${countStr} — enable in Clerk Dashboard`)}\n`;
			}
		}

		message += '\n';
	}

	// Check for users without any identifier
	if (analysis.identifiers.hasAnyIdentifier < total) {
		const missing = total - analysis.identifiers.hasAnyIdentifier;
		message += color.red(
			`⚠ ${missing} user${missing === 1 ? '' : 's'} without any identifier (cannot be imported)\n\n`
		);
	}

	// Summary
	if (needsAttention.length > 0) {
		const totalAffected = needsAttention.reduce(
			(sum, item) => sum + item.userCount,
			0
		);
		message += color.yellow(
			`⚠ ${needsAttention.length} setting${needsAttention.length === 1 ? '' : 's'} need${needsAttention.length === 1 ? 's' : ''} attention${totalAffected > 0 ? ` (up to ${totalAffected} users affected)` : ''}`
		);
	} else if (items.some((i) => i.clerkEnabled !== null)) {
		message += color.green('All settings are configured in Clerk');
	}

	p.note(message.trim(), 'Migration Readiness');
}

/**
 * Handles Firebase hash configuration collection and validation
 *
 * Firebase uses scrypt for password hashing, and Clerk needs the hash parameters
 * to verify passwords. These values can be found in Firebase Console:
 * Authentication → Users → (⋮ menu) → Password hash parameters
 *
 * This function:
 * 1. Checks if config is already set in the transformer
 * 2. If not, checks if saved in .settings file
 * 3. If found in settings, displays current values and allows update
 * 4. If not found anywhere, prompts user to enter all values
 * 5. Saves values to .settings for future runs
 *
 * @param savedSettings - Previously saved settings from .settings file
 * @returns The Firebase hash config, or null if cancelled
 */
export async function handleFirebaseHashConfig(
	savedSettings: Settings
): Promise<FirebaseHashConfig | null> {
	// Check if config is already set in transformer (takes precedence)
	if (isFirebaseHashConfigComplete()) {
		p.log.info('Firebase hash configuration found in transformer.');
		return firebaseHashConfig;
	}

	// Check if config exists in settings
	const savedConfig = savedSettings.firebaseHashConfig;
	const hasSettingsConfig =
		savedConfig &&
		savedConfig.base64_signer_key &&
		savedConfig.base64_salt_separator &&
		savedConfig.rounds &&
		savedConfig.mem_cost;

	if (hasSettingsConfig) {
		// Display current saved values
		let configMessage = color.bold(
			'Firebase Hash Configuration (from saved settings):\n\n'
		);
		configMessage += `  ${color.cyan('Signer Key:')} ${color.dim(savedConfig.base64_signer_key)}\n`;
		configMessage += `  ${color.cyan('Salt Separator:')} ${color.dim(savedConfig.base64_salt_separator)}\n`;
		configMessage += `  ${color.cyan('Rounds:')} ${color.dim(savedConfig.rounds)}\n`;
		configMessage += `  ${color.cyan('Memory Cost:')} ${color.dim(savedConfig.mem_cost)}\n`;
		configMessage += `\n${color.dim('These values are from your Firebase Console → Authentication → Users → (⋮) → Password hash parameters')}`;

		p.note(configMessage.trim(), 'Firebase Configuration');

		const useExisting = await p.confirm({
			message: 'Use these saved Firebase hash parameters?',
			initialValue: true,
		});

		if (p.isCancel(useExisting)) {
			return null;
		}

		if (useExisting) {
			// Apply saved config to the transformer
			setFirebaseHashConfig(savedConfig);
			return firebaseHashConfig;
		}
		// User wants to update, fall through to collection flow
	} else {
		// No config found anywhere, show explanation
		let infoMessage = color.bold('Firebase Hash Configuration Required\n\n');
		infoMessage += `Firebase uses scrypt for password hashing. To migrate passwords,\n`;
		infoMessage += `Clerk needs the hash parameters from your Firebase project.\n\n`;
		infoMessage += color.bold('How to find these values:\n');
		infoMessage += `  1. Go to Firebase Console\n`;
		infoMessage += `  2. Navigate to ${color.cyan('Authentication → Users')}\n`;
		infoMessage += `  3. Click the ${color.cyan('⋮')} menu (three dots)\n`;
		infoMessage += `  4. Select ${color.cyan('Password hash parameters')}\n`;

		p.note(infoMessage.trim(), 'Firebase Configuration');
	}

	// Collect Firebase hash configuration from user
	const hashConfig = await p.group(
		{
			base64_signer_key: () =>
				p.text({
					message: 'Enter the Signer Key (base64 encoded)',
					placeholder: 'e.g., jxspr8Ki0RYycVU8zykbdLGjFQ3McFUH...',
					validate: (value) => {
						if (!value || value.trim() === '') {
							return 'Signer Key is required';
						}
					},
				}),
			base64_salt_separator: () =>
				p.text({
					message: 'Enter the Salt Separator (base64 encoded)',
					placeholder: 'e.g., Bw==',
					validate: (value) => {
						if (!value || value.trim() === '') {
							return 'Salt Separator is required';
						}
					},
				}),
			rounds: () =>
				p.text({
					message: 'Enter the Rounds value',
					placeholder: 'e.g., 8',
					validate: (value) => {
						if (!value || value.trim() === '') {
							return 'Rounds is required';
						}
						if (!/^\d+$/.test(value.trim())) {
							return 'Rounds must be a number';
						}
					},
				}),
			mem_cost: () =>
				p.text({
					message: 'Enter the Memory Cost value',
					placeholder: 'e.g., 14',
					validate: (value) => {
						if (!value || value.trim() === '') {
							return 'Memory Cost is required';
						}
						if (!/^\d+$/.test(value.trim())) {
							return 'Memory Cost must be a number';
						}
					},
				}),
		},
		{
			onCancel: () => {
				return null;
			},
		}
	);

	// Check if user cancelled during group input
	if (
		!hashConfig.base64_signer_key ||
		!hashConfig.base64_salt_separator ||
		!hashConfig.rounds ||
		!hashConfig.mem_cost
	) {
		return null;
	}

	// Apply the config to the transformer
	const newConfig: FirebaseHashConfig = {
		base64_signer_key: hashConfig.base64_signer_key.trim(),
		base64_salt_separator: hashConfig.base64_salt_separator.trim(),
		rounds: parseInt(hashConfig.rounds),
		mem_cost: parseInt(hashConfig.mem_cost),
	};
	setFirebaseHashConfig(newConfig);

	// Save to settings
	const updatedSettings: Settings = {
		...savedSettings,
		firebaseHashConfig: newConfig,
	};
	saveSettings(updatedSettings);

	p.log.success('Firebase hash configuration saved to .settings file.');

	return newConfig;
}

/**
 * Runs the interactive CLI for user migration
 *
 * Guides the user through the migration process:
 * 1. Displays available transformers with descriptions
 * 2. Gathers migration parameters (transformer, file, resumeAfter)
 * 3. Analyzes the import file and displays field statistics
 * 4. Validates instance type and user count (dev instances limited to 500 users)
 * 5. Confirms Dashboard configuration for identifiers, password, user model, and other fields
 * 6. Gets final confirmation before starting migration
 *
 * Saves settings for future runs and returns all configuration options.
 *
 * @param cliArgs - Optional CLI arguments to pre-populate values
 * @returns Configuration object with transformer key, file path, resumeAfter, instance type,
 *          and skipPasswordRequirement flag
 * @throws Exits the process if migration is cancelled or validation fails
 */
export async function runCLI(cliArgs?: CLIArgs) {
	// Handle help flag in interactive mode
	if (cliArgs?.help) {
		showHelp();
		process.exit(0);
	}

	p.intro(`${color.bgCyan(color.black('Clerk User Migration Utility'))}`);

	// Ensure CLERK_SECRET_KEY is set (via CLI flag, env var, or prompts user if missing)
	const hasKey = await ensureClerkSecretKey(false, cliArgs?.clerkSecretKey);
	if (!hasKey) {
		p.cancel('Could not validate CLERK_SECRET_KEY.');
		process.exit(1);
	}

	// Load previous settings to use as defaults
	const savedSettings = loadSettings();

	// Step 1: Display available transformers with descriptions
	let transformerMessage = color.bold('Available Transformers:\n\n');
	for (const transformer of transformers) {
		transformerMessage += color.bold(color.cyan(`● ${transformer.label}\n`));
		transformerMessage += `  ${color.dim(transformer.description)}\n\n`;
	}
	p.note(transformerMessage.trim(), 'Transformers');

	// Step 2: Gather initial inputs
	// Map transformers to include 'value' property for p.select (uses key as value)
	const selectOptions = transformers.map((t) => ({ ...t, value: t.key }));

	// Use CLI args as initial values if provided
	const initialTransformer =
		cliArgs?.transformer || savedSettings.key || transformers[0].key;
	const initialFile =
		cliArgs?.file || savedSettings.file || 'samples/clerk.csv';
	const initialResumeAfter = cliArgs?.resumeAfter || '';

	const initialArgs = await p.group(
		{
			key: () =>
				p.select({
					message: 'Which transformer should be used for your user data?',
					initialValue: initialTransformer,
					maxItems: 1,
					options: selectOptions,
				}),
			file: () =>
				p.text({
					message: 'Specify the file to use for importing your users',
					initialValue: initialFile,
					placeholder: initialFile,
					validate: (value) => {
						if (!value) {
							return 'Please provide a file path';
						}
						if (!checkIfFileExists(value)) {
							return 'That file does not exist. Please try again';
						}
						const fileType = getFileType(value);
						if (fileType !== 'text/csv' && fileType !== 'application/json') {
							return 'Please supply a valid JSON or CSV file';
						}
					},
				}),
			resumeAfter: () =>
				p.text({
					message: 'Resume after user ID (leave empty to start from beginning)',
					initialValue: initialResumeAfter,
					defaultValue: '',
					placeholder: 'user_xxx or leave empty',
				}),
		},
		{
			onCancel: () => {
				p.cancel('Migration cancelled.');
				process.exit(0);
			},
		}
	);

	// Step 3: Handle Firebase-specific configuration (hash parameters)
	if (initialArgs.key === 'firebase') {
		const firebaseConfig = await handleFirebaseHashConfig(savedSettings);
		if (firebaseConfig === null) {
			p.cancel('Migration cancelled.');
			process.exit(0);
		}
	}

	// Step 4: Analyze the file and display field information
	const spinner = p.spinner();
	spinner.start('Analyzing import file...');

	const [users, error] = await tryCatch(
		loadRawUsers(initialArgs.file, initialArgs.key)
	);

	if (error) {
		spinner.stop('Error analyzing file');
		p.cancel('Failed to analyze import file. Please check the file format.');
		process.exit(1);
	}

	// Filter users if resuming after a specific user ID
	let filteredUsers = users;
	if (initialArgs.resumeAfter) {
		const resumeIndex = users.findIndex(
			(u) => u.userId === initialArgs.resumeAfter
		);
		if (resumeIndex === -1) {
			spinner.stop('User ID not found');
			p.cancel(
				`Could not find user ID "${initialArgs.resumeAfter}" in the import file.`
			);
			process.exit(1);
		}
		// Start from the user AFTER the specified ID
		filteredUsers = users.slice(resumeIndex + 1);
		p.log.info(
			`Resuming migration after user ID: ${initialArgs.resumeAfter}\n` +
				`Skipping ${resumeIndex + 1} users, starting with user ${resumeIndex + 2} of ${users.length}`
		);
	}

	const userCount = filteredUsers.length;
	spinner.stop(`Found ${userCount} users to migrate`);

	const analysis = analyzeFields(filteredUsers);

	// Validate users and log errors so they're available before the readiness display.
	// Users can cancel after seeing the results and review the log file.
	const validation = validateUsers(filteredUsers, initialArgs.key);

	// Step 4: Check instance type and validate
	const instanceType = detectInstanceType();

	if (instanceType === 'dev') {
		p.log.info(
			`${color.cyan('Development')} instance detected (based on CLERK_SECRET_KEY)`
		);

		if (userCount > DEV_USER_LIMIT) {
			p.cancel(
				`Cannot import ${userCount} users to a development instance. ` +
					`Development instances are limited to ${DEV_USER_LIMIT} users.`
			);
			process.exit(1);
		}
	} else {
		p.log.warn(
			`${color.yellow('Production')} instance detected (based on CLERK_SECRET_KEY)`
		);
		p.log.warn(
			color.yellow(
				`You are about to import ${userCount} users to your production instance.`
			)
		);

		const confirmProduction = await p.confirm({
			message: 'Are you sure you want to import users to production?',
			initialValue: false,
		});

		if (p.isCancel(confirmProduction) || !confirmProduction) {
			p.cancel('Migration cancelled.');
			process.exit(0);
		}
	}

	// Exit if no users have valid identifiers
	if (analysis.identifiers.hasAnyIdentifier === 0) {
		p.cancel(
			'No users can be imported. All users are missing an identifier (verified email, verified phone, or username).'
		);
		process.exit(1);
	}

	// Step 5: Fetch configurations for cross-reference
	const isSupabase = initialArgs.key === 'supabase';

	const publishableKey =
		process.env.CLERK_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
	const supabaseUrl =
		process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
	const supabaseApiKey =
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		process.env.SUPABASE_ANON_KEY ||
		process.env.SUPABASE_SERVICE_ROLE_KEY;

	const configSpinner = p.spinner();
	configSpinner.start('Checking configuration...');

	const [clerkConfig, supabaseProviders] = await Promise.all([
		publishableKey ? fetchClerkConfig(publishableKey) : Promise.resolve(null),
		isSupabase && supabaseUrl && supabaseApiKey
			? fetchSupabaseProviders(supabaseUrl, supabaseApiKey)
			: Promise.resolve(null),
	]);

	// Analyze raw provider counts (Supabase only, from raw export data)
	let providerCounts: Record<string, number> = {};
	if (isSupabase) {
		const filePath = createImportFilePath(initialArgs.file);
		providerCounts = analyzeUserProviders(filePath);
	}

	// Determine config check outcomes for the readiness report
	let clerkStatus: ConfigStatus['clerk'] = 'skipped';
	if (publishableKey) {
		clerkStatus = clerkConfig ? 'loaded' : 'failed';
	}
	const configStatus: ConfigStatus = { clerk: clerkStatus };

	if (isSupabase) {
		if (supabaseUrl && supabaseApiKey) {
			configStatus.supabase = supabaseProviders ? 'loaded' : 'failed';
		} else {
			configStatus.supabase = 'skipped';
		}
	}

	configSpinner.stop('Configuration checked');

	// Step 6: Build cross-reference items
	const items: ReadinessItem[] = [];

	// Identifiers
	const emailCount =
		analysis.identifiers.verifiedEmails + analysis.identifiers.unverifiedEmails;
	if (emailCount > 0) {
		items.push({
			label: 'Email',
			userCount: emailCount,
			clerkEnabled: clerkConfig?.attributes.email_address?.enabled ?? null,
			clerkRequired: clerkConfig?.attributes.email_address?.required ?? null,
			section: 'identifiers',
		});
	}

	const phoneCount =
		analysis.identifiers.verifiedPhones + analysis.identifiers.unverifiedPhones;
	if (phoneCount > 0) {
		items.push({
			label: 'Phone',
			userCount: phoneCount,
			clerkEnabled: clerkConfig?.attributes.phone_number?.enabled ?? null,
			clerkRequired: clerkConfig?.attributes.phone_number?.required ?? null,
			section: 'identifiers',
		});
	}

	if (analysis.identifiers.username > 0) {
		items.push({
			label: 'Username',
			userCount: analysis.identifiers.username,
			clerkEnabled: clerkConfig?.attributes.username?.enabled ?? null,
			clerkRequired: clerkConfig?.attributes.username?.required ?? null,
			section: 'identifiers',
		});
	}

	// Authentication
	const passwordCount = analysis.fieldCounts.password || 0;
	if (passwordCount > 0) {
		items.push({
			label: 'Password',
			userCount: passwordCount,
			clerkEnabled: clerkConfig?.attributes.password?.enabled ?? null,
			clerkRequired: null,
			section: 'auth',
		});
	}

	// Social connections (from Supabase config)
	const disabledProviders: string[] = [];
	if (supabaseProviders) {
		for (const provider of supabaseProviders) {
			const clerkKey = `oauth_${provider}`;
			const clerkEnabled = clerkConfig
				? (clerkConfig.social[clerkKey]?.enabled ?? false)
				: null;

			items.push({
				label: OAUTH_PROVIDER_LABELS[provider] || provider,
				userCount: providerCounts[provider] || 0,
				clerkEnabled,
				clerkRequired: null,
				section: 'social',
			});

			if (clerkEnabled === false) {
				disabledProviders.push(provider);
			}
		}
	}

	// Find users to exclude (those whose only providers are disabled)
	let excludedUserIds = new Set<string>();
	let exclusionsByProvider: Record<string, number> = {};
	if (isSupabase && disabledProviders.length > 0) {
		const filePath = createImportFilePath(initialArgs.file);
		const result = findUsersWithDisabledProviders(filePath, disabledProviders);
		excludedUserIds = result.excludedIds;
		exclusionsByProvider = result.exclusionsByProvider;
	}

	// User model
	const firstNameCount = analysis.fieldCounts.firstName || 0;
	if (firstNameCount > 0) {
		items.push({
			label: 'First Name',
			userCount: firstNameCount,
			clerkEnabled: clerkConfig?.attributes.first_name?.enabled ?? null,
			clerkRequired: null,
			section: 'model',
		});
	}

	const lastNameCount = analysis.fieldCounts.lastName || 0;
	if (lastNameCount > 0) {
		items.push({
			label: 'Last Name',
			userCount: lastNameCount,
			clerkEnabled: clerkConfig?.attributes.last_name?.enabled ?? null,
			clerkRequired: null,
			section: 'model',
		});
	}

	// Step 7: Display unified cross-reference report
	displayCrossReference(items, analysis, configStatus, validation);

	// Step 8: Show disabled providers and handle exclusion
	let skipUnsupportedProviders: boolean | undefined;
	if (excludedUserIds.size > 0) {
		let providerInfo = '';
		for (const provider of disabledProviders) {
			const label = OAUTH_PROVIDER_LABELS[provider] || provider;
			const count = exclusionsByProvider[provider] || 0;
			if (count > 0) {
				providerInfo += `  ${color.yellow('•')} ${label} — ${count} user${count === 1 ? '' : 's'}\n`;
			}
		}
		providerInfo += `\n  ${excludedUserIds.size} user${excludedUserIds.size === 1 ? '' : 's'} only signed up via disabled provider${excludedUserIds.size === 1 ? '' : 's'}`;

		p.note(providerInfo.trim(), 'Disabled Social Providers');

		if (cliArgs?.skipUnsupportedProviders) {
			p.log.info(
				`Skipping ${excludedUserIds.size} user${excludedUserIds.size === 1 ? '' : 's'} (--skip-unsupported-providers)`
			);
		} else {
			const savedSkip = savedSettings.skipUnsupportedProviders;
			const shouldSkip = await p.confirm({
				message: `Skip ${excludedUserIds.size} user${excludedUserIds.size === 1 ? '' : 's'} who only signed up via disabled providers?`,
				initialValue: savedSkip ?? true,
			});

			if (p.isCancel(shouldSkip)) {
				p.cancel('Migration cancelled.');
				process.exit(0);
			}

			skipUnsupportedProviders = shouldSkip;

			if (!shouldSkip) {
				excludedUserIds = new Set<string>();
			}
		}
	}

	const importCount = userCount - excludedUserIds.size;
	const hasIssues = items.some((i) => i.clerkEnabled === false);

	if (importCount <= 0) {
		p.cancel('No users can be imported after exclusions.');
		process.exit(0);
	}

	let confirmMessage: string;
	if (excludedUserIds.size > 0) {
		confirmMessage = `Import ${importCount} user${importCount === 1 ? '' : 's'}? (${excludedUserIds.size} excluded)`;
	} else if (hasIssues) {
		confirmMessage = 'Some settings need attention. Proceed with migration?';
	} else {
		confirmMessage = 'Begin migration?';
	}

	const beginMigration = await p.confirm({
		message: confirmMessage,
		initialValue: !hasIssues || excludedUserIds.size > 0,
	});

	if (p.isCancel(beginMigration) || !beginMigration) {
		p.cancel('Migration cancelled.');
		process.exit(0);
	}

	// Save settings for next run
	saveSettings({
		key: initialArgs.key,
		file: initialArgs.file,
		...(skipUnsupportedProviders !== undefined && {
			skipUnsupportedProviders,
		}),
	});

	// Auto-determine skipPasswordRequirement: true if any users lack passwords
	const skipPasswordRequirement = passwordCount < analysis.totalUsers;

	return {
		...initialArgs,
		instance: instanceType,
		begin: beginMigration,
		skipPasswordRequirement,
		excludedUserIds,
	};
}
