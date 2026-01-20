import * as p from "@clack/prompts";
import color from "picocolors";
import fs from "fs";
import path from "path";
import csvParser from "csv-parser";
import { handlers } from "./handlers";
import { checkIfFileExists, getFileType, createImportFilePath } from "./utils";
import { env } from "./envs-constants";

const SETTINGS_FILE = ".settings";

type Settings = {
  key?: string;
  file?: string;
  offset?: string;
};

const DEV_USER_LIMIT = 500;

const detectInstanceType = (): "dev" | "prod" => {
  const secretKey = env.CLERK_SECRET_KEY;
  if (secretKey.startsWith("sk_test_")) {
    return "dev";
  }
  return "prod";
};

// Fields to analyze for the import (non-identifier fields)
const ANALYZED_FIELDS = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "password", label: "Password" },
  { key: "totpSecret", label: "TOTP Secret" },
];

type IdentifierCounts = {
  verifiedEmails: number;
  unverifiedEmails: number;
  verifiedPhones: number;
  unverifiedPhones: number;
  username: number;
  hasAnyIdentifier: number;
};

type FieldAnalysis = {
  presentOnAll: string[];
  presentOnSome: string[];
  identifiers: IdentifierCounts;
  totalUsers: number;
};

const loadSettings = (): Settings => {
  try {
    const settingsPath = path.join(process.cwd(), SETTINGS_FILE);
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // If settings file is corrupted or unreadable, return empty settings
  }
  return {};
};

