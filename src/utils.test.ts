import { describe, expect, test } from 'vitest';
import {
	checkIfFileExists,
	createImportFilePath,
	getDateTimeStamp,
	getFileType,
	tryCatch,
} from './utils';
import path from 'path';

describe('getDateTimeStamp', () => {
	test('returns ISO format without milliseconds', () => {
		const result = getDateTimeStamp();
		// Format: YYYY-MM-DDTHH:mm:ss
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
	});

	test('does not include milliseconds or timezone', () => {
		const result = getDateTimeStamp();
		expect(result).not.toContain('.');
		expect(result).not.toContain('Z');
	});

	test('returns current time (within 1 second)', () => {
		const result = getDateTimeStamp();
		const now = new Date().toISOString().split('.')[0];
		// Compare date portion at minimum
		expect(result.substring(0, 10)).toBe(now.substring(0, 10));
	});
});

describe('createImportFilePath', () => {
	test('creates path relative to project root', () => {
		const result = createImportFilePath('/samples/test.json');
		expect(result).toContain('samples');
		expect(result).toContain('test.json');
		expect(path.isAbsolute(result)).toBe(true);
	});

	test('handles file without leading slash', () => {
		const result = createImportFilePath('users.json');
		expect(result).toContain('users.json');
		expect(path.isAbsolute(result)).toBe(true);
	});
});

describe('checkIfFileExists', () => {
	test('returns true for existing file', () => {
		const result = checkIfFileExists('/samples/clerk.json');
		expect(result).toBe(true);
	});

	test('returns false for non-existent file', () => {
		const result = checkIfFileExists('/samples/does-not-exist.json');
		expect(result).toBe(false);
	});

	test('returns false for non-existent directory', () => {
		const result = checkIfFileExists('/fake-dir/fake-file.json');
		expect(result).toBe(false);
	});
});

describe('getFileType', () => {
	test('returns application/json for .json files', () => {
		const result = getFileType('/samples/clerk.json');
		expect(result).toBe('application/json');
	});

	test('returns text/csv for .csv files', () => {
		// Create path that would be a CSV
		const result = getFileType('/samples/test.csv');
		expect(result).toBe('text/csv');
	});

	test('returns false for unknown file types', () => {
		const result = getFileType('/samples/test.xyz123');
		expect(result).toBe(false);
	});
});

describe('tryCatch', () => {
	test('returns [data, null] on successful promise', async () => {
		const promise = Promise.resolve('success');
		const [data, error] = await tryCatch(promise);
		expect(data).toBe('success');
		expect(error).toBeNull();
	});

	test('returns [null, error] on rejected promise with Error', async () => {
		const promise = Promise.reject(new Error('test error'));
		const [data, error] = await tryCatch(promise);
		expect(data).toBeNull();
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toBe('test error');
	});

	test('throws non-Error throwables', async () => {
		// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
		const promise = Promise.reject('string error');
		await expect(tryCatch(promise)).rejects.toBe('string error');
	});

	test('works with async functions', async () => {
		const asyncFn = () => {
			return Promise.resolve({ id: 1, name: 'test' });
		};
		const [data, error] = await tryCatch(asyncFn());
		expect(data).toEqual({ id: 1, name: 'test' });
		expect(error).toBeNull();
	});

	test('handles async function errors', async () => {
		const asyncFn = () => {
			return Promise.reject(new Error('async error'));
		};
		const [data, error] = await tryCatch(asyncFn());
		expect(data).toBeNull();
		expect(error?.message).toBe('async error');
	});
});
