import fs from "fs";
import csvParser from "csv-parser";
import * as p from "@clack/prompts";
import { validationLogger } from "../logger";
import { handlers } from "./handlers";
import { userSchema } from "./validators";
import { HandlerMapKeys, HandlerMapUnion, User, PASSWORD_HASHERS } from "../types";
import { createImportFilePath, getDateTimeStamp, getFileType } from "../utils";

const s = p.spinner();

/**
 * Selectively flattens nested objects based on transformer configuration
 *
 * Only flattens paths that are explicitly referenced in the transformer config.
 * This allows handlers to map nested fields (e.g., "_id.$oid" in Auth0) to
 * flat fields in the target schema.
 *
 * @param obj - The object to flatten
 * @param transformer - The transformer config mapping source paths to target fields
 * @param prefix - Internal parameter for recursive flattening (current path prefix)
 * @returns Flattened object with dot-notation keys for nested paths
 *
 * @example
 * const obj = { _id: { $oid: "123" }, email: "test@example.com" }
 * const transformer = { "_id.$oid": "userId", "email": "email" }
 * flattenObjectSelectively(obj, transformer)
 * // Returns: { "_id.$oid": "123", "email": "test@example.com" }
 */
function flattenObjectSelectively(
  obj: Record<string, unknown>,
  transformer: Record<string, string>,
  prefix = ""
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    // Check if this path (or any nested path) is in the transformer
    const hasNestedMapping = Object.keys(transformer).some(k => k.startsWith(currentPath + "."));

    if (hasNestedMapping && value && typeof value === "object" && !Array.isArray(value)) {
      // This object has nested mappings, so recursively flatten it
      Object.assign(result, flattenObjectSelectively(value as Record<string, unknown>, transformer, currentPath));
    } else {
      // Either it's not an object, or it's not mapped with nested paths - keep as-is
      result[currentPath] = value;
    }
  }

  return result;
}

/**
 * Transforms data keys from source format to Clerk's import schema
 *
 * Maps field names from the source platform (Auth0, Supabase, etc.) to
 * Clerk's expected field names using the handler's transformer configuration.
 * Flattens nested objects as needed and filters out empty values.
 *
 * @template T - The handler type being used for transformation
 * @param data - The raw user data from the source platform
 * @param keys - The handler configuration with transformer mapping
 * @returns Transformed user object with Clerk field names
 *
 * @example
 * const auth0User = { "_id": { "$oid": "123" }, "email": "test@example.com" }
 * const handler = handlers.find(h => h.key === "auth0")
 * transformKeys(auth0User, handler)
 * // Returns: { userId: "123", email: "test@example.com" }
 */
export function transformKeys<T extends HandlerMapUnion>(
  data: Record<string, unknown>,
  keys: T,
): Record<string, unknown> {
  const transformedData: Record<string, unknown> = {};
  const transformer = keys.transformer as Record<string, string>;

  // Selectively flatten the input data based on transformer config
  const flatData = flattenObjectSelectively(data, transformer);

  // Then apply transformations
  for (const [key, value] of Object.entries(flatData)) {
    if (value !== "" && value !== '"{}"' && value !== null) {
      const transformedKey = transformer[key] || key;
      transformedData[transformedKey] = value;
    }
  }

  return transformedData;
}

/**
 * Transforms and validates an array of users for import
 *
 * Processes each user through:
 * 1. Field transformation using the handler's transformer config
 * 2. Special handling for Clerk-to-Clerk migrations (email/phone array consolidation)
 * 3. Handler-specific postTransform logic (if defined)
 * 4. Schema validation
 * 5. Validation error logging for failed users
 *
 * Throws immediately if an invalid password hasher is detected.
 * Logs other validation errors and excludes invalid users from the result.
 *
 * @param users - Array of raw user data to transform
 * @param key - Handler key identifying the source platform
 * @param dateTime - Timestamp for log file naming
 * @returns Array of successfully transformed and validated users
 * @throws Error if an invalid password hasher is detected
 */
