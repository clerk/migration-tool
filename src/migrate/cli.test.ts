import { describe, expect, test, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
	detectInstanceType,
	loadSettings,
	saveSettings,
	hasValue,
	analyzeFields,
	formatCount,
	displayIdentifierAnalysis,
	displayOtherFieldsAnalysis,
	loadRawUsers,
} from './cli';

// Mock modules
vi.mock('fs', async () => {
	const actualFs = await import('fs');
	return {
		default: {
			...actualFs.default,
			existsSync: vi.fn(actualFs.existsSync),
			readFileSync: vi.fn(actualFs.readFileSync),
			writeFileSync: vi.fn(actualFs.writeFileSync),
		},
		...actualFs,
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
	},
}));

// Import the mocked module to get access to the mock
import * as p from '@clack/prompts';

// Create a module mock for envs-constants
let mockSecretKey = 'sk_test_mockkey';

vi.mock('../envs-constants', () => ({
	env: {
		get CLERK_SECRET_KEY() {
			return mockSecretKey;
		},
	},
}));

// Mock the utils module
vi.mock('../utils', () => ({
	createImportFilePath: vi.fn((file: string) => file),
	getFileType: vi.fn((file: string) => {
		if (file.endsWith('.csv')) return 'text/csv';
		if (file.endsWith('.json')) return 'application/json';
		return 'unknown';
	}),
	checkIfFileExists: vi.fn(() => true),
}));

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
		const mockSettings = { key: 'clerk', file: 'users.json', offset: '0' };
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
// formatCount tests
// ============================================================================

describe('formatCount', () => {
	test('returns "All users have {label}" when count equals total', () => {
		const result = formatCount(10, 10, 'email');
		expect(result).toBe('All users have email');
	});

	test('returns "No users have {label}" when count is 0', () => {
		const result = formatCount(0, 10, 'email');
		expect(result).toBe('No users have email');
	});

	test('returns "{count} of {total} users have {label}" for partial counts', () => {
		const result = formatCount(5, 10, 'email');
		expect(result).toBe('5 of 10 users have email');
	});

	test('handles count of 1 out of many', () => {
		const result = formatCount(1, 100, 'a username');
		expect(result).toBe('1 of 100 users have a username');
	});

	test('handles large numbers', () => {
		const result = formatCount(1234, 5678, 'verified emails');
		expect(result).toBe('1234 of 5678 users have verified emails');
	});

	test('handles count equal to total of 1', () => {
		const result = formatCount(1, 1, 'phone number');
		expect(result).toBe('All users have phone number');
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
				_id: { $oid: 'auth0123' },
				email: 'john@example.com',
				email_verified: true,
				username: 'johndoe',
				given_name: 'John',
				family_name: 'Doe',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'auth0');

		// transformKeys now supports nested path extraction via dot notation
		// postTransform removes emailVerified after processing
		expect(result[0]).toEqual({
			userId: 'auth0123',
			email: 'john@example.com',
			username: 'johndoe',
			firstName: 'John',
			lastName: 'Doe',
		});
	});

	test('loads and transforms with authjs transformer', async () => {
		const mockJsonData = [
			{
				id: '1',
				email: 'john@example.com',
				name: 'John Doe',
			},
		];

		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockJsonData));

		const result = await loadRawUsers('users.json', 'authjs');

		expect(result[0]).toEqual({
			userId: '1',
			email: 'john@example.com',
			name: 'John Doe',
		});
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

// ============================================================================
// displayIdentifierAnalysis tests
// ============================================================================

describe('displayIdentifierAnalysis', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('calls p.note with analysis message', () => {
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 10,
				unverifiedEmails: 0,
				verifiedPhones: 10,
				unverifiedPhones: 0,
				username: 10,
				hasAnyIdentifier: 10,
			},
			totalUsers: 10,
		};

		displayIdentifierAnalysis(analysis);

		expect(p.note).toHaveBeenCalledWith(expect.any(String), 'Identifiers');
	});

	test('handles analysis with all users having identifiers', () => {
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 5,
				unverifiedEmails: 0,
				verifiedPhones: 5,
				unverifiedPhones: 0,
				username: 5,
				hasAnyIdentifier: 5,
			},
			totalUsers: 5,
		};

		// Should not throw
		expect(() => displayIdentifierAnalysis(analysis)).not.toThrow();
	});

	test('handles analysis with missing identifiers', () => {
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 3,
				unverifiedEmails: 0,
				verifiedPhones: 2,
				unverifiedPhones: 0,
				username: 1,
				hasAnyIdentifier: 8,
			},
			totalUsers: 10,
		};

		// Should not throw
		expect(() => displayIdentifierAnalysis(analysis)).not.toThrow();
	});

	test('handles analysis with unverified identifiers', () => {
		const analysis = {
			presentOnAll: [],
			presentOnSome: [],
			identifiers: {
				verifiedEmails: 5,
				unverifiedEmails: 3,
				verifiedPhones: 5,
				unverifiedPhones: 2,
				username: 5,
				hasAnyIdentifier: 5,
			},
			totalUsers: 5,
		};

		// Should not throw
		expect(() => displayIdentifierAnalysis(analysis)).not.toThrow();
	});
});

// ============================================================================
// displayOtherFieldsAnalysis tests
// ============================================================================

describe('displayOtherFieldsAnalysis', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('returns false when no fields are analyzed', () => {
		const analysis = {
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
		};

		const result = displayOtherFieldsAnalysis(analysis);

		expect(result).toBe(false);
		expect(p.note).not.toHaveBeenCalled();
	});

	test('returns true when fields are present on all users', () => {
		const analysis = {
			presentOnAll: ['TOTP Secret'],
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

		const result = displayOtherFieldsAnalysis(analysis);

		expect(result).toBe(true);
		expect(p.note).toHaveBeenCalledWith(expect.any(String), 'Other Fields');
	});

	test('returns true when fields are present on some users', () => {
		const analysis = {
			presentOnAll: [],
			presentOnSome: ['TOTP Secret'],
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

		const result = displayOtherFieldsAnalysis(analysis);

		expect(result).toBe(true);
		expect(p.note).toHaveBeenCalledWith(expect.any(String), 'Other Fields');
	});

	test('returns true when both presentOnAll and presentOnSome have fields', () => {
		const analysis = {
			presentOnAll: ['TOTP Secret'],
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

		const result = displayOtherFieldsAnalysis(analysis);

		expect(result).toBe(true);
		expect(p.note).toHaveBeenCalledWith(expect.any(String), 'Other Fields');
	});
});
