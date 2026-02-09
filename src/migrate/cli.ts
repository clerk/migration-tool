import * as p from '@clack/prompts';
import color from 'picocolors';
import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { transformers } from './transformers';
import {
	type FirebaseHashConfig,
	firebaseHashConfig,
	isFirebaseHashConfigComplete,
	setFirebaseHashConfig,
} from './transformers/firebase';
import {
	checkIfFileExists,
	createImportFilePath,
	getFileType,
	transformKeys as transformKeysFromFunctions,
	tryCatch,
} from '../utils';
import { env } from '../envs-constants';

const SETTINGS_FILE = '.settings';

type Settings = {
	key?: string;
	file?: string;
	firebaseHashConfig?: FirebaseHashConfig;
};

const DEV_USER_LIMIT = 500;

const DASHBOARD_CONFIGURATION = color.bold(
	color.whiteBright('Dashboard Configuration:\n')
);

/**
 * Detects whether the Clerk instance is development or production based on the secret key
 *
 * @returns "dev" if the secret key starts with "sk_test_", otherwise "prod"
 */
export const detectInstanceType = (): 'dev' | 'prod' => {
	const secretKey = env.CLERK_SECRET_KEY;
	if (secretKey.startsWith('sk_test_')) {
		return 'dev';
	}
	return 'prod';
};

// Fields to analyze for the import (non-identifier fields)
const ANALYZED_FIELDS = [
	{ key: 'firstName', label: 'First Name' },
	{ key: 'lastName', label: 'Last Name' },
	{ key: 'password', label: 'Password' },
	{ key: 'totpSecret', label: 'TOTP Secret' },
];

type IdentifierCounts = {
	verifiedEmails: number;
	unverifiedEmails: number;
	verifiedPhones: number;
	unverifiedPhones: number;
	username: number;
	hasAnyIdentifier: number;
};

type FieldAnalysis = {
	presentOnAll: string[];
	presentOnSome: string[];
	identifiers: IdentifierCounts;
	totalUsers: number;
	fieldCounts: Record<string, number>;
};

/**
 * Loads saved settings from the .settings file in the current directory
 *
 * Reads previously saved migration parameters to use as defaults in the CLI.
 * Returns an empty object if the file doesn't exist or is corrupted.
 *
 * @returns The saved settings object with key and file properties
 */
export const loadSettings = (): Settings => {
	try {
		const settingsPath = path.join(process.cwd(), SETTINGS_FILE);
		if (fs.existsSync(settingsPath)) {
			const content = fs.readFileSync(settingsPath, 'utf-8');
			return JSON.parse(content) as Settings;
		}
	} catch {
		// If settings file is corrupted or unreadable, return empty settings
	}
	return {};
};

/**
 * Saves migration settings to the .settings file in the current directory
 *
 * Persists the current migration parameters (transformer key, file path)
 * so they can be used as defaults in future runs. Fails silently if unable to write.
 *
 * @param settings - The settings object to save
 */
export const saveSettings = (settings: Settings): void => {
	try {
		const settingsPath = path.join(process.cwd(), SETTINGS_FILE);
		fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
	} catch {
		// Silently fail if we can't write settings
	}
};

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

/**
 * Checks if a value exists and is not empty
 *
 * Returns false for undefined, null, empty strings, and empty arrays.
 * Returns true for all other values including 0, false, and non-empty objects.
 *
 * @param value - The value to check
 * @returns true if the value has meaningful content, false otherwise
 */
export const hasValue = (value: unknown): boolean => {
	if (value === undefined || value === null || value === '') return false;
	if (Array.isArray(value)) return value.length > 0;
	return true;
};

/**
 * Analyzes user data to determine field presence and identifier coverage
 *
 * Examines all users to count:
 * - How many users have each field (firstName, lastName, password, totpSecret)
 * - Identifier coverage (verified/unverified emails and phones, usernames)
 * - Whether all users have at least one valid identifier
 *
 * Used to provide feedback about Dashboard configuration requirements.
 *
 * @param users - Array of user objects to analyze
 * @returns Field analysis object with counts and identifier statistics
 */
