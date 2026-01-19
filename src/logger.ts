import fs from "fs";
import path from "path";
import {
  ErrorLog,
  ErrorPayload,
  ImportLogEntry,
  ValidationErrorPayload,
} from "./types";

const confirmOrCreateFolder = (folderPath: string) => {
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
    }
  } catch (err) {
    console.error("Error creating directory for logs:", err);
  }
};

const getLogPath = () => path.join(__dirname, "..", "logs");

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

export const errorLogger = (payload: ErrorPayload, dateTime: string) => {
  for (const err of payload.errors) {
    const errorToLog: ErrorLog = {
      type: "User Creation Error",
      userId: payload.userId,
      status: payload.status,
      error: err.longMessage,
    };
    appendToLogFile(`${dateTime}-errors.log`, errorToLog);
  }
};

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
  appendToLogFile(`${dateTime}-errors.log`, error);
};

export const importLogger = (entry: ImportLogEntry, dateTime: string) => {
  appendToLogFile(`${dateTime}-import.log`, entry);
};
