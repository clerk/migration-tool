import "dotenv/config";
import { createClerkClient, User } from "@clerk/backend";
import * as p from "@clack/prompts";
import color from "picocolors";
import { cooldown, tryCatch, getDateTimeStamp, createImportFilePath, getFileType } from "../utils";
import { env } from "../envs-constants";
import { deleteErrorLogger, deleteLogger } from "../logger";
import * as fs from "fs";
import * as path from "path";
import csvParser from "csv-parser";

const LIMIT = 500;
const users: User[] = [];
const s = p.spinner();
let total: number;
let count = 0;
let failed = 0;

/**
 * Reads the .settings file to get the migration source file path
 * @returns The file path of the migration source
 * @throws Exits the process if .settings file is not found or missing the file property
 */
export const readSettings = () => {
  const settingsPath = path.join(process.cwd(), ".settings");

  if (!fs.existsSync(settingsPath)) {
    p.log.error(
      color.red(
        "No migration has been performed yet. Unable to find .settings file with migration source."
      )
    );
    process.exit(1);
  }

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

  if (!settings.file) {
    p.log.error(
      color.red(
        "No migration source found in .settings file. Please perform a migration first."
      )
    );
    process.exit(1);
  }

  return settings.file as string;
};

/**
 * Reads a migration file and extracts user IDs
 * Supports both JSON and CSV files
 * @param filePath - The relative path to the migration file
 * @returns A Promise that resolves to a Set of user IDs from the migration file
 * @throws Exits the process if the migration file is not found
 */
export const readMigrationFile = async (filePath: string): Promise<Set<string>> => {
  const fullPath = createImportFilePath(filePath);

  if (!fs.existsSync(fullPath)) {
    p.log.error(
      color.red(
        `Migration file not found at: ${fullPath}`
      )
    );
    process.exit(1);
  }

  const type = getFileType(fullPath);
  const userIds = new Set<string>();

  // Handle CSV files
  if (type === "text/csv") {
    return new Promise((resolve, reject) => {
      fs.createReadStream(fullPath)
        .pipe(csvParser({ skipComments: true }))
        .on("data", (data) => {
          // CSV files have 'id' column for user IDs
          if (data.id) {
            userIds.add(data.id);
          }
        })
        .on("error", (err) => {
          p.log.error(color.red(`Error reading CSV file: ${err.message}`));
          reject(err);
        })
        .on("end", () => {
          resolve(userIds);
        });
    });
  }

  // Handle JSON files
  const fileContent = fs.readFileSync(fullPath, "utf-8");
  const users = JSON.parse(fileContent);

  // Extract user IDs from the migration file
  for (const user of users) {
    // JSON files have 'userId' property
    if (user.userId) {
      userIds.add(user.userId);
    }
    // Also check for 'id' property as fallback
    else if (user.id) {
      userIds.add(user.id);
    }
  }

  return userIds;
};

/**
 * Recursively fetches all users from Clerk, paginating through results
 * @param offset - The offset for pagination (starts at 0)
 * @returns An array of all Clerk users
 */
export const fetchUsers = async (offset: number) => {
  // Clear the users array on the initial call (offset 0)
  if (offset === 0) {
    users.length = 0;
  }

  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  const { data } = await clerk.users.getUserList({ offset, limit: LIMIT });

  if (data.length > 0) {
    for (const user of data) {
      users.push(user);
    }
  }

  if (data.length === LIMIT) {
    await cooldown(env.DELAY);
    return fetchUsers(offset + LIMIT);
  }

  return users;
};

/**
 * Finds the intersection of Clerk users and migration file users
 *
 * Matches Clerk users whose externalId matches a userId in the migration file.
 * This identifies which migrated users exist in Clerk.
 *
 * @param clerkUsers - Array of users fetched from Clerk
 * @param migrationUserIds - Set of user IDs from the migration file
 * @returns Array of Clerk users that were part of the migration
 */
export const findIntersection = (clerkUsers: User[], migrationUserIds: Set<string>) => {
  return clerkUsers.filter(user => {
    // Match Clerk user's externalId with migration file's userId
    return user.externalId && migrationUserIds.has(user.externalId);
  });
};

// Track error messages and counts
const errorCounts = new Map<string, number>();

