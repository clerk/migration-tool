import * as p from '@clack/prompts';
import color from 'picocolors';
import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { transformers } from './transformers';
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
};

const DEV_USER_LIMIT = 500;

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
	const filePath = createImportFilePath(file);
	const type = getFileType(filePath);
	const transformer = transformers.find((h) => h.key === transformerKey);

	if (!transformer) {
		throw new Error(`Transformer not found for key: ${transformerKey}`);
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
	const rawUsers = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
		string,
		unknown
	>[];
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
	identifierMessage += color.bold('Identifier Analysis:\n');

	// Helper to get the correct icon based on coverage
	const getIcon = (count: number, total: number): string => {
		if (count === total) return color.green('●');
		if (count > 0) return color.yellow('○');
		return color.red('○');
	};

	identifierMessage += `  ${getIcon(identifiers.verifiedEmails, totalUsers)} ${formatCount(identifiers.verifiedEmails, totalUsers, 'verified emails')}\n`;
	identifierMessage += `  ${getIcon(identifiers.verifiedPhones, totalUsers)} ${formatCount(identifiers.verifiedPhones, totalUsers, 'verified phone numbers')}\n`;
	identifierMessage += `  ${getIcon(identifiers.username, totalUsers)} ${formatCount(identifiers.username, totalUsers, 'a username')}\n`;

	// Show unverified counts if present
	if (identifiers.unverifiedEmails > 0) {
		identifierMessage += `  ${color.dim('○')} ${formatCount(identifiers.unverifiedEmails, totalUsers, 'unverified emails')}\n`;
	}
	if (identifiers.unverifiedPhones > 0) {
		identifierMessage += `  ${color.dim('○')} ${formatCount(identifiers.unverifiedPhones, totalUsers, 'unverified phone numbers')}\n`;
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
	identifierMessage += color.bold('Dashboard Configuration:\n');

	const requiredIdentifiers: string[] = [];
	const optionalIdentifiers: string[] = [];

	if (identifiers.verifiedEmails === totalUsers) {
		requiredIdentifiers.push('email');
	} else if (identifiers.verifiedEmails > 0) {
		optionalIdentifiers.push('email');
	}

	if (identifiers.verifiedPhones === totalUsers) {
		requiredIdentifiers.push('phone');
	} else if (identifiers.verifiedPhones > 0) {
		optionalIdentifiers.push('phone');
	}

	if (identifiers.username === totalUsers) {
		requiredIdentifiers.push('username');
	} else if (identifiers.username > 0) {
		optionalIdentifiers.push('username');
	}

	if (requiredIdentifiers.length > 0) {
		identifierMessage += `  ${color.green('●')} Enable and ${color.bold('require')} ${requiredIdentifiers.join(', ')} in the Dashboard\n`;
	}
	if (optionalIdentifiers.length > 0) {
		identifierMessage += `  ${color.yellow('○')} Enable ${optionalIdentifiers.join(', ')} in the Dashboard (do not require)\n`;
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
	passwordMessage += color.bold('Dashboard Configuration:\n');
	passwordMessage += `  ${color.green('●')} Enable Password in the Dashboard\n`;

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
		nameMessage += `${color.yellow('○')} Some users have first and/or last names\n`;
	} else {
		nameMessage += `${color.dim('○')} No users have first or last names\n`;
	}

	nameMessage += '\n';
	nameMessage += color.bold('Dashboard Configuration:\n');

	if (usersWithBothNames === totalUsers) {
		nameMessage += `  ${color.green('●')} First and last name must be enabled in the Dashboard and could be required\n`;
	} else if (someUsersHaveNames) {
		nameMessage += `  ${color.yellow('○')} First and last name must be enabled in the Dashboard but not required\n`;
	} else {
		nameMessage += `  ${color.dim('○')} First and last name could be enabled or disabled in the Dashboard but cannot be required\n`;
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
		transformerMessage += color.cyan(`● ${transformer.label}\n`);
		transformerMessage += `  ${color.dim(transformer.description)}\n\n`;
	}
	p.note(transformerMessage.trim(), 'Transformers');

	// Step 2: Gather initial inputs
	const initialArgs = await p.group(
		{
			key: () =>
				p.select({
					message: 'What platform are you migrating your users from?',
					initialValue: savedSettings.key || transformers[0].value,
					maxItems: 1,
					options: transformers,
				}),
			file: () =>
				p.text({
					message: 'Specify the file to use for importing your users',
					initialValue: savedSettings.file || 'users.json',
					placeholder: savedSettings.file || 'users.json',
					validate: (value) => {
						if (!checkIfFileExists(value)) {
							return 'That file does not exist. Please try again';
						}
						if (
							getFileType(value) !== 'text/csv' &&
							getFileType(value) !== 'application/json'
						) {
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

	// Step 3: Analyze the file and display field information
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
			'No users can be imported. All users are missing a valid identifier (verified email, verified phone, or username).'
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

	// Step 7: Display user model analysis
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

	// Step 8: Display and confirm other field settings (if any)
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

	// Step 9: Final confirmation
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
