import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	closeAllStreams,
	deleteErrorLogger,
	deleteLogger,
	errorLogger,
	importLogger,
	validationLogger,
} from './logger';
import { existsSync, readFileSync, rmSync } from 'node:fs';

// Helper to clean up logs directory
const cleanupLogs = () => {
	closeAllStreams(); // Close streams before cleanup
	if (existsSync('logs')) {
		rmSync('logs', { recursive: true });
	}
};

// Helper to read NDJSON (newline-delimited JSON) files
const readNDJSON = (filePath: string): unknown[] => {
	const content = readFileSync(filePath, 'utf8');
	return content
		.trim()
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
};

describe('errorLogger', () => {
	beforeEach(cleanupLogs);
	afterEach(cleanupLogs);

	test('logs a single error to migration log', () => {
		const dateTime = 'error-single-test';

		errorLogger(
			{
				errors: [
					{
						code: '1234',
						message: 'isolinear chip failed to initialize',
					},
				],
				status: 'error',
				userId: '123',
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			type: 'User Creation Error',
			userId: '123',
			status: 'error',
			error: undefined, // longMessage is undefined
		});
	});

	test('logs error with longMessage', () => {
		const dateTime = 'error-longmessage-test';

		errorLogger(
			{
				errors: [
					{
						code: 'form_identifier_exists',
						message: 'Email already exists',
						longMessage:
							'A user with this email address already exists in the system.',
					},
				],
				status: '422',
				userId: 'user_abc123',
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log[0]).toEqual({
			type: 'User Creation Error',
			userId: 'user_abc123',
			status: '422',
			error: 'A user with this email address already exists in the system.',
		});
	});

	test('logs multiple errors from same payload as separate entries', () => {
		const dateTime = 'error-multiple-test';

		errorLogger(
			{
				errors: [
					{
						code: 'invalid_email',
						message: 'Invalid email',
						longMessage: 'The email address format is invalid.',
					},
					{
						code: 'invalid_password',
						message: 'Invalid password',
						longMessage: 'Password does not meet requirements.',
					},
				],
				status: '400',
				userId: 'user_xyz',
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(2);
		expect(log[0].error).toBe('The email address format is invalid.');
		expect(log[1].error).toBe('Password does not meet requirements.');
	});

	test('appends to existing log file', () => {
		const dateTime = 'error-append-test';

		// First error
		errorLogger(
			{
				errors: [{ code: 'err1', message: 'First error' }],
				status: '400',
				userId: 'user_1',
			},
			dateTime
		);

		// Second error
		errorLogger(
			{
				errors: [{ code: 'err2', message: 'Second error' }],
				status: '500',
				userId: 'user_2',
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(2);
		expect(log[0].userId).toBe('user_1');
		expect(log[1].userId).toBe('user_2');
	});

	test('handles rate limit error (429)', () => {
		const dateTime = 'error-ratelimit-test';

		errorLogger(
			{
				errors: [
					{
						code: 'rate_limit_exceeded',
						message: 'Too many requests',
						longMessage: 'Rate limit exceeded. Please try again later.',
					},
				],
				status: '429',
				userId: 'user_rate',
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log[0].status).toBe('429');
		expect(log[0].error).toBe('Rate limit exceeded. Please try again later.');
	});
});

describe('validationLogger', () => {
	beforeEach(cleanupLogs);
	afterEach(cleanupLogs);

	test('logs a validation error to migration log', () => {
		const dateTime = 'validation-basic-test';

		validationLogger(
			{
				error: 'invalid_type for required field.',
				path: ['email'],
				id: 'user_123',
				row: 5,
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			type: 'Validation Error',
			row: 5,
			id: 'user_123',
			error: 'invalid_type for required field.',
			path: ['email'],
		});
	});

	test('logs validation error with nested path', () => {
		const dateTime = 'validation-nested-test';

		validationLogger(
			{
				error: 'invalid_type for required field.',
				path: ['unsafeMetadata', 'customField'],
				id: 'user_456',
				row: 10,
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log[0].path).toEqual(['unsafeMetadata', 'customField']);
	});

	test('logs validation error with numeric path (array index)', () => {
		const dateTime = 'validation-array-test';

		validationLogger(
			{
				error: 'invalid_email for required field.',
				path: ['email', 1],
				id: 'user_789',
				row: 3,
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log[0].path).toEqual(['email', 1]);
	});

	test('appends multiple validation errors', () => {
		const dateTime = 'validation-append-test';

		validationLogger(
			{
				error: 'missing userId',
				path: ['userId'],
				id: 'unknown',
				row: 1,
			},
			dateTime
		);

		validationLogger(
			{
				error: 'invalid email format',
				path: ['email'],
				id: 'user_2',
				row: 2,
			},
			dateTime
		);

		validationLogger(
			{
				error: 'invalid passwordHasher',
				path: ['passwordHasher'],
				id: 'user_3',
				row: 3,
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(3);
		expect(log[0].row).toBe(1);
		expect(log[1].row).toBe(2);
		expect(log[2].row).toBe(3);
	});
});

describe('importLogger', () => {
	beforeEach(cleanupLogs);
	afterEach(cleanupLogs);

	test('logs a successful import', () => {
		const dateTime = 'import-success-test';

		importLogger({ userId: 'user_123', status: 'success' }, dateTime);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			userId: 'user_123',
			status: 'success',
		});
	});

	test('logs a failed import with error', () => {
		const dateTime = 'import-error-test';

		importLogger(
			{ userId: 'user_456', status: 'error', error: 'Email already exists' },
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			userId: 'user_456',
			status: 'error',
			error: 'Email already exists',
		});
	});

	test('logs multiple imports in sequence', () => {
		const dateTime = 'import-multiple-test';

		importLogger({ userId: 'user_1', status: 'success' }, dateTime);
		importLogger(
			{ userId: 'user_2', status: 'error', error: 'Invalid email' },
			dateTime
		);
		importLogger({ userId: 'user_3', status: 'success' }, dateTime);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(3);
		expect(log[0].userId).toBe('user_1');
		expect(log[0].status).toBe('success');
		expect(log[1].userId).toBe('user_2');
		expect(log[1].status).toBe('error');
		expect(log[1].error).toBe('Invalid email');
		expect(log[2].userId).toBe('user_3');
		expect(log[2].status).toBe('success');
	});
});

describe('deleteErrorLogger', () => {
	beforeEach(cleanupLogs);
	afterEach(cleanupLogs);

	test('logs a single error to user deletion log', () => {
		const dateTime = 'delete-error-single-test';

		deleteErrorLogger(
			{
				errors: [
					{
						code: 'user_not_found',
						message: 'User not found',
					},
				],
				status: 'error',
				userId: 'user_123',
			},
			dateTime
		);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			type: 'User Deletion Error',
			userId: 'user_123',
			status: 'error',
			error: undefined, // longMessage is undefined
		});
	});

	test('logs error with longMessage', () => {
		const dateTime = 'delete-error-longmessage-test';

		deleteErrorLogger(
			{
				errors: [
					{
						code: 'permission_denied',
						message: 'Permission denied',
						longMessage: 'You do not have permission to delete this user.',
					},
				],
				status: '403',
				userId: 'user_abc123',
			},
			dateTime
		);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log[0]).toEqual({
			type: 'User Deletion Error',
			userId: 'user_abc123',
			status: '403',
			error: 'You do not have permission to delete this user.',
		});
	});

	test('logs multiple errors from same payload as separate entries', () => {
		const dateTime = 'delete-error-multiple-test';

		deleteErrorLogger(
			{
				errors: [
					{
						code: 'error_1',
						message: 'First error',
						longMessage: 'The first error occurred.',
					},
					{
						code: 'error_2',
						message: 'Second error',
						longMessage: 'The second error occurred.',
					},
				],
				status: '400',
				userId: 'user_xyz',
			},
			dateTime
		);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log).toHaveLength(2);
		expect(log[0].error).toBe('The first error occurred.');
		expect(log[1].error).toBe('The second error occurred.');
	});

	test('appends to existing log file', () => {
		const dateTime = 'delete-error-append-test';

		// First error
		deleteErrorLogger(
			{
				errors: [{ code: 'err1', message: 'First error' }],
				status: '400',
				userId: 'user_1',
			},
			dateTime
		);

		// Second error
		deleteErrorLogger(
			{
				errors: [{ code: 'err2', message: 'Second error' }],
				status: '500',
				userId: 'user_2',
			},
			dateTime
		);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log).toHaveLength(2);
		expect(log[0].userId).toBe('user_1');
		expect(log[1].userId).toBe('user_2');
	});
});

describe('deleteLogger', () => {
	beforeEach(cleanupLogs);
	afterEach(cleanupLogs);

	test('logs a successful deletion', () => {
		const dateTime = 'delete-success-test';

		deleteLogger({ userId: 'user_123', status: 'success' }, dateTime);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			userId: 'user_123',
			status: 'success',
		});
	});

	test('logs a failed deletion with error', () => {
		const dateTime = 'delete-error-test';

		deleteLogger(
			{ userId: 'user_456', status: 'error', error: 'User not found' },
			dateTime
		);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log).toHaveLength(1);
		expect(log[0]).toEqual({
			userId: 'user_456',
			status: 'error',
			error: 'User not found',
		});
	});

	test('logs multiple deletions in sequence', () => {
		const dateTime = 'delete-multiple-test';

		deleteLogger({ userId: 'user_1', status: 'success' }, dateTime);
		deleteLogger(
			{ userId: 'user_2', status: 'error', error: 'Permission denied' },
			dateTime
		);
		deleteLogger({ userId: 'user_3', status: 'success' }, dateTime);

		const log = readNDJSON(`logs/user-deletion-${dateTime}.log`);
		expect(log).toHaveLength(3);
		expect(log[0].userId).toBe('user_1');
		expect(log[0].status).toBe('success');
		expect(log[1].userId).toBe('user_2');
		expect(log[1].status).toBe('error');
		expect(log[1].error).toBe('Permission denied');
		expect(log[2].userId).toBe('user_3');
		expect(log[2].status).toBe('success');
	});
});

