import { describe, expect, test, vi } from 'vitest';

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
		},
	};
});

// Mock @clack/prompts
const mockNote = vi.fn();
const mockLogSuccess = vi.fn();

vi.mock('@clack/prompts', () => ({
	note: mockNote,
	log: {
		success: mockLogSuccess,
	},
}));

// ============================================================================
// getCoverageIcon tests
// ============================================================================

describe('getCoverageIcon', () => {
	async function getIconFn() {
		const mod = await import('../src/lib/export');
		return mod.getCoverageIcon;
	}

	test('returns green icon when count equals total', async () => {
		const getCoverageIcon = await getIconFn();
		const result = getCoverageIcon(10, 10);
		// Should contain the filled circle character
		expect(result).toContain('●');
	});

	test('returns yellow icon when count is partial', async () => {
		const getCoverageIcon = await getIconFn();
		const result = getCoverageIcon(5, 10);
		// Should contain the open circle character
		expect(result).toContain('○');
	});

	test('returns dim icon when count is zero', async () => {
		const getCoverageIcon = await getIconFn();
		const result = getCoverageIcon(0, 10);
		// Should contain the open circle character
		expect(result).toContain('○');
	});

	test('returns green icon for zero total with zero count', async () => {
		const getCoverageIcon = await getIconFn();
		const result = getCoverageIcon(0, 0);
		// 0 === 0 is true, so green
		expect(result).toContain('●');
	});
});

// ============================================================================
// writeExportOutput tests
// ============================================================================

describe('writeExportOutput', () => {
	async function getWriteFn() {
		const mod = await import('../src/lib/export');
		return mod.writeExportOutput;
	}

	test('creates exports directory and writes file', async () => {
		const writeExportOutput = await getWriteFn();
		const data = [{ id: 1 }, { id: 2 }];

		const result = writeExportOutput(data, 'test.json');

		expect(mockMkdirSync).toHaveBeenCalledWith(
			expect.stringContaining('exports'),
			{ recursive: true }
		);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('test.json'),
			JSON.stringify(data, null, 2)
		);
		expect(result).toContain('test.json');
	});

	test('resolves relative paths inside exports directory', async () => {
		const writeExportOutput = await getWriteFn();

		const result = writeExportOutput([], 'output.json');

		expect(result).toContain('exports');
		expect(result).toContain('output.json');
	});

	test('uses absolute paths directly', async () => {
		const writeExportOutput = await getWriteFn();

		const result = writeExportOutput([], '/tmp/absolute-output.json');

		expect(result).toBe('/tmp/absolute-output.json');
	});
});

// ============================================================================
// displayFieldCoverage tests
// ============================================================================

describe('displayFieldCoverage', () => {
	async function getDisplayFn() {
		const mod = await import('../src/lib/export');
		return mod.displayFieldCoverage;
	}

	test('calls p.note with field summary and p.log.success with count', async () => {
		const displayFieldCoverage = await getDisplayFn();

		mockNote.mockClear();
		mockLogSuccess.mockClear();

		displayFieldCoverage(
			[
				{ label: 'have email', count: 10 },
				{ label: 'have phone', count: 5 },
			],
			10,
			'/path/to/output.json'
		);

		expect(mockNote).toHaveBeenCalledTimes(1);
		expect(mockNote).toHaveBeenCalledWith(
			expect.stringContaining('10'),
			'Field Coverage'
		);
		expect(mockLogSuccess).toHaveBeenCalledTimes(1);
		expect(mockLogSuccess).toHaveBeenCalledWith(expect.stringContaining('10'));
	});

	test('includes all field labels in summary', async () => {
		const displayFieldCoverage = await getDisplayFn();

		mockNote.mockClear();

		displayFieldCoverage(
			[
				{ label: 'have email', count: 3 },
				{ label: 'have username', count: 1 },
				{ label: 'have password', count: 0 },
			],
			3,
			'/path/to/out.json'
		);

		const summaryArg = mockNote.mock.calls[0][0] as string;
		expect(summaryArg).toContain('have email');
		expect(summaryArg).toContain('have username');
		expect(summaryArg).toContain('have password');
	});
});

// ============================================================================
// getDbConnectionErrorHint tests
// ============================================================================

describe('getDbConnectionErrorHint', () => {
	async function getHintFn() {
		const mod = await import('../src/lib/export');
		return mod.getDbConnectionErrorHint;
	}

	test('returns hostname hint for ENOTFOUND (no platform)', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint('getaddrinfo ENOTFOUND host.db.co');
		expect(hint).toContain('hostname could not be resolved');
		expect(hint).toContain('Check the host');
	});

	test('returns supabase-specific hostname hint for ENOTFOUND', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'getaddrinfo ENOTFOUND db.abc.supabase.co',
			'supabase'
		);
		expect(hint).toContain('hostname could not be resolved');
		expect(hint).toContain('project ref');
	});

	test('returns betterauth-specific hostname hint for ENOTFOUND', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'getaddrinfo ENOTFOUND localhost',
			'betterauth'
		);
		expect(hint).toContain('hostname could not be resolved');
		expect(hint).toContain('Check the host');
	});

	test('returns IPv4 hint for ETIMEDOUT with supabase', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'connect ETIMEDOUT 1.2.3.4:5432',
			'supabase'
		);
		expect(hint).toContain('IPv4 add-on');
	});

	test('returns unreachable hint for ETIMEDOUT with betterauth', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'connect ETIMEDOUT 1.2.3.4:5432',
			'betterauth'
		);
		expect(hint).toContain('database server is unreachable');
	});

	test('returns IPv4 hint for ENETUNREACH with supabase', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'connect ENETUNREACH 1.2.3.4:5432',
			'supabase'
		);
		expect(hint).toContain('IPv4 add-on');
	});

	test('returns unreachable hint for ENETUNREACH with betterauth', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'connect ENETUNREACH 1.2.3.4:5432',
			'betterauth'
		);
		expect(hint).toContain('database server is unreachable');
	});

	test('returns password hint for authentication errors', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'password authentication failed for user "postgres"'
		);
		expect(hint).toContain('Check the password');
	});

	test('returns password hint for auth errors with platform', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'authentication failed for user "user"',
			'betterauth'
		);
		expect(hint).toContain('Check the password');
	});

	test('returns generic hint for unknown errors (no platform)', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint('some unexpected error');
		expect(hint).toContain('Verify your connection string');
		expect(hint).toContain('database is accessible');
	});

	test('returns supabase-specific generic hint', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint('some unexpected error', 'supabase');
		expect(hint).toContain('Verify your connection string');
		expect(hint).toContain('Supabase project');
	});

	test('returns betterauth-specific generic hint', async () => {
		const getDbConnectionErrorHint = await getHintFn();
		const hint = getDbConnectionErrorHint(
			'some unexpected error',
			'betterauth'
		);
		expect(hint).toContain('Verify your connection string');
		expect(hint).toContain('database is accessible');
	});
});