export function analyzeFields(users: Record<string, unknown>[]): FieldAnalysis {
	const totalUsers = users.length;

	if (totalUsers === 0) {
		return {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 0,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 0,
			},
			totalUsers: 0,
			fieldCounts: {},
		};
	}

	const fieldCounts: Record<string, number> = {};
	const identifiers: IdentifierCounts = {
		verifiedEmails: 0,
		unverifiedEmails: 0,
		verifiedPhones: 0,
		unverifiedPhones: 0,
		username: 0,
		hasAnyIdentifier: 0,
	};

	// Count how many users have each field
	for (const user of users) {
		// Count non-identifier fields
		for (const field of ANALYZED_FIELDS) {
			if (hasValue(user[field.key])) {
				fieldCounts[field.key] = (fieldCounts[field.key] || 0) + 1;
			}
		}

		// Count consolidated identifier fields
		const hasVerifiedEmail =
			hasValue(user.email) || hasValue(user.emailAddresses);
		const hasUnverifiedEmail = hasValue(user.unverifiedEmailAddresses);
		const hasVerifiedPhone =
			hasValue(user.phone) || hasValue(user.phoneNumbers);
		const hasUnverifiedPhone = hasValue(user.unverifiedPhoneNumbers);
		const hasUsername = hasValue(user.username);

		if (hasVerifiedEmail) identifiers.verifiedEmails++;
		if (hasUnverifiedEmail) identifiers.unverifiedEmails++;
		if (hasVerifiedPhone) identifiers.verifiedPhones++;
		if (hasUnverifiedPhone) identifiers.unverifiedPhones++;
		if (hasUsername) identifiers.username++;

		// Check if user has at least one valid identifier
		if (hasVerifiedEmail || hasVerifiedPhone || hasUsername) {
			identifiers.hasAnyIdentifier++;
		}
	}

	const presentOnAll: string[] = [];
	const presentOnSome: string[] = [];

	for (const field of ANALYZED_FIELDS) {
		const count = fieldCounts[field.key] || 0;
		if (count === totalUsers) {
			presentOnAll.push(field.label);
		} else if (count > 0) {
			presentOnSome.push(field.label);
		}
	}

	return { presentOnAll, presentOnSome, identifiers, totalUsers, fieldCounts };
}

/**
 * Formats a count statistic into a human-readable string
 *
 * @param count - The number of users who have the field
 * @param total - The total number of users
 * @param label - The label for the field
 * @returns A formatted string like "All users have...", "No users have...", or "X of Y users have..."
 */
export function formatCount(
	count: number,
	total: number,
	label: string
): string {
	if (count === total) {
		return `All users have ${label}`;
	} else if (count === 0) {
		return `No users have ${label}`;
	}
	return `${count} of ${total} users have ${label}`;
}

/**
 * Displays identifier analysis and Dashboard configuration guidance
 *
 * Shows:
 * - Count of users with each identifier type (verified emails, verified phones, usernames)
 * - Count of users with unverified identifiers (if any)
 * - Whether all users have at least one valid identifier
 * - Dashboard configuration recommendations (required vs optional identifiers)
 *
 * Uses color coding: green for complete coverage, yellow for partial, red for missing.
 *
 * @param analysis - The field analysis results
 */
