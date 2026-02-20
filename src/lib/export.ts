/**
 * Shared utilities for export modules
 *
 * Provides common functionality used across all platform-specific exports:
 * - Coverage icon display
 * - File writing
 * - Field coverage summary display
 * - Database connection error hints
 */
import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

/**
 * Returns a colored circle icon based on how many users have a given field.
 *
 * - green filled circle — all users have this field
 * - yellow open circle — some users have this field
 * - dim open circle — no users have this field
 *
 * @param count - Number of users that have the field
 * @param total - Total number of users
 * @returns Colored icon string
 */
export function getCoverageIcon(count: number, total: number): string {
	if (count === total) return color.green('●');
	if (count > 0) return color.yellow('○');
	return color.dim('○');
}

/**
 * Writes exported data to a JSON file in the exports/ directory.
 *
 * Creates the exports/ directory if it doesn't exist. Handles both
 * absolute and relative file paths — relative paths are resolved
 * inside the exports/ directory.
 *
 * @param data - Array of user data to write
 * @param outputFile - Output file path (absolute or relative to exports/)
 * @returns The resolved absolute output path
 */
export function writeExportOutput(data: unknown[], outputFile: string): string {
	const exportsDir = path.join(process.cwd(), 'exports');
	fs.mkdirSync(exportsDir, { recursive: true });

	const outputPath = path.isAbsolute(outputFile)
		? outputFile
		: path.join(exportsDir, outputFile);

	fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

	return outputPath;
}

/**
 * Displays a field coverage summary using @clack/prompts.
 *
 * Shows each field with a colored icon indicating coverage level,
 * followed by a success message with the output path.
 *
 * @param fields - Array of field labels and their counts
 * @param userCount - Total number of exported users
 * @param outputPath - Path where the export file was written
 */
export function displayFieldCoverage(
	fields: { label: string; count: number }[],
	userCount: number,
	outputPath: string
): void {
	const summary = fields
		.map(
			({ label, count }) =>
				`${getCoverageIcon(count, userCount)} ${color.dim(`${count}/${userCount} ${label}`)}`
		)
		.join('\n');

	p.note(summary, 'Field Coverage');
	p.log.success(
		`Exported ${color.bold(String(userCount))} users to ${color.dim(outputPath)}`
	);
}

/**
 * Returns a human-readable hint for common database connection errors.
 *
 * Checks the error message for known patterns (DNS resolution, timeout,
 * network unreachable, authentication) and returns platform-appropriate
 * guidance.
 *
 * @param message - The error message from the connection attempt
 * @param platform - Optional platform name for tailored hints ('supabase' | 'betterauth')
 * @returns A hint string to help the user resolve the connection issue
 */
export function getDbConnectionErrorHint(
	message: string,
	platform?: 'supabase' | 'betterauth' | 'authjs'
): string {
	if (message.includes('ENOTFOUND')) {
		if (platform === 'supabase') {
			return 'The hostname could not be resolved. Check the project ref in your connection string.';
		}
		return 'The hostname could not be resolved. Check the host in your connection string.';
	}

	if (message.includes('ETIMEDOUT') || message.includes('ENETUNREACH')) {
		if (platform === 'supabase') {
			return (
				'Direct connections require the IPv4 add-on. Use a pooler connection instead,\n' +
				'or enable IPv4 in Supabase Dashboard → Settings → Add-Ons.'
			);
		}
		return 'The database server is unreachable. Check the host and port in your connection string.';
	}

	if (
		message.includes('authentication failed') ||
		message.includes('password')
	) {
		return 'Check the password in your connection string.';
	}

	if (platform === 'supabase') {
		return 'Verify your connection string and ensure your Supabase project is accessible.';
	}
	return 'Verify your connection string and ensure the database is accessible.';
}
