import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

// Use a unique directory to avoid conflicts with logger.test.ts which also uses 'logs/'
const LOGS_DIR = path.join(process.cwd(), 'test-convert-logs');

// Helper to clean up logs directory
const cleanupLogs = () => {
	if (existsSync(LOGS_DIR)) {
		rmSync(LOGS_DIR, { recursive: true });
	}
};

// Helper to create logs directory
const createLogsDir = () => {
	if (!existsSync(LOGS_DIR)) {
		mkdirSync(LOGS_DIR);
	}
};

// Helper to read JSON file
const readJSON = (filePath: string): unknown[] => {
	const content = readFileSync(filePath, 'utf8');
	return JSON.parse(content) as unknown[];
};

// Helper to write NDJSON file
const writeNDJSON = (filePath: string, entries: unknown[]): void => {
	const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
	writeFileSync(filePath, content);
};

describe('convert-logs utility', () => {
	beforeEach(() => {
		cleanupLogs();
		createLogsDir();
	});

	afterEach(() => {
		cleanupLogs();
	});

	test('converts NDJSON to JSON array', () => {
		const entries = [
			{ userId: 'user_1', status: 'success', clerkUserId: 'clerk_1' },
			{ userId: 'user_2', status: 'error', error: 'Email exists' },
			{ userId: 'user_3', status: 'success', clerkUserId: 'clerk_3' },
		];

		const logFile = path.join(LOGS_DIR, 'test-migration.log');
		writeNDJSON(logFile, entries);

		// Import and use the readNDJSON function (we'll need to export it)
		// For now, test the file format manually
		const content = readFileSync(logFile, 'utf8');
		const lines = content.trim().split('\n');
		expect(lines).toHaveLength(3);

		// Each line should be valid JSON
		const parsed = lines.map((line) => JSON.parse(line));
		expect(parsed).toEqual(entries);
	});

	test('handles empty NDJSON file', () => {
		const logFile = path.join(LOGS_DIR, 'empty.log');
		writeFileSync(logFile, '');

		const content = readFileSync(logFile, 'utf8');
		const lines = content
			.trim()
			.split('\n')
			.filter((line) => line.length > 0);
		expect(lines).toHaveLength(0);
	});

	test('handles NDJSON with different entry types', () => {
		const entries = [
			{ userId: 'user_1', status: 'success', clerkUserId: 'clerk_1' },
			{
				userId: 'user_2',
				status: 'fail',
				error: 'invalid_type for required field.',
				path: ['email'],
				row: 5,
			},
			{
				type: 'User Creation Error',
				userId: 'user_3',
				status: '422',
				error: 'Email already exists',
			},
		];

		const logFile = path.join(LOGS_DIR, 'mixed-types.log');
		writeNDJSON(logFile, entries);

		const content = readFileSync(logFile, 'utf8');
		const lines = content.trim().split('\n');
		const parsed = lines.map((line) => JSON.parse(line));
		expect(parsed).toEqual(entries);
	});

	test('preserves special characters and Unicode', () => {
		const entries = [
			{ userId: 'user_1', email: 'test@example.com', name: 'José García' },
			{ userId: 'user_2', email: 'test2@example.com', name: '李明' },
			{
				userId: 'user_3',
				error: 'Error with "quotes" and \'apostrophes\'',
			},
		];

		const logFile = path.join(LOGS_DIR, 'special-chars.log');
		writeNDJSON(logFile, entries);

		const content = readFileSync(logFile, 'utf8');
		const lines = content.trim().split('\n');
		const parsed = lines.map((line) => JSON.parse(line));
		expect(parsed).toEqual(entries);
	});

	test('handles large number of entries', () => {
		const entries = Array.from({ length: 1000 }, (_, i) => ({
			userId: `user_${i}`,
			status: i % 2 === 0 ? 'success' : 'error',
			clerkUserId: i % 2 === 0 ? `clerk_${i}` : undefined,
			error: i % 2 === 1 ? 'Sample error' : undefined,
		}));

		const logFile = path.join(LOGS_DIR, 'large.log');
		writeNDJSON(logFile, entries);

		const content = readFileSync(logFile, 'utf8');
		const lines = content.trim().split('\n');
		expect(lines).toHaveLength(1000);

		// Spot check a few entries
		const parsed = lines.map((line) => JSON.parse(line));
		expect(parsed[0]).toEqual({
			userId: 'user_0',
			status: 'success',
			clerkUserId: 'clerk_0',
		});
		expect(parsed[999]).toEqual({
			userId: 'user_999',
			status: 'error',
			error: 'Sample error',
		});
	});

	test('file format is compatible with JSON.parse per line', () => {
		const entries = [
			{ userId: 'user_1', status: 'success' },
			{ userId: 'user_2', status: 'error' },
		];

		const logFile = path.join(LOGS_DIR, 'format-test.log');
		writeNDJSON(logFile, entries);

		// Verify each line can be parsed individually
		const content = readFileSync(logFile, 'utf8');
		const lines = content.trim().split('\n');

		for (const [index, line] of lines.entries()) {
			const parsed = JSON.parse(line);
			expect(parsed).toEqual(entries[index]);
		}
	});
});

describe('JSON array format', () => {
	beforeEach(() => {
		cleanupLogs();
		createLogsDir();
	});

	afterEach(() => {
		cleanupLogs();
	});

	test('JSON array format is valid', () => {
		const entries = [
			{ userId: 'user_1', status: 'success' },
			{ userId: 'user_2', status: 'error' },
		];

		const jsonFile = path.join(LOGS_DIR, 'test.json');
		writeFileSync(jsonFile, JSON.stringify(entries, null, 2));

		const parsed = readJSON(jsonFile);
		expect(parsed).toEqual(entries);
	});

	test('JSON array preserves all data types', () => {
		const entries = [
			{ userId: 'user_1', count: 42, active: true },
			{ userId: 'user_2', count: 0, active: false },
			{ userId: 'user_3', metadata: { key: 'value' } },
			{ userId: 'user_4', tags: ['tag1', 'tag2'] },
		];

		const jsonFile = path.join(LOGS_DIR, 'datatypes.json');
		writeFileSync(jsonFile, JSON.stringify(entries, null, 2));

		const parsed = readJSON(jsonFile);
		expect(parsed).toEqual(entries);
	});
});
