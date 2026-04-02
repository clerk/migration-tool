import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock @clerk/backend
const mockGetUserList = vi.fn();

vi.mock('@clerk/backend', () => ({
	createClerkClient: () => ({
		users: {
			getUserList: mockGetUserList,
		},
	}),
}));

// Mock envs-constants
vi.mock('../src/envs-constants', () => ({
	env: {
		CLERK_SECRET_KEY: 'sk_test_xxx',
		RATE_LIMIT: 10,
		CONCURRENCY_LIMIT: 1,
	},
}));

// Mock fs to avoid writing files during tests
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', async () => {
	const actual = await vi.importActual('fs');
	return {
		...actual,
		default: {
			...(actual as Record<string, unknown>),
			writeFileSync: mockWriteFileSync,
			mkdirSync: mockMkdirSync,
			appendFileSync: vi.fn(),
		},
	};
});

// Mock logger
const mockExportLogger = vi.fn();

vi.mock('../src/logger', () => ({
	exportLogger: mockExportLogger,
	closeAllStreams: vi.fn(),
}));

// ============================================================================
// mapUserToExport tests
// ============================================================================

describe('mapUserToExport', () => {
	async function getMapFn() {
		const mod = await import('../src/export/clerk');
		return mod.mapUserToExport;
	}

	function makeUser(overrides: Record<string, unknown> = {}) {
		return {
			id: 'user_test123',
			emailAddresses: [],
			phoneNumbers: [],
			primaryEmailAddress: null,
			primaryPhoneAddress: null,
			primaryPhoneNumber: null,
			username: null,
			firstName: null,
			lastName: null,
			publicMetadata: {},
			privateMetadata: {},
			unsafeMetadata: {},
			banned: false,
			createOrganizationEnabled: true,
			createOrganizationsLimit: null,
			deleteSelfEnabled: true,
			passwordEnabled: false,
			totpEnabled: false,
			backupCodeEnabled: false,
			createdAt: 1700000000000,
			legalAcceptedAt: null,
			...overrides,
		};
	}

	test('maps primary email correctly', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			primaryEmailAddress: {
				emailAddress: 'primary@example.com',
			},
			emailAddresses: [
				{
					emailAddress: 'primary@example.com',
					verification: { status: 'verified' },
				},
			],
		});

		const result = mapUserToExport(user as never);
		expect(result.email).toBe('primary@example.com');
		expect(result.emailAddresses).toBeUndefined();
	});

	test('separates verified and unverified emails', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			primaryEmailAddress: {
				emailAddress: 'primary@example.com',
			},
			emailAddresses: [
				{
					emailAddress: 'primary@example.com',
					verification: { status: 'verified' },
				},
				{
					emailAddress: 'extra@example.com',
					verification: { status: 'verified' },
				},
				{
					emailAddress: 'unverified@example.com',
					verification: { status: 'unverified' },
				},
			],
		});

		const result = mapUserToExport(user as never);
		expect(result.email).toBe('primary@example.com');
		expect(result.emailAddresses).toEqual(['extra@example.com']);
		expect(result.unverifiedEmailAddresses).toEqual(['unverified@example.com']);
	});

	test('separates verified and unverified phones', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			primaryPhoneNumber: {
				phoneNumber: '+1234567890',
			},
			phoneNumbers: [
				{
					phoneNumber: '+1234567890',
					verification: { status: 'verified' },
				},
				{
					phoneNumber: '+0987654321',
					verification: { status: 'unverified' },
				},
			],
		});

		const result = mapUserToExport(user as never);
		expect(result.phone).toBe('+1234567890');
		expect(result.phoneNumbers).toBeUndefined();
		expect(result.unverifiedPhoneNumbers).toEqual(['+0987654321']);
	});

	test('converts timestamps from unix ms to ISO strings', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			createdAt: 1700000000000,
			legalAcceptedAt: 1700000000000,
		});

		const result = mapUserToExport(user as never);
		expect(result.createdAt).toBe(new Date(1700000000000).toISOString());
		expect(result.legalAcceptedAt).toBe(new Date(1700000000000).toISOString());
	});

	test('omits null/empty fields', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			username: null,
			firstName: null,
			lastName: null,
			legalAcceptedAt: null,
		});

		const result = mapUserToExport(user as never);
		expect(result.username).toBeUndefined();
		expect(result.firstName).toBeUndefined();
		expect(result.lastName).toBeUndefined();
		expect(result.legalAcceptedAt).toBeUndefined();
	});

	test('includes metadata only when non-empty', async () => {
		const mapUserToExport = await getMapFn();

		// Empty metadata should be omitted
		const userEmpty = makeUser({
			publicMetadata: {},
			privateMetadata: {},
			unsafeMetadata: {},
		});
		const emptyResult = mapUserToExport(userEmpty as never);
		expect(emptyResult.publicMetadata).toBeUndefined();
		expect(emptyResult.privateMetadata).toBeUndefined();
		expect(emptyResult.unsafeMetadata).toBeUndefined();

		// Non-empty metadata should be included
		const userWithMeta = makeUser({
			publicMetadata: { role: 'admin' },
			privateMetadata: { stripe_id: 'cus_123' },
			unsafeMetadata: { theme: 'dark' },
		});
		const metaResult = mapUserToExport(userWithMeta as never);
		expect(metaResult.publicMetadata).toEqual({ role: 'admin' });
		expect(metaResult.privateMetadata).toEqual({ stripe_id: 'cus_123' });
		expect(metaResult.unsafeMetadata).toEqual({ theme: 'dark' });
	});

	test('includes simple fields when present', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			username: 'jdoe',
			firstName: 'John',
			lastName: 'Doe',
		});

		const result = mapUserToExport(user as never);
		expect(result.username).toBe('jdoe');
		expect(result.firstName).toBe('John');
		expect(result.lastName).toBe('Doe');
	});

	test('includes banned flag only when true', async () => {
		const mapUserToExport = await getMapFn();

		const notBanned = makeUser({ banned: false });
		expect(mapUserToExport(notBanned as never).banned).toBeUndefined();

		const banned = makeUser({ banned: true });
		expect(mapUserToExport(banned as never).banned).toBe(true);
	});

	test('includes createOrganizationsLimit only when not null', async () => {
		const mapUserToExport = await getMapFn();

		const noLimit = makeUser({ createOrganizationsLimit: null });
		expect(
			mapUserToExport(noLimit as never).createOrganizationsLimit
		).toBeUndefined();

		const withLimit = makeUser({ createOrganizationsLimit: 5 });
		expect(mapUserToExport(withLimit as never).createOrganizationsLimit).toBe(
			5
		);
	});

	test('handles verified emails with no primary set', async () => {
		const mapUserToExport = await getMapFn();
		const user = makeUser({
			primaryEmailAddress: null,
			emailAddresses: [
				{
					emailAddress: 'a@example.com',
					verification: { status: 'verified' },
				},
				{
					emailAddress: 'b@example.com',
					verification: { status: 'verified' },
				},
			],
		});

		const result = mapUserToExport(user as never);
		expect(result.email).toBe('a@example.com');
		expect(result.emailAddresses).toEqual(['b@example.com']);
	});
});

