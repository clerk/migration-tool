import fs from "fs";
import csvParser from "csv-parser";
import * as p from "@clack/prompts";
import { validationLogger } from "./logger";
import { handlers } from "./handlers";
import { userSchema } from "./validators";
import { HandlerMapKeys, HandlerMapUnion, User, PASSWORD_HASHERS } from "./types";
import { createImportFilePath, getDateTimeStamp, getFileType } from "./utils";

const s = p.spinner();

// transform incoming data datas to match default schema
export function transformKeys<T extends HandlerMapUnion>(
  data: Record<string, unknown>,
  keys: T,
): Record<string, unknown> {
  const transformedData: Record<string, unknown> = {};
  const transformer = keys.transformer as Record<string, string>;
  for (const [key, value] of Object.entries(data)) {
    if (value !== "" && value !== '"{}"' && value !== null) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        let transformedKey = key;
        if (transformer[key]) transformedKey = transformer[key];

        transformedData[transformedKey] = data[key];
      }
    }
  }
  return transformedData;
}

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
