import { beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
	analyzeFields,
	analyzeUserProviders,
	detectInstanceType,
	displayCrossReference,
	findUsersWithDisabledProviders,
	hasValue,
	loadRawUsers,
	loadSettings,
	saveSettings,
	validateUsers,
} from '../../src/migrate/cli';

// Mock modules
vi.mock('fs', async () => {
	const actualFs = await import('fs');
	return {
		...actualFs,
		default: {
			...actualFs.default,
			existsSync: vi.fn(actualFs.existsSync),
			readFileSync: vi.fn(actualFs.readFileSync),
			writeFileSync: vi.fn(actualFs.writeFileSync),
		},
		existsSync: vi.fn(actualFs.existsSync),
		readFileSync: vi.fn(actualFs.readFileSync),
		writeFileSync: vi.fn(actualFs.writeFileSync),
	};
});
vi.mock('@clack/prompts', () => ({
	note: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
}));
vi.mock('picocolors', () => ({
	default: {
		bold: vi.fn((s) => s),
		dim: vi.fn((s) => s),
		green: vi.fn((s) => s),
		red: vi.fn((s) => s),
		yellow: vi.fn((s) => s),
		blue: vi.fn((s) => s),
		cyan: vi.fn((s) => s),
		reset: vi.fn((s) => s),
		whiteBright: vi.fn((s) => s),
		greenBright: vi.fn((s) => s),
		yellowBright: vi.fn((s) => s),
		bgCyan: vi.fn((s) => s),
		black: vi.fn((s) => s),
	},
}));

vi.mock('../../src/logger', () => ({
	validationLogger: vi.fn(),
}));

// Import the mocked module to get access to the mock
import * as p from '@clack/prompts';

// Create a module mock for envs-constants
let mockSecretKey = 'sk_test_mockkey';

vi.mock('../../src/envs-constants', () => ({
	env: {
		get CLERK_SECRET_KEY() {
			return mockSecretKey;
		},
	},
}));

// Mock the utils module
vi.mock('../../src/utils', async (importOriginal) => {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		createImportFilePath: vi.fn((file: string) => file),
		getFileType: vi.fn((file: string) => {
			if (file.endsWith('.csv')) return 'text/csv';
			if (file.endsWith('.json')) return 'application/json';
			return 'unknown';
		}),
		checkIfFileExists: vi.fn(() => true),
	};
});

// ============================================================================
// detectInstanceType tests
// ============================================================================

describe('detectInstanceType', () => {
	beforeEach(() => {
		mockSecretKey = 'sk_test_mockkey';
	});

	test('detects dev instance from sk_test_ prefix', () => {
		mockSecretKey = 'sk_test_abcdefghijklmnopqrstuvwxyz123456';
		const result = detectInstanceType();
		expect(result).toBe('dev');
	});

	test('detects prod instance from sk_live_ prefix', () => {
		mockSecretKey = 'sk_live_abcdefghijklmnopqrstuvwxyz123456';
		const result = detectInstanceType();
		expect(result).toBe('prod');
	});

	test('detects prod instance from other prefixes', () => {
		mockSecretKey = 'sk_prod_abcdefghijklmnopqrstuvwxyz123456';
		const result = detectInstanceType();
		expect(result).toBe('prod');
	});

	test('detects prod instance from sk_ without test', () => {
		mockSecretKey = 'sk_abcdefghijklmnopqrstuvwxyz123456';
		const result = detectInstanceType();
		expect(result).toBe('prod');
	});
});

// ============================================================================
// loadSettings and saveSettings tests
// ============================================================================

