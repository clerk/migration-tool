import { createClerkClient } from "@clerk/backend";
import { ClerkAPIError } from "@clerk/types";
import { env } from "./envs-constants";
import * as p from "@clack/prompts";
import color from "picocolors";
import { errorLogger, importLogger } from "./logger";
import { cooldown, getDateTimeStamp } from "./utils";
import { userSchema } from "./validators";
import { ImportSummary, User } from "./types";

const s = p.spinner();
let processed = 0;
let successful = 0;
let failed = 0;
const errorCounts = new Map<string, number>();

const createUser = async (userData: User) => {
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

  // Extract primary email and additional emails
  const emails = userData.email
    ? (Array.isArray(userData.email) ? userData.email : [userData.email])
    : [];
  const primaryEmail = emails[0];
  const additionalEmails = emails.slice(1);

  // Extract primary phone and additional phones
  const phones = userData.phone
    ? (Array.isArray(userData.phone) ? userData.phone : [userData.phone])
    : [];
  const primaryPhone = phones[0];
  const additionalPhones = phones.slice(1);

  // Build user params dynamically based on available fields
  // Using Record type to allow dynamic property assignment for password hashing params
  const userParams: Record<string, unknown> = {
    externalId: userData.userId,
  };

  // Add email if present
  if (primaryEmail) userParams.emailAddress = [primaryEmail];

  // Add optional fields only if they have values
  if (userData.firstName) userParams.firstName = userData.firstName;
  if (userData.lastName) userParams.lastName = userData.lastName;
  if (userData.username) userParams.username = userData.username;
  if (primaryPhone) userParams.phoneNumber = [primaryPhone];
  if (userData.totpSecret) userParams.totpSecret = userData.totpSecret;
  if (userData.unsafeMetadata) userParams.unsafeMetadata = userData.unsafeMetadata;
  if (userData.privateMetadata) userParams.privateMetadata = userData.privateMetadata;
  if (userData.publicMetadata) userParams.publicMetadata = userData.publicMetadata;

  // Handle password - if present, include digest and hasher; otherwise skip password requirement
  if (userData.password && userData.passwordHasher) {
    userParams.passwordDigest = userData.password;
    userParams.passwordHasher = userData.passwordHasher;
  } else {
    userParams.skipPasswordRequirement = true;
  }

  // Create the user with the primary email
  const createdUser = await clerk.users.createUser(
    userParams as Parameters<typeof clerk.users.createUser>[0]
  );

  // Add additional emails to the created user
  for (const email of additionalEmails) {
    if (email) {
      await clerk.emailAddresses.createEmailAddress({
        userId: createdUser.id,
        emailAddress: email,
        primary: false,
      });
    }
  }

  // Add additional phones to the created user
  for (const phone of additionalPhones) {
    if (phone) {
      await clerk.phoneNumbers.createPhoneNumber({
        userId: createdUser.id,
        phoneNumber: phone,
        primary: false,
      });
    }
  }

  return createdUser;
};

async function processUserToClerk(
  userData: User,
  total: number,
  dateTime: string,
) {
  try {
    const parsedUserData = userSchema.safeParse(userData);
    if (!parsedUserData.success) {
      throw parsedUserData.error;
    }
    await createUser(parsedUserData.data);
    successful++;
    processed++;
    s.message(`Migrating users: [${processed}/${total}]`);

    // Log successful import
    importLogger(
      { userId: userData.userId, status: "success" },
      dateTime,
    );
  } catch (error: unknown) {
    // Keep cooldown in case rate limit is reached as a fallback if the thread blocking fails
    const clerkError = error as { status?: number; errors?: ClerkAPIError[] };
    if (clerkError.status === 429) {
      await cooldown(env.RETRY_DELAY_MS);
      return processUserToClerk(userData, total, dateTime);
    }

    // Track error for summary
    failed++;
    processed++;
    s.message(`Migrating users: [${processed}/${total}]`);

    const errorMessage = clerkError.errors?.[0]?.longMessage ?? clerkError.errors?.[0]?.message ?? "Unknown error";
    errorCounts.set(errorMessage, (errorCounts.get(errorMessage) ?? 0) + 1);

    // Log to error log file
    errorLogger(
      { userId: userData.userId, status: String(clerkError.status ?? "unknown"), errors: clerkError.errors ?? [] },
      dateTime,
    );

    // Log to import log file
    importLogger(
      { userId: userData.userId, status: "error", error: errorMessage },
      dateTime,
    );
  }
}

const displaySummary = (summary: ImportSummary) => {
  let message = color.bold("Migration Summary\n\n");
  message += `  Total users processed: ${summary.totalProcessed}\n`;
  message += `  ${color.green("Successfully imported:")} ${summary.successful}\n`;
  message += `  ${color.red("Failed with errors:")} ${summary.failed}\n`;

  if (summary.errorBreakdown.size > 0) {
    message += `\n${color.bold("Error Breakdown:")}\n`;
    for (const [error, count] of summary.errorBreakdown) {
      message += `  ${color.red("•")} ${count} user${count === 1 ? "" : "s"}: ${error}\n`;
    }
  }

  p.note(message.trim(), "Complete");
};

export const importUsers = async (users: User[]) => {
  const dateTime = getDateTimeStamp();

  // Reset counters for each import run
  processed = 0;
  successful = 0;
  failed = 0;
  errorCounts.clear();

  s.start();
  const total = users.length;
  s.message(`Migrating users: [0/${total}]`);

  for (const user of users) {
    await processUserToClerk(user, total, dateTime);
    await cooldown(env.DELAY);
  }
  s.stop();

  // Display summary
  const summary: ImportSummary = {
    totalProcessed: total,
    successful: successful,
    failed: failed,
    errorBreakdown: errorCounts,
  };
  displaySummary(summary);
};