export function displayIdentifierAnalysis(analysis: FieldAnalysis): void {
	const { identifiers, totalUsers } = analysis;

	let identifierMessage = '';

	// Show counts for each identifier type
	identifierMessage += color.bold(color.whiteBright('Identifier Analysis:\n'));

	// Helper to get the correct icon based on coverage
	const getIcon = (count: number, total: number): string => {
		if (count === total) return color.bold(color.greenBright('●'));
		if (count > 0) return color.bold(color.yellowBright('○'));
		return color.red('○');
	};

	identifierMessage += `  ${getIcon(identifiers.verifiedEmails, totalUsers)} ${color.dim(formatCount(identifiers.verifiedEmails, totalUsers, 'verified emails'))}\n`;
	identifierMessage += `  ${getIcon(identifiers.verifiedPhones, totalUsers)} ${color.dim(formatCount(identifiers.verifiedPhones, totalUsers, 'verified phone numbers'))}\n`;
	identifierMessage += `  ${getIcon(identifiers.username, totalUsers)} ${color.dim(formatCount(identifiers.username, totalUsers, 'a username'))}\n`;

	// Show unverified counts if present
	if (identifiers.unverifiedEmails > 0) {
		identifierMessage += `  ${getIcon(identifiers.unverifiedEmails, totalUsers)} ${color.dim(formatCount(identifiers.unverifiedEmails, totalUsers, 'unverified emails'))}\n`;
	}
	if (identifiers.unverifiedPhones > 0) {
		identifierMessage += `  ${getIcon(identifiers.unverifiedPhones, totalUsers)} ${color.dim(formatCount(identifiers.unverifiedPhones, totalUsers, 'unverified phone numbers'))}\n`;
	}

	// Check if all users have at least one identifier
	identifierMessage += '\n';
	if (identifiers.hasAnyIdentifier === totalUsers) {
		identifierMessage += color.green(
			'All users have at least one identifier (verified email, verified phone, or username).\n'
		);
	} else {
		const missing = totalUsers - identifiers.hasAnyIdentifier;
		identifierMessage += color.red(
			`${missing} user${missing === 1 ? ' does' : 's do'} not have a verified email, verified phone, or username.\n`
		);
		identifierMessage += color.red('These users cannot be imported.\n');
	}

	// Dashboard configuration advice
	identifierMessage += '\n';
	identifierMessage += DASHBOARD_CONFIGURATION;

	const requiredIdentifiers: string[] = [];
	const optionalIdentifiers: string[] = [];

	// Only consider users that will actually be imported (have at least one identifier)
	const importableUsers = identifiers.hasAnyIdentifier;

	if (identifiers.verifiedEmails === importableUsers) {
		requiredIdentifiers.push('Email');
	} else if (identifiers.verifiedEmails > 0) {
		optionalIdentifiers.push('Email');
	}

	if (identifiers.verifiedPhones === importableUsers) {
		requiredIdentifiers.push('Phone');
	} else if (identifiers.verifiedPhones > 0) {
		optionalIdentifiers.push('Phone');
	}

	if (identifiers.username === importableUsers) {
		requiredIdentifiers.push('Username');
	} else if (identifiers.username > 0) {
		optionalIdentifiers.push('Username');
	}

	if (requiredIdentifiers.length > 0) {
		identifierMessage += `  ${color.green('●')} ${color.bold(color.whiteBright(requiredIdentifiers.join(', ')))}: ${color.dim('Enable and optionally require in the Dashboard')}\n`;
	}
	if (optionalIdentifiers.length > 0) {
		identifierMessage += `  ${color.yellow('○')} ${color.bold(color.whiteBright(optionalIdentifiers.join(', ')))}: Enable in the Dashboard but do not require\n`;
	}

	p.note(identifierMessage.trim(), 'Identifiers');
}

/**
 * Displays password analysis and prompts for migration preference
 *
 * Shows how many users have passwords and provides Dashboard configuration guidance.
 * If some users lack passwords, prompts whether to migrate those users anyway.
 * If no users have passwords, returns immediately without displaying anything.
 *
 * @param analysis - The field analysis results
 * @returns true if users without passwords should be migrated (skipPasswordRequirement),
 *          false if all users have passwords,
 *          null if the user cancelled
 */
export async function displayPasswordAnalysis(
	analysis: FieldAnalysis
): Promise<boolean | null> {
	const { totalUsers, fieldCounts } = analysis;
	const usersWithPasswords = fieldCounts.password || 0;

	// If no users have passwords, show message and skip password section
	if (usersWithPasswords === 0) {
		p.note(`${color.dim('○')} No users have passwords`, 'Password');
		return true;
	}

	let passwordMessage = '';

	if (usersWithPasswords === totalUsers) {
		passwordMessage += `${color.green('●')} All users have passwords\n`;
	} else {
		passwordMessage += `${color.yellow('○')} ${usersWithPasswords} of ${totalUsers} users have passwords\n`;
	}

	passwordMessage += '\n';
	passwordMessage += DASHBOARD_CONFIGURATION;
	passwordMessage += `  ${color.green('●')} ${color.bold(color.whiteBright('Password'))}: Enable in Dashboard\n`;

	p.note(passwordMessage.trim(), 'Password');

	// Ask if user wants to migrate users without passwords
	if (usersWithPasswords < totalUsers) {
		const migrateWithoutPassword = await p.confirm({
			message: "Do you want to migrate users who don't have a password?",
			initialValue: true,
		});

		if (p.isCancel(migrateWithoutPassword)) {
			return null; // User cancelled
		}

		return migrateWithoutPassword;
	}

	return false; // All users have passwords, no need for skipPasswordRequirement
}