describe('loadSettings', () => {
	const mockSettingsPath = path.join(process.cwd(), '.settings');

	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('loads settings from .settings file when it exists', () => {
		const mockSettings = { key: 'clerk', file: 'users.json' };
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSettings));

		const result = loadSettings();

		expect(fs.existsSync).toHaveBeenCalledWith(mockSettingsPath);
		expect(fs.readFileSync).toHaveBeenCalledWith(mockSettingsPath, 'utf-8');
		expect(result).toEqual(mockSettings);
	});

	test('returns empty object when .settings file does not exist', () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const result = loadSettings();

		expect(fs.existsSync).toHaveBeenCalledWith(mockSettingsPath);
		expect(fs.readFileSync).not.toHaveBeenCalled();
		expect(result).toEqual({});
	});

	test('returns empty object when .settings file is corrupted', () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json');

		const result = loadSettings();

		expect(result).toEqual({});
	});

	test('returns empty object when .settings file cannot be read', () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			throw new Error('Permission denied');
		});

		const result = loadSettings();

		expect(result).toEqual({});
	});

	test('returns empty object when JSON.parse fails', () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(fs.readFileSync).mockReturnValue('not json at all');

		const result = loadSettings();

		expect(result).toEqual({});
	});
});

describe('saveSettings', () => {
	const mockSettingsPath = path.join(process.cwd(), '.settings');

	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('writes settings to .settings file', () => {
		const settings = { key: 'clerk', file: 'users.json', offset: '10' };
		vi.mocked(fs.writeFileSync).mockImplementation(() => {});

		saveSettings(settings);

		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mockSettingsPath,
			JSON.stringify(settings, null, 2)
		);
	});

	test('silently fails when unable to write file', () => {
		const settings = { key: 'clerk', file: 'users.json' };
		vi.mocked(fs.writeFileSync).mockImplementation(() => {
			throw new Error('Permission denied');
		});

		// Should not throw
		expect(() => saveSettings(settings)).not.toThrow();
	});

	test('formats JSON with 2-space indentation', () => {
		const settings = { key: 'clerk', file: 'users.json', offset: '0' };
		vi.mocked(fs.writeFileSync).mockImplementation(() => {});

		saveSettings(settings);

		const expectedJson = JSON.stringify(settings, null, 2);
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mockSettingsPath,
			expectedJson
		);
	});
});

// ============================================================================
// hasValue tests
// ============================================================================

describe('hasValue', () => {
	test('returns false for undefined', () => {
		expect(hasValue(undefined)).toBe(false);
	});

	test('returns false for null', () => {
		expect(hasValue(null)).toBe(false);
	});

	test('returns false for empty string', () => {
		expect(hasValue('')).toBe(false);
	});

	test('returns false for empty array', () => {
		expect(hasValue([])).toBe(false);
	});

	test('returns true for non-empty string', () => {
		expect(hasValue('hello')).toBe(true);
	});

	test('returns true for number 0', () => {
		expect(hasValue(0)).toBe(true);
	});

	test('returns true for boolean false', () => {
		expect(hasValue(false)).toBe(true);
	});

	test('returns true for non-empty array', () => {
		expect(hasValue([1, 2, 3])).toBe(true);
	});

	test('returns true for array with one element', () => {
		expect(hasValue(['item'])).toBe(true);
	});

	test('returns true for empty object', () => {
		expect(hasValue({})).toBe(true);
	});

	test('returns true for object with properties', () => {
		expect(hasValue({ key: 'value' })).toBe(true);
	});

	test('returns true for string with whitespace', () => {
		expect(hasValue(' ')).toBe(true);
	});
});

// ============================================================================
// analyzeFields tests
// ============================================================================