const saveSettings = (settings: Settings): void => {
  try {
    const settingsPath = path.join(process.cwd(), SETTINGS_FILE);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch {
    // Silently fail if we can't write settings
  }
};

const loadRawUsers = async (file: string, handlerKey: string): Promise<Record<string, unknown>[]> => {
  const filePath = createImportFilePath(file);
  const type = getFileType(filePath);
  const handler = handlers.find((h) => h.key === handlerKey);

  if (!handler) {
    throw new Error(`Handler not found for key: ${handlerKey}`);
  }

  // Helper to transform keys using handler
  const transformKeys = (data: Record<string, unknown>): Record<string, unknown> => {
    const transformed: Record<string, unknown> = {};
    const transformer = handler.transformer as Record<string, string>;
    for (const [key, value] of Object.entries(data)) {
      if (value !== "" && value !== '"{}"' && value !== null) {
        const transformedKey = transformer[key] || key;
        transformed[transformedKey] = value;
      }
    }
    return transformed;
  };

  if (type === "text/csv") {
    return new Promise((resolve, reject) => {
      const users: Record<string, unknown>[] = [];
      fs.createReadStream(filePath)
        .pipe(csvParser({ skipComments: true }))
        .on("data", (data) => users.push(transformKeys(data)))
        .on("error", (err) => reject(err))
        .on("end", () => resolve(users));
    });
  } else {
    const rawUsers = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return rawUsers.map(transformKeys);
  }
};

const hasValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const analyzeFields = (users: Record<string, unknown>[]): FieldAnalysis => {
  const totalUsers = users.length;

  if (totalUsers === 0) {
    return {
      presentOnAll: [],
      presentOnSome: [],
      identifiers: {
        verifiedEmails: 0,
        unverifiedEmails: 0,
        verifiedPhones: 0,
        unverifiedPhones: 0,
        username: 0,
        hasAnyIdentifier: 0,
      },
      totalUsers: 0,
    };
  }

  const fieldCounts: Record<string, number> = {};
  const identifiers: IdentifierCounts = {
    verifiedEmails: 0,
    unverifiedEmails: 0,
    verifiedPhones: 0,
    unverifiedPhones: 0,
    username: 0,
    hasAnyIdentifier: 0,
  };

  // Count how many users have each field
  for (const user of users) {
    // Count non-identifier fields
    for (const field of ANALYZED_FIELDS) {
      if (hasValue(user[field.key])) {
        fieldCounts[field.key] = (fieldCounts[field.key] || 0) + 1;
      }
    }

    // Count consolidated identifier fields
    const hasVerifiedEmail = hasValue(user.email) || hasValue(user.emailAddresses);
    const hasUnverifiedEmail = hasValue(user.unverifiedEmailAddresses);
    const hasVerifiedPhone = hasValue(user.phone) || hasValue(user.phoneNumbers);
    const hasUnverifiedPhone = hasValue(user.unverifiedPhoneNumbers);
    const hasUsername = hasValue(user.username);

    if (hasVerifiedEmail) identifiers.verifiedEmails++;
    if (hasUnverifiedEmail) identifiers.unverifiedEmails++;
    if (hasVerifiedPhone) identifiers.verifiedPhones++;
    if (hasUnverifiedPhone) identifiers.unverifiedPhones++;
    if (hasUsername) identifiers.username++;

    // Check if user has at least one valid identifier
    if (hasVerifiedEmail || hasVerifiedPhone || hasUsername) {
      identifiers.hasAnyIdentifier++;
    }
  }

  const presentOnAll: string[] = [];
  const presentOnSome: string[] = [];

  for (const field of ANALYZED_FIELDS) {
    const count = fieldCounts[field.key] || 0;
    if (count === totalUsers) {
      presentOnAll.push(field.label);
    } else if (count > 0) {
      presentOnSome.push(field.label);
    }
  }

  return { presentOnAll, presentOnSome, identifiers, totalUsers };
};

const formatCount = (count: number, total: number, label: string): string => {
  if (count === total) {
    return `All users have ${label}`;
  } else if (count === 0) {
    return `No users have ${label}`;
  } else {
    return `${count} of ${total} users have ${label}`;
  }
};

const displayIdentifierAnalysis = (analysis: FieldAnalysis): void => {
  const { identifiers, totalUsers } = analysis;

  let identifierMessage = "";

  // Show counts for each identifier type
  identifierMessage += color.bold("Identifier Analysis:\n");
  identifierMessage += `  ${identifiers.verifiedEmails === totalUsers ? color.green("●") : identifiers.verifiedEmails > 0 ? color.yellow("○") : color.red("○")} ${formatCount(identifiers.verifiedEmails, totalUsers, "verified emails")}\n`;
  identifierMessage += `  ${identifiers.verifiedPhones === totalUsers ? color.green("●") : identifiers.verifiedPhones > 0 ? color.yellow("○") : color.red("○")} ${formatCount(identifiers.verifiedPhones, totalUsers, "verified phone numbers")}\n`;
  identifierMessage += `  ${identifiers.username === totalUsers ? color.green("●") : identifiers.username > 0 ? color.yellow("○") : color.red("○")} ${formatCount(identifiers.username, totalUsers, "a username")}\n`;

  // Show unverified counts if present
  if (identifiers.unverifiedEmails > 0) {
    identifierMessage += `  ${color.dim("○")} ${formatCount(identifiers.unverifiedEmails, totalUsers, "unverified emails")}\n`;
  }
  if (identifiers.unverifiedPhones > 0) {
    identifierMessage += `  ${color.dim("○")} ${formatCount(identifiers.unverifiedPhones, totalUsers, "unverified phone numbers")}\n`;
  }

  // Check if all users have at least one identifier
  identifierMessage += "\n";
  if (identifiers.hasAnyIdentifier === totalUsers) {
    identifierMessage += color.green("All users have at least one identifier (verified email, verified phone, or username).\n");
  } else {
    const missing = totalUsers - identifiers.hasAnyIdentifier;
    identifierMessage += color.red(`${missing} user${missing === 1 ? " does" : "s do"} not have a verified email, verified phone, or username.\n`);
    identifierMessage += color.red("These users cannot be imported.\n");
  }

  // Dashboard configuration advice
  identifierMessage += "\n";
  identifierMessage += color.bold("Dashboard Configuration:\n");

  const requiredIdentifiers: string[] = [];
  const optionalIdentifiers: string[] = [];

  if (identifiers.verifiedEmails === totalUsers) {
    requiredIdentifiers.push("email");
  } else if (identifiers.verifiedEmails > 0) {
    optionalIdentifiers.push("email");
  }

  if (identifiers.verifiedPhones === totalUsers) {
    requiredIdentifiers.push("phone");
  } else if (identifiers.verifiedPhones > 0) {
    optionalIdentifiers.push("phone");
  }

  if (identifiers.username === totalUsers) {
    requiredIdentifiers.push("username");
  } else if (identifiers.username > 0) {
    optionalIdentifiers.push("username");
  }

  if (requiredIdentifiers.length > 0) {
    identifierMessage += `  ${color.green("●")} Enable and ${color.bold("require")} ${requiredIdentifiers.join(", ")} in the Dashboard\n`;
  }
  if (optionalIdentifiers.length > 0) {
    identifierMessage += `  ${color.yellow("○")} Enable ${optionalIdentifiers.join(", ")} in the Dashboard (do not require)\n`;
  }

  p.note(identifierMessage.trim(), "Identifiers");
};

const displayOtherFieldsAnalysis = (analysis: FieldAnalysis): boolean => {
  let fieldsMessage = "";

  if (analysis.presentOnAll.length > 0) {
    fieldsMessage += color.bold("Fields present on ALL users:\n");
    fieldsMessage += color.dim("These fields must be enabled in the Clerk Dashboard and could be set as required.");
    for (const field of analysis.presentOnAll) {
      fieldsMessage += `\n  ${color.green("●")} ${color.reset(field)}`;
    }
  }

  if (analysis.presentOnSome.length > 0) {
    if (fieldsMessage) fieldsMessage += "\n\n";
    fieldsMessage += color.bold("Fields present on SOME users:\n");
    fieldsMessage += color.dim("These fields must be enabled in the Clerk Dashboard but must be set as optional.");
    for (const field of analysis.presentOnSome) {
      fieldsMessage += `\n  ${color.yellow("○")} ${color.reset(field)}`;
    }
  }

  // Add note about passwords
  const hasPasswordField = analysis.presentOnAll.includes("Password") || analysis.presentOnSome.includes("Password");
  if (hasPasswordField) {
    fieldsMessage += "\n";
    fieldsMessage += color.dim("Note: Passwords can be optional even if not present on all users.\n");
    fieldsMessage += color.dim("The script will use skipPasswordRequirement for users without passwords.\n");
  }

  if (fieldsMessage) {
    p.note(fieldsMessage.trim(), "Other Fields");
    return true;
  }

  return false;
};

export const runCLI = async () => {
  p.intro(`${color.bgCyan(color.black("Clerk User Migration Utility"))}`);

  // Load previous settings to use as defaults
  const savedSettings = loadSettings();

  // Step 1: Gather initial inputs
  const initialArgs = await p.group(
    {
      key: () =>
        p.select({
          message: "What platform are you migrating your users from?",
          initialValue: savedSettings.key || handlers[0].value,
          maxItems: 1,
          options: handlers,
        }),
      file: () =>
        p.text({
          message: "Specify the file to use for importing your users",
          initialValue: savedSettings.file || "users.json",
          placeholder: savedSettings.file || "users.json",
          validate: (value) => {
            if (!checkIfFileExists(value)) {
              return "That file does not exist. Please try again";
            }
            if (
              getFileType(value) !== "text/csv" &&
              getFileType(value) !== "application/json"
            ) {
              return "Please supply a valid JSON or CSV file";
            }
          },
        }),
      offset: () =>
        p.text({
          message: "Specify an offset to begin importing from.",
          initialValue: savedSettings.offset || "0",
          defaultValue: savedSettings.offset || "0",
          placeholder: savedSettings.offset || "0",
        }),
    },
    {
      onCancel: () => {
        p.cancel("Migration cancelled.");
        process.exit(0);
      },
    },
  );

  // Step 2: Analyze the file and display field information
  const spinner = p.spinner();
  spinner.start("Analyzing import file...");

  let analysis: FieldAnalysis;
  let userCount: number;
  try {
    const users = await loadRawUsers(initialArgs.file, initialArgs.key);
    userCount = users.length;
    spinner.stop(`Found ${userCount} users in file`);

    analysis = analyzeFields(users);
  } catch (error) {
    spinner.stop("Error analyzing file");
    p.cancel("Failed to analyze import file. Please check the file format.");
    process.exit(1);
  }

  // Step 3: Check instance type and validate
  const instanceType = detectInstanceType();

  if (instanceType === "dev") {
    p.log.info(`${color.cyan("Development")} instance detected (based on CLERK_SECRET_KEY)`);

    if (userCount > DEV_USER_LIMIT) {
      p.cancel(
        `Cannot import ${userCount} users to a development instance. ` +
        `Development instances are limited to ${DEV_USER_LIMIT} users.`
      );
      process.exit(1);
    }
  } else {
    p.log.warn(`${color.yellow("Production")} instance detected (based on CLERK_SECRET_KEY)`);
    p.log.warn(color.yellow(`You are about to import ${userCount} users to your production instance.`));

    const confirmProduction = await p.confirm({
      message: "Are you sure you want to import users to production?",
      initialValue: false,
    });

    if (p.isCancel(confirmProduction) || !confirmProduction) {
      p.cancel("Migration cancelled.");
      process.exit(0);
    }
  }

  // Step 4: Display and confirm identifier settings
  displayIdentifierAnalysis(analysis);

  // Exit if no users have valid identifiers
  if (analysis.identifiers.hasAnyIdentifier === 0) {
    p.cancel("No users can be imported. All users are missing a valid identifier (verified email, verified phone, or username).");
    process.exit(1);
  }

  const confirmIdentifiers = await p.confirm({
    message: "Have you configured the identifier settings in the Dashboard?",
    initialValue: true,
  });

  if (p.isCancel(confirmIdentifiers) || !confirmIdentifiers) {
    p.cancel("Migration cancelled. Please configure identifier settings and try again.");
    process.exit(0);
  }

  // Step 5: Display and confirm other field settings (if any)
  const hasOtherFields = displayOtherFieldsAnalysis(analysis);

  if (hasOtherFields) {
    const confirmFields = await p.confirm({
      message: "Have you configured the field settings in the Dashboard?",
      initialValue: true,
    });

    if (p.isCancel(confirmFields) || !confirmFields) {
      p.cancel("Migration cancelled. Please configure field settings and try again.");
      process.exit(0);
    }
  }

  // Step 6: Final confirmation
  const beginMigration = await p.confirm({
    message: "Begin Migration?",
    initialValue: true,
  });

  if (p.isCancel(beginMigration) || !beginMigration) {
    p.cancel("Migration cancelled.");
    process.exit(0);
  }

  // Save settings for next run (not including instance - always auto-detected)
  saveSettings({
    key: initialArgs.key,
    file: initialArgs.file,
    offset: initialArgs.offset,
  });

  return { ...initialArgs, instance: instanceType, begin: beginMigration };
};