// Maps Supabase provider keys to human-readable labels
const OAUTH_PROVIDER_LABELS: Record<string, string> = {
	google: 'Google',
	apple: 'Apple',
	github: 'GitHub',
	facebook: 'Facebook',
	twitter: 'Twitter (X)',
	discord: 'Discord',
	spotify: 'Spotify',
	slack: 'Slack',
	slack_oidc: 'Slack (OIDC)',
	twitch: 'Twitch',
	linkedin: 'LinkedIn',
	linkedin_oidc: 'LinkedIn (OIDC)',
	bitbucket: 'Bitbucket',
	gitlab: 'GitLab',
	azure: 'Microsoft (Azure)',
	kakao: 'Kakao',
	notion: 'Notion',
	zoom: 'Zoom',
	keycloak: 'Keycloak',
	figma: 'Figma',
	fly: 'Fly.io',
	workos: 'WorkOS',
	snapchat: 'Snapchat',
};

// Non-OAuth entries in the Supabase external config to ignore
const IGNORED_PROVIDERS = new Set(['email', 'phone', 'anonymous_users']);

interface SupabaseAuthSettings {
	external: Record<string, boolean>;
}

/**
 * Fetches the Supabase project's auth settings to determine which OAuth providers are enabled.
 *
 * Calls GET {supabaseUrl}/auth/v1/settings with the API key. This endpoint returns
 * the `external` config object with a boolean for each provider (google, apple, etc.).
 *
 * @param supabaseUrl - The Supabase project URL (e.g., https://xxx.supabase.co)
 * @param apiKey - Any valid Supabase API key (anon or service role)
 * @returns List of enabled OAuth provider keys, or null if the fetch failed
 */
export async function fetchSupabaseProviders(
	supabaseUrl: string,
	apiKey: string
): Promise<string[] | null> {
	try {
		const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`;
		const res = await fetch(url, {
			headers: { apikey: apiKey },
		});

		if (!res.ok) {
			return null;
		}

		const settings = (await res.json()) as SupabaseAuthSettings;
		if (!settings.external) {
			return null;
		}

		return Object.entries(settings.external)
			.filter(([key, enabled]) => enabled && !IGNORED_PROVIDERS.has(key))
			.map(([key]) => key);
	} catch {
		return null;
	}
}

/**
 * Displays which OAuth providers are enabled on the Supabase project and warns
 * that these need to be configured as social connections in Clerk.
 *
 * Users who signed up via an OAuth provider that isn't enabled in Clerk won't
 * be able to sign back in after their bridged session expires.
 *
 * @param enabledProviders - List of enabled OAuth provider keys from Supabase
 * @returns true if OAuth providers were found and confirmation is needed
 */
export function displayProviderAnalysis(enabledProviders: string[]): boolean {
	if (enabledProviders.length === 0) {
		return false;
	}

	let message = '';

	message += color.bold(
		color.whiteBright('Enabled OAuth Providers in Supabase:\n\n')
	);

	for (const provider of enabledProviders) {
		const label = OAUTH_PROVIDER_LABELS[provider] || provider;
		message += `  ${color.yellow('○')} ${color.bold(color.whiteBright(label))}\n`;
	}

	message += '\n';
	message += DASHBOARD_CONFIGURATION;
	message += `  ${color.yellow('⚠')} ${color.whiteBright('Enable these as Social connections in Clerk Dashboard')}\n`;
	message += color.dim(
		`    Users who signed up via OAuth won't be able to sign back in\n`
	);
	message += color.dim(
		`    after their session expires unless the provider is enabled.`
	);

	p.note(message.trim(), 'Social Connections');

	return true;
}

/**
 * Displays user model analysis (first/last name) and Dashboard configuration guidance
 *
 * Shows how many users have first and last names and provides recommendations
 * for Dashboard configuration (required vs optional vs disabled).
 *
 * @param analysis - The field analysis results
 * @returns true if users have name data and confirmation is needed, false otherwise
 */