describe('analyzeFields', () => {
	test('returns empty analysis for empty user array', () => {
		const result = analyzeFields([]);

		expect(result).toEqual({
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
		});
	});

	test('counts verified emails correctly (email field)', () => {
		const users = [
			{ userId: '1', email: 'test1@example.com' },
			{ userId: '2', email: 'test2@example.com' },
			{ userId: '3' }, // no email
		];

		const result = analyzeFields(users);

		expect(result.identifiers.verifiedEmails).toBe(2);
		expect(result.identifiers.hasAnyIdentifier).toBe(2);
	});

	test('counts verified emails correctly (emailAddresses field)', () => {
		const users = [
			{ userId: '1', emailAddresses: ['test1@example.com'] },
			{ userId: '2', emailAddresses: ['test2@example.com'] },
			{ userId: '3' }, // no email
		];

		const result = analyzeFields(users);

		expect(result.identifiers.verifiedEmails).toBe(2);
	});

	test('counts verified emails when either email or emailAddresses is present', () => {
		const users = [
			{ userId: '1', email: 'test1@example.com' },
			{ userId: '2', emailAddresses: ['test2@example.com'] },
			{
				userId: '3',
				email: 'test3@example.com',
				emailAddresses: ['test3@example.com'],
			},
		];

		const result = analyzeFields(users);

		expect(result.identifiers.verifiedEmails).toBe(3);
	});

	test('counts unverified emails correctly', () => {
		const users = [
			{
				userId: '1',
				email: 'verified@example.com',
				unverifiedEmailAddresses: ['unverified@example.com'],
			},
			{ userId: '2', unverifiedEmailAddresses: ['unverified2@example.com'] },
			{ userId: '3', email: 'test@example.com' }, // no unverified
		];

		const result = analyzeFields(users);

		expect(result.identifiers.unverifiedEmails).toBe(2);
	});

	test('counts verified phones correctly (phone field)', () => {
		const users = [
			{ userId: '1', phone: '+1234567890' },
			{ userId: '2', phone: '+0987654321' },
			{ userId: '3' }, // no phone
		];

		const result = analyzeFields(users);

		expect(result.identifiers.verifiedPhones).toBe(2);
		expect(result.identifiers.hasAnyIdentifier).toBe(2);
	});

	test('counts verified phones correctly (phoneNumbers field)', () => {
		const users = [
			{ userId: '1', phoneNumbers: ['+1234567890'] },
			{ userId: '2', phoneNumbers: ['+0987654321'] },
		];

		const result = analyzeFields(users);

		expect(result.identifiers.verifiedPhones).toBe(2);
	});

	test('counts unverified phones correctly', () => {
		const users = [
			{
				userId: '1',
				phone: '+1234567890',
				unverifiedPhoneNumbers: ['+9999999999'],
			},
			{ userId: '2', unverifiedPhoneNumbers: ['+8888888888'] },
			{ userId: '3', phone: '+1234567890' }, // no unverified
		];

		const result = analyzeFields(users);

		expect(result.identifiers.unverifiedPhones).toBe(2);
	});

	test('counts usernames correctly', () => {
		const users = [
			{ userId: '1', username: 'user1', email: 'test@example.com' },
			{ userId: '2', username: 'user2', email: 'test2@example.com' },
			{ userId: '3', email: 'test3@example.com' }, // no username
		];

		const result = analyzeFields(users);

		expect(result.identifiers.username).toBe(2);
	});

	test('counts users with at least one identifier', () => {
		const users = [
			{ userId: '1', email: 'test1@example.com' },
			{ userId: '2', phone: '+1234567890' },
			{ userId: '3', username: 'user3', email: 'test3@example.com' },
			{ userId: '4' }, // no identifiers
		];

		const result = analyzeFields(users);

		expect(result.identifiers.hasAnyIdentifier).toBe(3);
	});

	test('does not count unverified identifiers toward hasAnyIdentifier', () => {
		const users = [
			{ userId: '1', unverifiedEmailAddresses: ['test@example.com'] },
			{ userId: '2', unverifiedPhoneNumbers: ['+1234567890'] },
		];

		const result = analyzeFields(users);

		expect(result.identifiers.hasAnyIdentifier).toBe(0);
	});

	test('identifies fields present on all users', () => {
		const users = [
			{
				userId: '1',
				firstName: 'John',
				lastName: 'Doe',
				email: 'test@example.com',
			},
			{
				userId: '2',
				firstName: 'Jane',
				lastName: 'Smith',
				email: 'test2@example.com',
			},
			{
				userId: '3',
				firstName: 'Bob',
				lastName: 'Johnson',
				email: 'test3@example.com',
			},
		];

		const result = analyzeFields(users);

		expect(result.presentOnAll).toContain('First Name');
		expect(result.presentOnAll).toContain('Last Name');
		expect(result.presentOnSome).not.toContain('First Name');
		expect(result.presentOnSome).not.toContain('Last Name');
	});

	test('identifies fields present on some users', () => {
		const users = [
			{ userId: '1', firstName: 'John', email: 'test@example.com' },
			{ userId: '2', lastName: 'Smith', email: 'test2@example.com' },
			{ userId: '3', email: 'test3@example.com' },
		];

		const result = analyzeFields(users);

		expect(result.presentOnSome).toContain('First Name');
		expect(result.presentOnSome).toContain('Last Name');
		expect(result.presentOnAll).not.toContain('First Name');
		expect(result.presentOnAll).not.toContain('Last Name');
	});

	test('analyzes password field correctly', () => {
		const users = [
			{ userId: '1', password: 'hash1', email: 'test@example.com' },
			{ userId: '2', password: 'hash2', email: 'test2@example.com' },
			{ userId: '3', email: 'test3@example.com' },
		];

		const result = analyzeFields(users);

		expect(result.presentOnSome).toContain('Password');
	});

	test('analyzes totpSecret field correctly', () => {
		const users = [
			{ userId: '1', totpSecret: 'secret1', email: 'test@example.com' },
			{ userId: '2', email: 'test2@example.com' },
		];

		const result = analyzeFields(users);

		expect(result.presentOnSome).toContain('TOTP Secret');
	});

	test('returns correct totalUsers count', () => {
		const users = [
			{ userId: '1', email: 'test@example.com' },
			{ userId: '2', email: 'test2@example.com' },
			{ userId: '3', email: 'test3@example.com' },
		];

		const result = analyzeFields(users);

		expect(result.totalUsers).toBe(3);
	});

	test('handles users with all identifier types', () => {
		const users = [
			{
				userId: '1',
				email: 'test@example.com',
				phone: '+1234567890',
				username: 'testuser',
				unverifiedEmailAddresses: ['unverified@example.com'],
				unverifiedPhoneNumbers: ['+9999999999'],
			},
		];

		const result = analyzeFields(users);

		expect(result.identifiers.verifiedEmails).toBe(1);
		expect(result.identifiers.unverifiedEmails).toBe(1);
		expect(result.identifiers.verifiedPhones).toBe(1);
		expect(result.identifiers.unverifiedPhones).toBe(1);
		expect(result.identifiers.username).toBe(1);
		expect(result.identifiers.hasAnyIdentifier).toBe(1);
	});

	test('ignores empty string values in hasValue check', () => {
		const users = [
			{
				userId: '1',
				firstName: '',
				lastName: 'Doe',
				email: 'test@example.com',
			},
			{
				userId: '2',
				firstName: 'Jane',
				lastName: '',
				email: 'test2@example.com',
			},
		];

		const result = analyzeFields(users);

		expect(result.presentOnSome).toContain('First Name');
		expect(result.presentOnSome).toContain('Last Name');
		expect(result.presentOnAll).not.toContain('First Name');
		expect(result.presentOnAll).not.toContain('Last Name');
	});

	test('ignores empty arrays in hasValue check', () => {
		const users = [
			{ userId: '1', email: 'test@example.com', emailAddresses: [] },
			{ userId: '2', phone: '+1234567890', phoneNumbers: [] },
		];

		const result = analyzeFields(users);

		// Email should still be counted because email field is present
		expect(result.identifiers.verifiedEmails).toBe(1);
		expect(result.identifiers.verifiedPhones).toBe(1);
	});
});

