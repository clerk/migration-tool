import path from "path";
import mime from "mime-types";
import fs from "fs";

export async function cooldown(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export const getDateTimeStamp = () => {
  return new Date().toISOString().split(".")[0]; // YYYY-MM-DDTHH:mm:ss
};

// utility function to create file path
export const createImportFilePath = (file: string) => {
  return path.join(__dirname, "..", file);
};

// make sure the file exists. CLI will error if it doesn't
export const checkIfFileExists = (file: string) => {
  if (fs.existsSync(createImportFilePath(file))) {
    return true;
  } else {
    return false;
  }
};

// get the file type so we can verify if this is a JSON or CSV
export const getFileType = (file: string) => {
  return mime.lookup(createImportFilePath(file));
};

// awaitable wrapper that returns 'data' and 'error' 
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