export const displayUserModelAnalysis = (analysis: FieldAnalysis): boolean => {
	const { totalUsers, fieldCounts } = analysis;
	const usersWithFirstName = fieldCounts.firstName || 0;
	const usersWithLastName = fieldCounts.lastName || 0;

	// Count users who have BOTH first and last name
	const usersWithBothNames = Math.min(usersWithFirstName, usersWithLastName);
	const someUsersHaveNames = usersWithFirstName > 0 || usersWithLastName > 0;
	const noUsersHaveNames = usersWithFirstName === 0 && usersWithLastName === 0;

	let nameMessage = '';

	// Show combined first and last name stats
	if (usersWithBothNames === totalUsers) {
		nameMessage += `${color.green('●')} All users have first and last names\n`;
	} else if (someUsersHaveNames && !noUsersHaveNames) {
		nameMessage += `${color.yellow('○')} Some users have first and last names\n`;
	} else {
		nameMessage += `${color.dim('○')} No users have first and last names\n`;
	}

	nameMessage += '\n';
	nameMessage += DASHBOARD_CONFIGURATION;

	if (usersWithBothNames === totalUsers) {
		nameMessage += `  ${color.green('●')} ${color.bold(color.whiteBright('First and last name'))}: Must be enabled in the Dashboard and could be required\n`;
	} else if (someUsersHaveNames) {
		nameMessage += `  ${color.yellow('○')} ${color.bold(color.whiteBright('First and last name'))}: Must be enabled in the Dashboard but not required\n`;
	} else {
		nameMessage += `  ${color.dim('○')} ${color.bold(color.whiteBright('First and last name'))}: Could be enabled or disabled in the Dashboard but cannot be required\n`;
	}

	p.note(nameMessage.trim(), 'User Model');

	// Return true if confirmation is needed (when users have name data)
	return someUsersHaveNames;
};

/**
 * Displays analysis of other fields (excluding identifiers, password, and names)
 *
 * Shows fields like TOTP Secret that are present on all or some users,
 * with Dashboard configuration guidance.
 *
 * @param analysis - The field analysis results
 * @returns true if there are other fields to display, false otherwise
 */
export const displayOtherFieldsAnalysis = (
	analysis: FieldAnalysis
): boolean => {
	// Filter out password, firstName, and lastName since they have dedicated sections
	const excludedFields = ['Password', 'First Name', 'Last Name'];
	const filteredPresentOnAll = analysis.presentOnAll.filter(
		(f) => !excludedFields.includes(f)
	);
	const filteredPresentOnSome = analysis.presentOnSome.filter(
		(f) => !excludedFields.includes(f)
	);

	let fieldsMessage = '';

	if (filteredPresentOnAll.length > 0) {
		fieldsMessage += color.bold('Fields present on ALL users:\n');
		fieldsMessage += color.dim(
			'These fields must be enabled in the Clerk Dashboard and could be set as required.'
		);
		for (const field of filteredPresentOnAll) {
			fieldsMessage += `\n  ${color.green('●')} ${color.reset(field)}`;
		}
	}

	if (filteredPresentOnSome.length > 0) {
		if (fieldsMessage) fieldsMessage += '\n\n';
		fieldsMessage += color.bold('Fields present on SOME users:\n');
		fieldsMessage += color.dim(
			'These fields must be enabled in the Clerk Dashboard but must be set as optional.'
		);
		for (const field of filteredPresentOnSome) {
			fieldsMessage += `\n  ${color.yellow('○')} ${color.reset(field)}`;
		}
	}

	if (fieldsMessage) {
		p.note(fieldsMessage.trim(), 'Other Fields');
		return true;
	}

	return false;
};

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
 * @returns Configuration object with transformer key, file path, resumeAfter, instance type,
 *          and skipPasswordRequirement flag
 * @throws Exits the process if migration is cancelled or validation fails
 */