// ============================================================================
// analyzeUserProviders tests
// ============================================================================

describe('analyzeUserProviders', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('counts users per provider from raw_app_meta_data', () => {
		const mockData = [
			{ raw_app_meta_data: { providers: ['email'] } },
			{ raw_app_meta_data: { providers: ['email'] } },
			{ raw_app_meta_data: { providers: ['discord'] } },
			{ raw_app_meta_data: { providers: ['email', 'google'] } },
		];
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const result = analyzeUserProviders('test.json');

		expect(result).toEqual({ email: 3, discord: 1, google: 1 });
	});

	test('returns empty object for invalid file', () => {
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			throw new Error('File not found');
		});

		const result = analyzeUserProviders('missing.json');

		expect(result).toEqual({});
	});

	test('skips users without raw_app_meta_data', () => {
		const mockData = [
			{ raw_app_meta_data: { providers: ['email'] } },
			{ email: 'test@example.com' }, // no raw_app_meta_data
		];
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const result = analyzeUserProviders('test.json');

		expect(result).toEqual({ email: 1 });
	});
});

// ============================================================================
// findUsersWithDisabledProviders tests
// ============================================================================

describe('findUsersWithDisabledProviders', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('returns user IDs that have disabled providers', () => {
		const mockData = [
			{ id: 'user-1', raw_app_meta_data: { providers: ['email'] } },
			{ id: 'user-2', raw_app_meta_data: { providers: ['discord'] } },
			{
				id: 'user-3',
				raw_app_meta_data: { providers: ['email', 'discord'] },
			},
			{ id: 'user-4', raw_app_meta_data: { providers: ['google'] } },
		];
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const result = findUsersWithDisabledProviders('test.json', ['discord']);

		expect(result).toEqual(new Set(['user-2', 'user-3']));
	});

	test('returns empty set when no disabled providers specified', () => {
		const result = findUsersWithDisabledProviders('test.json', []);

		expect(result).toEqual(new Set());
		expect(fs.readFileSync).not.toHaveBeenCalled();
	});

	test('returns empty set for invalid file', () => {
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			throw new Error('File not found');
		});

		const result = findUsersWithDisabledProviders('missing.json', ['discord']);

		expect(result).toEqual(new Set());
	});

	test('handles multiple disabled providers', () => {
		const mockData = [
			{ id: 'user-1', raw_app_meta_data: { providers: ['email'] } },
			{ id: 'user-2', raw_app_meta_data: { providers: ['discord'] } },
			{ id: 'user-3', raw_app_meta_data: { providers: ['twitter'] } },
			{
				id: 'user-4',
				raw_app_meta_data: { providers: ['email', 'google'] },
			},
		];
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const result = findUsersWithDisabledProviders('test.json', [
			'discord',
			'twitter',
		]);

		expect(result).toEqual(new Set(['user-2', 'user-3']));
	});

	test('skips users without raw_app_meta_data', () => {
		const mockData = [
			{ id: 'user-1', email: 'test@example.com' },
			{ id: 'user-2', raw_app_meta_data: { providers: ['discord'] } },
		];
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

		const result = findUsersWithDisabledProviders('test.json', ['discord']);

		expect(result).toEqual(new Set(['user-2']));
	});
});