describe('mixed logging', () => {
	beforeEach(cleanupLogs);
	afterEach(cleanupLogs);

	test('error and validation logs go to same migration log file', () => {
		const dateTime = 'mixed-errors-test';

		errorLogger(
			{
				errors: [{ code: 'err', message: 'API error' }],
				status: '500',
				userId: 'user_1',
			},
			dateTime
		);

		validationLogger(
			{
				error: 'validation failed',
				path: ['email'],
				id: 'user_2',
				row: 5,
			},
			dateTime
		);

		const log = readNDJSON(`logs/migration-${dateTime}.log`);
		expect(log).toHaveLength(2);
		expect(log[0].type).toBe('User Creation Error');
		expect(log[1].type).toBe('Validation Error');
	});

	test('error logs and import logs go to same migration log file', () => {
		const dateTime = 'mixed-combined-test';

		errorLogger(
			{
				errors: [
					{
						code: 'err',
						message: 'API error',
						longMessage: 'API error occurred',
					},
				],
				status: '500',
				userId: 'user_1',
			},
			dateTime
		);

		importLogger(
			{ userId: 'user_1', status: 'error', error: 'API error occurred' },
			dateTime
		);

		importLogger({ userId: 'user_2', status: 'success' }, dateTime);

		const migrationLog = readNDJSON(`logs/migration-${dateTime}.log`);

		expect(migrationLog).toHaveLength(3);
		expect(migrationLog[0].type).toBe('User Creation Error');
		expect(migrationLog[1].status).toBe('error');
		expect(migrationLog[2].status).toBe('success');
	});
});