export async function runCLI() {
	p.intro(`${color.bgCyan(color.black('Clerk User Migration Utility'))}`);

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

	const initialArgs = await p.group(
		{
			key: () =>
				p.select({
					message: 'What platform are you migrating your users from?',
					initialValue: savedSettings.key || transformers[0].key,
					maxItems: 1,
					options: selectOptions,
				}),
			file: () =>
				p.text({
					message: 'Specify the file to use for importing your users',
					initialValue: savedSettings.file || 'users.json',
					placeholder: savedSettings.file || 'users.json',
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
					initialValue: '',
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

	// Step 5: Display and confirm identifier settings
	displayIdentifierAnalysis(analysis);

	// Exit if no users have valid identifiers
	if (analysis.identifiers.hasAnyIdentifier === 0) {
		p.cancel(
			'No users can be imported. All users are missing an identifier (verified email, verified phone, or username).'
		);
		process.exit(1);
	}

	const confirmIdentifiers = await p.confirm({
		message: 'Have you configured the identifier settings in the Dashboard?',
		initialValue: true,
	});

	if (p.isCancel(confirmIdentifiers) || !confirmIdentifiers) {
		p.cancel(
			'Migration cancelled. Please configure identifier settings and try again.'
		);
		process.exit(0);
	}

	// Step 6: Display password analysis and get migration preference
	const skipPasswordRequirement = await displayPasswordAnalysis(analysis);

	if (skipPasswordRequirement === null) {
		p.cancel('Migration cancelled.');
		process.exit(0);
	}

	// Only show password confirmation if users have passwords
	const usersWithPasswords = analysis.fieldCounts.password || 0;
	if (usersWithPasswords > 0) {
		const confirmPassword = await p.confirm({
			message: 'Have you enabled Password in the Dashboard?',
			initialValue: true,
		});

		if (p.isCancel(confirmPassword) || !confirmPassword) {
			p.cancel(
				'Migration cancelled. Please enable Password in the Dashboard and try again.'
			);
			process.exit(0);
		}
	}

	// Step 7: Check Supabase OAuth providers (Supabase-specific)
	if (initialArgs.key === 'supabase') {
		const supabaseUrl =
			process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
		const supabaseApiKey =
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
			process.env.SUPABASE_ANON_KEY ||
			process.env.SUPABASE_SERVICE_ROLE_KEY;

		if (supabaseUrl && supabaseApiKey) {
			const enabledProviders = await fetchSupabaseProviders(
				supabaseUrl,
				supabaseApiKey
			);

			if (enabledProviders) {
				const hasOAuthProviders = displayProviderAnalysis(enabledProviders);

				if (hasOAuthProviders) {
					const confirmProviders = await p.confirm({
						message:
							'Have you enabled these social connections in the Clerk Dashboard?',
						initialValue: true,
					});

					if (p.isCancel(confirmProviders) || !confirmProviders) {
						p.cancel(
							'Migration cancelled. Please enable the required social connections and try again.'
						);
						process.exit(0);
					}
				}
			}
		}
	}

	// Step 8: Display user model analysis (first/last name)
	const needsUserModelConfirmation = displayUserModelAnalysis(analysis);

	if (needsUserModelConfirmation) {
		const confirmUserModel = await p.confirm({
			message:
				'Have you configured first and last name settings in the Dashboard?',
			initialValue: true,
		});

		if (p.isCancel(confirmUserModel) || !confirmUserModel) {
			p.cancel(
				'Migration cancelled. Please configure user model settings and try again.'
			);
			process.exit(0);
		}
	}

	// Step 9: Display and confirm other field settings (if any)
	const hasOtherFields = displayOtherFieldsAnalysis(analysis);

	if (hasOtherFields) {
		const confirmFields = await p.confirm({
			message: 'Have you configured the other field settings in the Dashboard?',
			initialValue: true,
		});

		if (p.isCancel(confirmFields) || !confirmFields) {
			p.cancel(
				'Migration cancelled. Please configure field settings and try again.'
			);
			process.exit(0);
		}
	}

	// Step 10: Final confirmation
	const beginMigration = await p.confirm({
		message: 'Begin Migration?',
		initialValue: true,
	});

	if (p.isCancel(beginMigration) || !beginMigration) {
		p.cancel('Migration cancelled.');
		process.exit(0);
	}

	// Save settings for next run (not including instance - always auto-detected)
	saveSettings({
		key: initialArgs.key,
		file: initialArgs.file,
	});

	return {
		...initialArgs,
		instance: instanceType,
		begin: beginMigration,
		skipPasswordRequirement: skipPasswordRequirement || false,
	};
}