// ============================================================================
// displayCrossReference tests
// ============================================================================

describe('displayCrossReference', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('calls p.note with Migration Readiness title', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.any(String),
			'Migration Readiness'
		);
	});

	test('shows enabled items with green check', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('enabled in Clerk'),
			'Migration Readiness'
		);
	});

	test('shows disabled items with red cross', () => {
		const items = [
			{
				label: 'Discord',
				userCount: 5,
				clerkEnabled: false as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'social' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('not enabled in Clerk'),
			'Migration Readiness'
		);
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('1 setting'),
			'Migration Readiness'
		);
	});

	test('shows unknown items with yellow circle when no Clerk config', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('enable in Clerk Dashboard'),
			'Migration Readiness'
		);
	});

	test('shows "can be required" hint for identifiers when all users have it and no Clerk config', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('can be required'),
			'Migration Readiness'
		);
	});

	test('shows "do not require" hint for identifiers when not all users have it and no Clerk config', () => {
		const items = [
			{
				label: 'Email',
				userCount: 7,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 7,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('do not require'),
			'Migration Readiness'
		);
	});

	test('warns when identifier is required in Clerk but not all users have it', () => {
		const items = [
			{
				label: 'Email',
				userCount: 7,
				clerkEnabled: true as boolean | null,
				clerkRequired: true as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 7,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('required in Clerk'),
			'Migration Readiness'
		);
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('3 will fail without email'),
			'Migration Readiness'
		);
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('1 setting'),
			'Migration Readiness'
		);
	});

	test('shows green check when identifier is required and all users have it', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: true as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('enabled in Clerk'),
			'Migration Readiness'
		);
		expect(p.note).not.toHaveBeenCalledWith(
			expect.stringContaining('will fail'),
			'Migration Readiness'
		);
	});

	test('does not show require hints for non-identifier sections', () => {
		const items = [
			{
				label: 'Password',
				userCount: 10,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'auth' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		const noteCall = vi.mocked(p.note).mock.calls[0][0] as string;
		expect(noteCall).not.toContain('can be required');
		expect(noteCall).not.toContain('do not require');
	});

	test('shows total user count', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('10 users in file'),
			'Migration Readiness'
		);
	});

	test('shows count/total format for partial coverage', () => {
		const items = [
			{
				label: 'Email',
				userCount: 15,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 15,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 30,
			},
			totalUsers: 30,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('15/30 users'),
			'Migration Readiness'
		);
	});

	test('shows validation failure count and log file reference', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(
			items,
			analysis,
			{ clerk: 'loaded' },
			{
				validationFailed: 3,
				logFile: 'migration-2025-01-01-120000.log',
			}
		);

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('3 users failed validation'),
			'Migration Readiness'
		);
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('migration-2025-01-01-120000.log'),
			'Migration Readiness'
		);
	});

	test('does not show validation section when no failures', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(
			items,
			analysis,
			{ clerk: 'loaded' },
			{
				validationFailed: 0,
				logFile: '',
			}
		);

		const noteCall = vi.mocked(p.note).mock.calls[0][0] as string;
		expect(noteCall).not.toContain('failed validation');
	});

	test('shows Clerk Configuration loaded when config succeeded', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis, { clerk: 'loaded' });

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Configuration loaded from Clerk'),
			'Migration Readiness'
		);
	});

	test('shows Clerk Configuration error guidance when config failed', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis, { clerk: 'failed' });

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Could not fetch Clerk configuration'),
			'Migration Readiness'
		);
		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Verify your Clerk Dashboard settings'),
			'Migration Readiness'
		);
	});

	test('shows Clerk Configuration skipped guidance when no publishable key', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: null as boolean | null,
				clerkRequired: null as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis, { clerk: 'skipped' });

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('CLERK_PUBLISHABLE_KEY'),
			'Migration Readiness'
		);
	});

	test('shows Supabase Configuration section only for supabase migrations', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis, {
			clerk: 'loaded',
			supabase: 'loaded',
		});

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Supabase Configuration'),
			'Migration Readiness'
		);
	});

	test('does not show Supabase section for non-supabase migrations', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis, { clerk: 'loaded' });

		const noteCall = vi.mocked(p.note).mock.calls[0][0] as string;
		expect(noteCall).not.toContain('Supabase Configuration');
	});

	test('shows Import File section with total users', () => {
		const items = [
			{
				label: 'Email',
				userCount: 10,
				clerkEnabled: true as boolean | null,
				clerkRequired: false as boolean | null,
				section: 'identifiers' as const,
			},
		];
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 0,
				unverifiedPhones: 0,
				username: 0,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
			fieldCounts: {},
		};

		displayCrossReference(items, analysis, { clerk: 'loaded' });

		expect(p.note).toHaveBeenCalledWith(
			expect.stringContaining('Import File'),
			'Migration Readiness'
		);
	});
});

