import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import color from "picocolors";

const LOGS_DIR = path.join(process.cwd(), "logs");

/**
 * Deletes all log files from the logs directory
 *
 * Prompts the user for confirmation before deleting any files.
 * Only deletes files, not subdirectories.
 *
 * @returns A promise that resolves when the operation is complete
 */
const cleanLogs = async () => {
  p.intro(
    `${color.bgCyan(color.black("Clerk User Migration Utility - Clean Logs"))}`,
  );

  // Check if logs directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    p.outro("No logs directory found. Nothing to clean.");
    return;
  }

  // Read all files in the logs directory
  const files = fs.readdirSync(LOGS_DIR);

  if (files.length === 0) {
    p.outro("Logs directory is already empty.");
    return;
  }

  // Confirm deletion
  const shouldDelete = await p.confirm({
    message: `Delete ${files.length} log file(s)?`,
  });

  if (!shouldDelete || p.isCancel(shouldDelete)) {
    p.cancel("Operation cancelled.");
    return;
  }

  const s = p.spinner();
  s.start(`Deleting ${files.length} log file(s)`);

  let deletedCount = 0;
  let errorCount = 0;

  for (const file of files) {
    try {
      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);

      // Only delete files, not directories
      if (stats.isFile()) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    } catch (error) {
      errorCount++;
      console.error(`Failed to delete ${file}:`, error);
    }
  }

  s.stop();

  if (errorCount > 0) {
    p.outro(
      `Deleted ${deletedCount} file(s). Failed to delete ${errorCount} file(s).`,
    );
  } else {
    p.outro(`Successfully deleted ${deletedCount} log file(s).`);
  }
};

cleanLogs();