/**
 * Deletes an array of users from Clerk
 *
 * Deletes users sequentially with rate limiting between each deletion.
 * Updates a spinner progress message after each deletion.
 * Logs any errors that occur during deletion.
 *
 * @param users - Array of Clerk users to delete
 * @param dateTime - Timestamp for error logging
 * @returns A promise that resolves when all users are processed
 */
export const deleteUsers = async (users: User[], dateTime: string) => {
  // Reset error counts
  errorCounts.clear();

  s.message(`Deleting users: [0/${total}]`);
  for (const user of users) {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    const [, error] = await tryCatch(clerk.users.deleteUser(user.id));

    if (error) {
      failed++;
      const errorMessage = error.message || "Unknown error";
      errorCounts.set(errorMessage, (errorCounts.get(errorMessage) ?? 0) + 1);

      // Log to error log file
      deleteErrorLogger(
        {
          userId: user.externalId || user.id,
          status: "error",
          errors: [{ message: error.message, longMessage: error.message }]
        },
        dateTime,
      );

      // Log to delete log file
      deleteLogger(
        { userId: user.externalId || user.id, status: "error", error: errorMessage },
        dateTime,
      );
    } else {
      count++;

      // Log successful deletion
      deleteLogger(
        { userId: user.externalId || user.id, status: "success" },
        dateTime,
      );
    }

    const processed = count + failed;
    s.message(`Deleting users: [${processed}/${total}] (${count} successful, ${failed} failed)`);
    await cooldown(env.DELAY);
  }

  const summaryMessage = failed > 0
    ? `Deleted ${count} users (${failed} failed)`
    : `Deleted ${count} users`;
  s.stop(summaryMessage);
};

/**
 * Displays a formatted summary of the deletion operation
 *
 * Shows:
 * - Total users processed
 * - Successful deletions
 * - Failed deletions
 * - Breakdown of errors by type (wrapped to 75 characters)
 */
const displaySummary = () => {
  if (failed === 0) {
    // No summary needed if all succeeded
    return;
  }

  let message = `Total users processed: ${total}\n`;
  message += `${color.green("Successfully deleted:")} ${count}\n`;
  message += `${color.red("Failed with errors:")} ${failed}`;

  if (errorCounts.size > 0) {
    message += `\n\n${color.bold("Error Breakdown:")}\n`;
    for (const [error, errorCount] of errorCounts) {
      const prefix = `${color.red("•")} ${errorCount} user${errorCount === 1 ? "" : "s"}: `;
      message += `${prefix}${error}\n`;
    }
  }

  p.note(message.trim(), "Deletion Summary");
};

/**
 * Main function to process and delete migrated users
 *
 * Workflow:
 * 1. Reads the migration source file from .settings
 * 2. Extracts user IDs from the migration file
 * 3. Fetches all users from Clerk
 * 4. Finds the intersection (migrated users that exist in Clerk)
 * 5. Deletes the intersecting users
 *
 * @returns A promise that resolves when the deletion process is complete
 */
export const processUsers = async () => {
  p.intro(
    `${color.bgCyan(color.black("Clerk User Migration Utility - Deleting Migrated Users"))}`,
  );

  // Read settings and migration file
  const migrationFilePath = readSettings();
  s.start();
  s.message("Reading migration file");
  const migrationUserIds = await readMigrationFile(migrationFilePath);
  s.stop(`Found ${migrationUserIds.size} users in migration file`);

  // Fetch Clerk users
  s.start();
  s.message("Fetching current user list from Clerk");
  const allClerkUsers = await fetchUsers(0);
  s.stop(`Found ${allClerkUsers.length} users in Clerk`);

  // Find intersection
  s.start();
  s.message("Finding users to delete (intersection of migrated users and Clerk users)");
  const usersToDelete = findIntersection(allClerkUsers, migrationUserIds);
  total = usersToDelete.length;
  s.stop(`Found ${total} migrated users to delete`);

  if (total === 0) {
    p.log.info(color.yellow("No migrated users found in Clerk. Nothing to delete."));
    p.outro("User deletion complete");
    return;
  }

  // Delete users
  const dateTime = getDateTimeStamp();
  s.start();
  await deleteUsers(usersToDelete, dateTime);

  // Display summary if there were errors
  displaySummary();

  p.outro("User deletion complete");
};

processUsers().catch((error) => {
  console.error("\n");
  p.log.error(color.red("Error during user deletion:"));
  p.log.error(color.red(error.message));
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