// ============================================================================
// validateUsers tests
// ============================================================================

describe('validateUsers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('returns 0 failures for valid users', () => {
		const users = [
			{ userId: 'user_1', email: 'a@test.com' },
			{ userId: 'user_2', email: 'b@test.com' },
		];

		const result = validateUsers(users, 'clerk');

		expect(result.validationFailed).toBe(0);
		expect(result.logFile).toMatch(/^migration-.*\.log$/);
	});

	test('counts validation failures for users missing identifiers', () => {
		const users = [
			{ userId: 'user_1', email: 'a@test.com' },
			{ userId: 'user_2' }, // no identifier
			{ userId: 'user_3' }, // no identifier
		];

		const result = validateUsers(users, 'clerk');

		expect(result.validationFailed).toBe(2);
	});

	test('applies transformer defaults before validating', () => {
		// Supabase transformer adds passwordHasher: "bcrypt" as default
		// Without defaults, users with password but no hasher would fail
		const users = [
			{ userId: 'user_1', email: 'a@test.com', password: '$2a$10$hash' },
		];

		const result = validateUsers(users, 'supabase');

		expect(result.validationFailed).toBe(0);
	});

	test('fails validation for users with password but no hasher when no defaults', () => {
		const users = [
			{ userId: 'user_1', email: 'a@test.com', password: 'somepassword' },
		];

		const result = validateUsers(users, 'clerk');

		expect(result.validationFailed).toBe(1);
	});

	test('logs validation errors via validationLogger', async () => {
		const { validationLogger } = await import('../../src/logger');
		const users = [
			{ userId: 'user_1' }, // no identifier
		];

		validateUsers(users, 'clerk');

		expect(validationLogger).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user_1',
				row: 0,
			}),
			expect.any(String)
		);
	});
});