const transformUsers = (
  users: User[],
  key: HandlerMapKeys,
  dateTime: string,
) => {
  // This applies to smaller numbers. Pass in 10, get 5 back.
  const transformedData: User[] = [];
  for (let i = 0; i < users.length; i++) {
    const transformerKeys = handlers.find((obj) => obj.key === key);

    if (transformerKeys === undefined) {
      throw new Error("No transformer found for the specified key");
    }

    const transformedUser = transformKeys(users[i], transformerKeys);

    // Transform email to array for clerk handler (merges primary + verified + unverified emails)
    if (key === "clerk") {
      // Helper to parse email field - could be array (JSON) or comma-separated string (CSV)
      const parseEmails = (field: unknown): string[] => {
        if (Array.isArray(field)) return field;
        if (typeof field === "string" && field) {
          return field.split(",").map((e: string) => e.trim()).filter(Boolean);
        }
        return [];
      };

      const primaryEmail = transformedUser.email as string | undefined;
      const verifiedEmails = parseEmails(transformedUser.emailAddresses);
      const unverifiedEmails = parseEmails(transformedUser.unverifiedEmailAddresses);

      // Build email array: primary first, then verified, then unverified (deduplicated)
      const allEmails: string[] = [];
      if (primaryEmail) allEmails.push(primaryEmail);
      for (const email of [...verifiedEmails, ...unverifiedEmails]) {
        if (!allEmails.includes(email)) allEmails.push(email);
      }
      if (allEmails.length > 0) {
        transformedUser.email = allEmails;
      }

      // Helper to parse phone field - could be array (JSON) or comma-separated string (CSV)
      const parsePhones = (field: unknown): string[] => {
        if (Array.isArray(field)) return field;
        if (typeof field === "string" && field) {
          return field.split(",").map((p: string) => p.trim()).filter(Boolean);
        }
        return [];
      };

      const primaryPhone = transformedUser.phone as string | undefined;
      const verifiedPhones = parsePhones(transformedUser.phoneNumbers);
      const unverifiedPhones = parsePhones(transformedUser.unverifiedPhoneNumbers);

      // Build phone array: primary first, then verified, then unverified (deduplicated)
      const allPhones: string[] = [];
      if (primaryPhone) allPhones.push(primaryPhone);
      for (const phone of [...verifiedPhones, ...unverifiedPhones]) {
        if (!allPhones.includes(phone)) allPhones.push(phone);
      }
      if (allPhones.length > 0) {
        transformedUser.phone = allPhones;
      }
    }

    // Apply handler-specific post-transformation if defined
    if (transformerKeys && "postTransform" in transformerKeys && typeof transformerKeys.postTransform === "function") {
      transformerKeys.postTransform(transformedUser);
    }
    const validationResult = userSchema.safeParse(transformedUser);
    // Check if validation was successful
    if (validationResult.success) {
      // The data is valid according to the original schema
      const validatedData = validationResult.data;
      transformedData.push(validatedData);
    } else {
      // The data is not valid, handle errors
      const firstIssue = validationResult.error.issues[0];

      // Check if this is a password hasher validation error with an invalid value
      // Only stop immediately if there's an actual invalid value, not missing/undefined
      if (firstIssue.path.includes("passwordHasher") && transformedUser.passwordHasher) {
        const userId = transformedUser.userId as string;
        const invalidHasher = transformedUser.passwordHasher;
        s.stop("Validation Error");
        throw new Error(
          `Invalid password hasher detected.\n` +
          `User ID: ${userId}\n` +
          `Row: ${i + 1}\n` +
          `Invalid hasher: "${invalidHasher}"\n` +
          `Expected one of: ${PASSWORD_HASHERS.join(", ")}`
        );
      }

      validationLogger(
        {
          error: `${firstIssue.code} for required field.`,
          path: firstIssue.path as (string | number)[],
          id: transformedUser.userId as string,
          row: i,
        },
        dateTime,
      );
    }
  }
  return transformedData;
};

/**
 * Adds default field values from the handler configuration to all users
 *
 * Some handlers define default values that should be applied to all users.
 * For example, the Supabase handler defaults passwordHasher to "bcrypt".
 *
 * @param users - Array of user objects
 * @param key - Handler key identifying which defaults to apply
 * @returns Array of users with default fields applied (if handler has defaults)
 */
const addDefaultFields = (users: User[], key: string) => {
  const handler = handlers.find((obj) => obj.key === key);
  const defaultFields = (handler && "defaults" in handler) ? handler.defaults : null;

  if (defaultFields) {
    const updatedUsers: User[] = [];

    for (const user of users) {
      const updated = {
        ...user,
        ...defaultFields,
      };
      updatedUsers.push(updated);
    }

    return updatedUsers;
  } else {
    return users;
  }
};

/**
 * Loads, transforms, and validates users from a JSON or CSV file
 *
 * Main entry point for loading user data. Performs the following:
 * 1. Reads users from file (supports JSON and CSV)
 * 2. Applies handler default fields
 * 3. Transforms field names to Clerk schema
 * 4. Validates each user against schema
 * 5. Logs validation errors
 * 6. Returns only successfully validated users
 *
 * Displays a spinner during the loading process.
 *
 * @param file - File path to load users from (relative or absolute)
 * @param key - Handler key identifying the source platform
 * @returns Array of validated users ready for import
 * @throws Error if file cannot be read or contains invalid data
 */
export const loadUsersFromFile = async (
  file: string,
  key: HandlerMapKeys,
): Promise<User[]> => {
  const dateTime = getDateTimeStamp();
  s.start();
  s.message("Loading users and perparing to migrate");

  const type = getFileType(createImportFilePath(file));

  // convert a CSV to JSON and return array
  if (type === "text/csv") {
    const users: User[] = [];
    return new Promise((resolve, reject) => {
      fs.createReadStream(createImportFilePath(file))
        .pipe(csvParser({ skipComments: true }))
        .on("data", (data) => {
          users.push(data);
        })
        .on("error", (err) => {
          s.stop("Error loading users");
          reject(err);
        })
        .on("end", () => {
          const usersWithDefaultFields = addDefaultFields(users, key);
          const transformedData: User[] = transformUsers(
            usersWithDefaultFields,
            key,
            dateTime,
          );
          s.stop("Users Loaded");
          resolve(transformedData);
        });
    });

    // if the file is already JSON, just read and parse and return the result
  } else {
    const users: User[] = JSON.parse(
      fs.readFileSync(createImportFilePath(file), "utf-8"),
    );
    const usersWithDefaultFields = addDefaultFields(users, key);

    const transformedData: User[] = transformUsers(
      usersWithDefaultFields,
      key,
      dateTime,
    );

    s.stop("Users Loaded");
    return transformedData;
  }
};
