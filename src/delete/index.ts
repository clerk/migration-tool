import "dotenv/config";
import { createClerkClient, User } from "@clerk/backend";
import * as p from "@clack/prompts";
import color from "picocolors";
import { cooldown, tryCatch, getDateTimeStamp } from "../utils";
import { env } from "../envs-constants";
import { errorLogger } from "../logger";
import * as fs from "fs";
import * as path from "path";

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
 * @param filePath - The relative path to the migration file
 * @returns A Set of user IDs from the migration file
 * @throws Exits the process if the migration file is not found
 */
export const readMigrationFile = (filePath: string) => {
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    p.log.error(
      color.red(
        `Migration file not found at: ${fullPath}`
      )
    );
    process.exit(1);
  }

  const fileContent = fs.readFileSync(fullPath, "utf-8");
  const users = JSON.parse(fileContent);

  // Extract user IDs from the migration file
  const userIds = new Set<string>();
  for (const user of users) {
    if (user.userId) {
      userIds.add(user.userId);
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
  s.message(`Deleting users: [0/${total}]`);
  for (const user of users) {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    const [, error] = await tryCatch(clerk.users.deleteUser(user.id));

    if (error) {
      failed++;
      // Log the error
      errorLogger(
        {
          userId: user.externalId || user.id,
          status: "error",
          errors: [{ message: error.message, longMessage: error.message }]
        },
        dateTime,
      );
    } else {
      count++;
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
  const migrationUserIds = readMigrationFile(migrationFilePath);
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

  p.outro("User deletion complete");
};

processUsers();
