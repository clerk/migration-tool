import fs from 'fs';
import path from 'path';
import {
	ErrorLog,
	ErrorPayload,
	ImportLogEntry,
	ValidationErrorPayload,
	DeleteLogEntry,
} from './types';

/**
 * Ensures a folder exists, creating it if necessary
 * @param folderPath - The absolute path to the folder
 */
const confirmOrCreateFolder = (folderPath: string) => {
	try {
		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath);
		}
	} catch (err) {
		console.error('Error creating directory for logs:', err);
	}
};

/**
 * Gets the absolute path to the logs directory
 * @returns The absolute path to the logs folder
 */
const getLogPath = () => path.join(__dirname, '..', 'logs');

/**
 * Appends an entry to a log file using append writes (NDJSON format)
 * Uses synchronous writes to ensure immediate persistence for testing and reliability
 * @param filePath - The relative file path within the logs directory
 * @param entry - The log entry to append (will be JSON stringified)
 */
function appendToLogFile(filePath: string, entry: unknown) {
	try {
		const logPath = getLogPath();
		confirmOrCreateFolder(logPath);
		const fullPath = `${logPath}/${filePath}`;

		// Use synchronous append to ensure immediate write
		// This is more reliable for logging and testing
		fs.appendFileSync(fullPath, JSON.stringify(entry) + '\n');
	} catch (err) {
		console.error('Error writing to log file:', err);
	}
}

/**
 * No-op function for backwards compatibility.
 * Previously closed write streams, but now uses synchronous writes.
 */
export function closeAllStreams() {
	// No-op - using synchronous writes now
}

/**
 * Generic function to log error payloads with multiple errors
 * @param payload - The error payload containing user ID, status, and error details
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 * @param logFile - The log file name (e.g., 'migration' or 'user-deletion')
 * @param errorType - The error type string (e.g., 'User Creation Error')
 */
function logErrorPayload(
	payload: ErrorPayload,
	dateTime: string,
	logFile: string,
	errorType: string
) {
	for (const err of payload.errors) {
		const errorToLog: ErrorLog = {
			type: errorType,
			userId: payload.userId,
			status: payload.status,
			error: err.longMessage,
		};
		appendToLogFile(`${logFile}-${dateTime}.log`, errorToLog);
	}
}

/**
 * Generic function to log simple entries (success/error status)
 * @param entry - The log entry containing user ID and status
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 * @param logFile - The log file name (e.g., 'migration' or 'user-deletion')
 */
function logEntry(
	entry: ImportLogEntry | DeleteLogEntry,
	dateTime: string,
	logFile: string
) {
	appendToLogFile(`${logFile}-${dateTime}.log`, entry);
}

/**
 * Logs user creation errors from the Clerk API
 * @param payload - The error payload containing user ID, status, and error details
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const errorLogger = (payload: ErrorPayload, dateTime: string) => {
	logErrorPayload(payload, dateTime, 'migration', 'User Creation Error');
};

/**
 * Logs validation errors that occur during user data transformation
 * @param payload - The validation error payload containing row, ID, error message, and field path
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const validationLogger = (
	payload: ValidationErrorPayload,
	dateTime: string
) => {
	const error = {
		type: 'Validation Error',
		row: payload.row,
		id: payload.id,
		error: payload.error,
		path: payload.path,
	};
	appendToLogFile(`migration-${dateTime}.log`, error);
};

/**
 * Logs successful user imports and errors
 * @param entry - The import log entry containing user ID and timestamp
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const importLogger = (entry: ImportLogEntry, dateTime: string) => {
	logEntry(entry, dateTime, 'migration');
};

/**
 * Logs user deletion errors from the Clerk API
 * @param payload - The error payload containing user ID, status, and error details
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const deleteErrorLogger = (payload: ErrorPayload, dateTime: string) => {
	logErrorPayload(payload, dateTime, 'user-deletion', 'User Deletion Error');
};

/**
 * Logs user deletion attempts
 * @param entry - The delete log entry containing user ID and status
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const deleteLogger = (entry: DeleteLogEntry, dateTime: string) => {
	logEntry(entry, dateTime, 'user-deletion');
};
