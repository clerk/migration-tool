import fs from "fs";
import path from "path";
import {
  ErrorLog,
  ErrorPayload,
  ImportLogEntry,
  ValidationErrorPayload,
  DeleteLogEntry,
} from "./types";

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
    console.error("Error creating directory for logs:", err);
  }
};

/**
 * Gets the absolute path to the logs directory
 * @returns The absolute path to the logs folder
 */
const getLogPath = () => path.join(__dirname, "..", "logs");

/**
 * Appends an entry to a log file, creating the file if it doesn't exist
 * @param filePath - The relative file path within the logs directory
 * @param entry - The log entry to append (will be JSON stringified)
 */
function appendToLogFile(filePath: string, entry: unknown) {
  try {
    const logPath = getLogPath();
    confirmOrCreateFolder(logPath);
    const fullPath = `${logPath}/${filePath}`;

    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, JSON.stringify([entry], null, 2));
    } else {
      const log = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      log.push(entry);
      fs.writeFileSync(fullPath, JSON.stringify(log, null, 2));
    }
  } catch (err) {
    console.error("Error writing to log file:", err);
  }
}

/**
 * Logs user creation errors from the Clerk API
 * @param payload - The error payload containing user ID, status, and error details
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const errorLogger = (payload: ErrorPayload, dateTime: string) => {
  for (const err of payload.errors) {
    const errorToLog: ErrorLog = {
      type: "User Creation Error",
      userId: payload.userId,
      status: payload.status,
      error: err.longMessage,
    };
    appendToLogFile(`${dateTime}-import-errors.log`, errorToLog);
  }
};

/**
 * Logs validation errors that occur during user data transformation
 * @param payload - The validation error payload containing row, ID, error message, and field path
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const validationLogger = (
  payload: ValidationErrorPayload,
  dateTime: string,
) => {
  const error = {
    type: "Validation Error",
    row: payload.row,
    id: payload.id,
    error: payload.error,
    path: payload.path,
  };
  appendToLogFile(`${dateTime}-import-errors.log`, error);
};

/**
 * Logs successful user imports
 * @param entry - The import log entry containing user ID and timestamp
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const importLogger = (entry: ImportLogEntry, dateTime: string) => {
  appendToLogFile(`${dateTime}-import.log`, entry);
};

/**
 * Logs user deletion errors from the Clerk API
 * @param payload - The error payload containing user ID, status, and error details
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const deleteErrorLogger = (payload: ErrorPayload, dateTime: string) => {
  for (const err of payload.errors) {
    const errorToLog: ErrorLog = {
      type: "User Deletion Error",
      userId: payload.userId,
      status: payload.status,
      error: err.longMessage,
    };
    appendToLogFile(`${dateTime}-delete-errors.log`, errorToLog);
  }
};

/**
 * Logs user deletion attempts
 * @param entry - The delete log entry containing user ID and status
 * @param dateTime - The timestamp for the log file name (format: YYYY-MM-DDTHH:mm:ss)
 */
export const deleteLogger = (entry: DeleteLogEntry, dateTime: string) => {
  appendToLogFile(`${dateTime}-delete.log`, entry);
};