// ============================================================================
// loadRawUsers tests
// ============================================================================

describe('loadRawUsers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('loads and transforms JSON file with clerk transformer', async () => {
		const mockJsonData = [
			{
				id: 'user_123',
				first_name: 'John',
				last_name: 'Doe',
				primary_email_address: 'john@example.com',
			},
			{
				id: 'user_456',
				first_name: 'Jane',
				last_name: 'Smith',
				primary_email_address: 'jane@example.com',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'clerk');

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			userId: 'user_123',
			firstName: 'John',
			lastName: 'Doe',
			email: 'john@example.com',
		});
		expect(result[1]).toEqual({
			userId: 'user_456',
			firstName: 'Jane',
			lastName: 'Smith',
			email: 'jane@example.com',
		});
	});

	test('filters out empty string values', async () => {
		const mockJsonData = [
			{
				id: 'user_123',
				first_name: 'John',
				last_name: '',
				primary_email_address: 'john@example.com',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'clerk');

		expect(result[0]).toEqual({
			userId: 'user_123',
			firstName: 'John',
			email: 'john@example.com',
		});
		expect(result[0]).not.toHaveProperty('lastName');
	});

	test('filters out "{}" string values', async () => {
		const mockJsonData = [
			{
				id: 'user_123',
				first_name: 'John',
				public_metadata: '"{}"',
				primary_email_address: 'john@example.com',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'clerk');

		expect(result[0]).toEqual({
			userId: 'user_123',
			firstName: 'John',
			email: 'john@example.com',
		});
		expect(result[0]).not.toHaveProperty('publicMetadata');
	});

	test('filters out null values', async () => {
		const mockJsonData = [
			{
				id: 'user_123',
				first_name: 'John',
				last_name: null,
				primary_email_address: 'john@example.com',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'clerk');

		expect(result[0]).toEqual({
			userId: 'user_123',
			firstName: 'John',
			email: 'john@example.com',
		});
		expect(result[0]).not.toHaveProperty('lastName');
	});

	test('throws error when transformer is not found', async () => {
		await expect(
			loadRawUsers('users.json', 'invalid_transformer')
		).rejects.toThrow('Transformer not found for key: invalid_transformer');
	});

	test('loads and transforms with supabase transformer', async () => {
		const mockJsonData = [
			{
				id: 'uuid-123',
				email: 'john@example.com',
				email_confirmed_at: '2024-01-01 12:00:00+00',
				encrypted_password: '$2a$10$hash',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'supabase');

		expect(result[0]).toEqual({
			userId: 'uuid-123',
			email: 'john@example.com',
			password: '$2a$10$hash',
		});
	});

	test('loads and transforms with auth0 transformer', async () => {
		const mockJsonData = [
			{
				user_id: 'auth0|abc123',
				email: 'john@example.com',
				email_verified: true,
				username: 'johndoe',
				given_name: 'John',
				family_name: 'Doe',
				phone_number: '+1234567890',
				phone_verified: true,
				created_at: '2025-01-15T10:30:00.000Z',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'auth0');

		// postTransform removes emailVerified/phoneVerified after processing
		expect(result[0]).toEqual({
			userId: 'auth0|abc123',
			email: 'john@example.com',
			username: 'johndoe',
			firstName: 'John',
			lastName: 'Doe',
			phone: '+1234567890',
			createdAt: '2025-01-15T10:30:00.000Z',
		});
	});

	test('loads and transforms with authjs transformer', async () => {
		const mockJsonData = [
			{
				id: '1',
				email: 'john@example.com',
				email_verified: '2024-01-15T10:30:00.000Z',
				name: 'John Doe',
				created_at: '2024-01-15T10:30:00.000Z',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'authjs');

		// postTransform should:
		// - Split name into firstName and lastName
		// - Keep email (since email_verified is truthy)
		// - Remove email_verified field
		// - Remove name field
		expect(result[0]).toEqual({
			userId: '1',
			email: 'john@example.com',
			firstName: 'John',
			lastName: 'Doe',
			createdAt: '2024-01-15T10:30:00.000Z',
		});
	});

	test('authjs transformer handles unverified emails and single-word names', async () => {
		const mockJsonData = [
			{
				id: '1',
				email: 'unverified@example.com',
				email_verified: null, // Unverified email
				name: 'Madonna', // Single word name
				created_at: '2024-01-15T10:30:00.000Z',
			},
			{
				id: '2',
				email: 'verified@example.com',
				email_verified: '2024-01-15T10:30:00.000Z',
				name: null, // Null name
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'authjs');

		// First user: unverified email + single-word name (discarded)
		expect(result[0]).toEqual({
			userId: '1',
			unverifiedEmailAddresses: 'unverified@example.com',
			createdAt: '2024-01-15T10:30:00.000Z',
		});
		expect(result[0]).not.toHaveProperty('email');
		expect(result[0]).not.toHaveProperty('firstName');
		expect(result[0]).not.toHaveProperty('lastName');

		// Second user: verified email + null name
		expect(result[1]).toEqual({
			userId: '2',
			email: 'verified@example.com',
		});
		expect(result[1]).not.toHaveProperty('firstName');
		expect(result[1]).not.toHaveProperty('lastName');
	});

	test('keeps unmapped keys unchanged', async () => {
		const mockJsonData = [
			{
				id: 'user_123',
				customField: 'custom value',
				primary_email_address: 'john@example.com',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'clerk');

		expect(result[0]).toEqual({
			userId: 'user_123',
			customField: 'custom value',
			email: 'john@example.com',
		});
	});
});
