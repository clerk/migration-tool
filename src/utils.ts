import path from "path";
import mime from "mime-types";
import fs from "fs";

/**
 * Pauses execution for a specified duration
 * @param ms - The number of milliseconds to wait
 * @returns A promise that resolves after the specified duration
 */
export async function cooldown(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Gets the current date and time in ISO format without milliseconds
 * @returns A string in the format YYYY-MM-DDTHH:mm:ss
 * @example
 * getDateTimeStamp() // "2026-01-20T14:30:45"
 */
export const getDateTimeStamp = () => {
  return new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
};

/**
 * Creates an absolute file path for import files relative to the project root
 * @param file - The relative file path (e.g., "samples/users.json")
 * @returns The absolute file path
 */
export const createImportFilePath = (file: string) => {
  return path.join(__dirname, "..", file);
};

/**
 * Checks if a file exists at the specified path
 * @param file - The relative file path to check
 * @returns True if the file exists, false otherwise
 */
export const checkIfFileExists = (file: string) => {
  if (fs.existsSync(createImportFilePath(file))) {
    return true;
  } else {
    return false;
  }
};

/**
 * Determines the MIME type of a file
 * @param file - The relative file path
 * @returns The MIME type of the file (e.g., "application/json", "text/csv") or false if unknown
 */
export const getFileType = (file: string) => {
  return mime.lookup(createImportFilePath(file));
};

/**
 * Wraps a promise to return a tuple of [data, error] instead of throwing
 * @template T - The type of the resolved promise value
 * @param promise - The promise to wrap
 * @returns A tuple containing either [data, null] on success or [null, error] on failure
 * @throws Re-throws if the error is not an instance of Error
 * @example
 * const [data, error] = await tryCatch(fetchUsers());
 * if (error) console.error(error);
 */
export const tryCatch = async <T>(
  promise: Promise<T>,
): Promise<[T, null] | [null, Error]> => {
  try {
    const data = await promise;
    return [data, null];
  } catch (throwable) {
    if (throwable instanceof Error) return [null, throwable];

    throw throwable;
  }
};