// ============================================================================
// exportClerkUsers tests
// ============================================================================

describe('exportClerkUsers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function getExportFn() {
		const mod = await import('../src/export/clerk');
		return mod.exportClerkUsers;
	}

	function makeUser(overrides: Record<string, unknown> = {}) {
		return {
			id: 'user_test123',
			emailAddresses: [
				{
					emailAddress: 'test@example.com',
					verification: { status: 'verified' },
				},
			],
			phoneNumbers: [],
			primaryEmailAddress: {
				emailAddress: 'test@example.com',
			},
			primaryPhoneNumber: null,
			username: null,
			firstName: 'Test',
			lastName: null,
			publicMetadata: {},
			privateMetadata: {},
			unsafeMetadata: {},
			banned: false,
			createOrganizationEnabled: true,
			createOrganizationsLimit: null,
			deleteSelfEnabled: true,
			passwordEnabled: true,
			totpEnabled: false,
			backupCodeEnabled: false,
			createdAt: 1700000000000,
			legalAcceptedAt: null,
			...overrides,
		};
	}

	test('paginates when results equal LIMIT', async () => {
		const exportClerkUsers = await getExportFn();

		// First call returns 500 users (full page), second returns less
		const page1 = Array.from({ length: 500 }, (_, i) =>
			makeUser({ id: `user_${i}` })
		);
		const page2 = [makeUser({ id: 'user_500' })];

		mockGetUserList
			.mockResolvedValueOnce({ data: page1 })
			.mockResolvedValueOnce({ data: page2 });

		const result = await exportClerkUsers('test-output.json');

		expect(mockGetUserList).toHaveBeenCalledTimes(2);
		expect(mockGetUserList).toHaveBeenCalledWith({
			offset: 0,
			limit: 500,
		});
		expect(mockGetUserList).toHaveBeenCalledWith({
			offset: 500,
			limit: 500,
		});
		expect(result.userCount).toBe(501);
	});

	test('does not paginate when results are less than LIMIT', async () => {
		const exportClerkUsers = await getExportFn();

		const users = [makeUser(), makeUser({ id: 'user_2' })];
		mockGetUserList.mockResolvedValueOnce({ data: users });

		const result = await exportClerkUsers('test-output.json');

		expect(mockGetUserList).toHaveBeenCalledTimes(1);
		expect(result.userCount).toBe(2);
	});

	test('writes correct JSON output', async () => {
		const exportClerkUsers = await getExportFn();

		mockGetUserList.mockResolvedValueOnce({
			data: [makeUser()],
		});

		await exportClerkUsers('test-output.json');

		expect(mockMkdirSync).toHaveBeenCalledWith(
			expect.stringContaining('exports'),
			{ recursive: true }
		);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('test-output.json'),
			expect.any(String)
		);

		// Verify the written JSON is valid
		const writtenJson = mockWriteFileSync.mock.calls[0][1] as string;
		const parsed = JSON.parse(writtenJson);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].userId).toBe('user_test123');
		expect(parsed[0].email).toBe('test@example.com');
	});

	test('returns accurate field coverage counts', async () => {
		const exportClerkUsers = await getExportFn();

		const users = [
			makeUser({
				id: 'user_1',
				username: 'john',
				firstName: 'John',
				lastName: 'Doe',
				passwordEnabled: true,
			}),
			makeUser({
				id: 'user_2',
				username: null,
				firstName: 'Jane',
				lastName: null,
				passwordEnabled: false,
				phoneNumbers: [
					{
						phoneNumber: '+1234567890',
						verification: { status: 'verified' },
					},
				],
				primaryPhoneNumber: { phoneNumber: '+1234567890' },
			}),
		];

		mockGetUserList.mockResolvedValueOnce({ data: users });

		const result = await exportClerkUsers('test-output.json');

		expect(result.fieldCoverage.email).toBe(2);
		expect(result.fieldCoverage.username).toBe(1);
		expect(result.fieldCoverage.firstName).toBe(2);
		expect(result.fieldCoverage.lastName).toBe(1);
		expect(result.fieldCoverage.phone).toBe(1);
		expect(result.fieldCoverage.password).toBe(1);
	});

	test('logs each user via exportLogger', async () => {
		const exportClerkUsers = await getExportFn();

		const users = [makeUser({ id: 'user_1' }), makeUser({ id: 'user_2' })];

		mockGetUserList.mockResolvedValueOnce({ data: users });

		await exportClerkUsers('test-output.json');

		expect(mockExportLogger).toHaveBeenCalledTimes(2);
		expect(mockExportLogger).toHaveBeenCalledWith(
			{ userId: 'user_1', status: 'success' },
			expect.any(String)
		);
		expect(mockExportLogger).toHaveBeenCalledWith(
			{ userId: 'user_2', status: 'success' },
			expect.any(String)
		);
	});

	test('returns output path inside exports directory', async () => {
		const exportClerkUsers = await getExportFn();

		mockGetUserList.mockResolvedValueOnce({ data: [makeUser()] });

		const result = await exportClerkUsers('clerk-export.json');

		expect(result.outputPath).toContain('exports');
		expect(result.outputPath).toContain('clerk-export.json');
	});
});
