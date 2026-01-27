import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';

const LOGS_DIR = path.join(process.cwd(), 'logs');

/**
 * Reads an NDJSON file and returns an array of parsed JSON objects
 * @param filePath - Path to the NDJSON file
 * @returns Array of parsed JSON objects
 */
function readNDJSON(filePath: string): unknown[] {
	const content = fs.readFileSync(filePath, 'utf8');
	return content
		.trim()
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

/**
 * Converts an NDJSON log file to a JSON array file
 * @param sourceFile - Name of the source NDJSON file
 * @param outputFile - Name of the output JSON file
 * @returns Number of entries converted
 */
function convertLogFile(sourceFile: string, outputFile: string): number {
	const sourcePath = path.join(LOGS_DIR, sourceFile);
	const outputPath = path.join(LOGS_DIR, outputFile);

	const entries = readNDJSON(sourcePath);
	fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2));

	return entries.length;
}

/**
 * Converts NDJSON log files to JSON array format
 *
 * Prompts the user to select which log files to convert.
 * Creates new files with the same name but .json extension.
 *
 * @returns A promise that resolves when the operation is complete
 */
const convertLogs = async () => {
	p.intro(
		`${color.bgCyan(color.black('Clerk User Migration Utility - Convert Logs'))}`
	);

	// Check if logs directory exists
	if (!fs.existsSync(LOGS_DIR)) {
		p.outro('No logs directory found. Nothing to convert.');
		return;
	}

	// Read all .log files in the logs directory
	const files = fs
		.readdirSync(LOGS_DIR)
		.filter((file) => file.endsWith('.log'));

	if (files.length === 0) {
		p.outro('No log files found in the logs directory.');
		return;
	}

	// Let user select which files to convert
	const selectedFiles = await p.multiselect<
		{ value: string; label: string }[],
		string
	>({
		message: 'Select log files to convert to JSON arrays:',
		options: files.map((file) => ({
			value: file,
			label: file,
		})),
		required: true,
	});

	if (p.isCancel(selectedFiles)) {
		p.cancel('Operation cancelled.');
		return;
	}

	if (selectedFiles.length === 0) {
		p.outro('No files selected.');
		return;
	}

	const s = p.spinner();
	s.start(`Converting ${selectedFiles.length} file(s)`);

	let convertedCount = 0;
	let errorCount = 0;
	const conversions: Array<{ file: string; entries: number }> = [];

	for (const file of selectedFiles) {
		try {
			// Generate output filename: replace .log with .json
			const outputFile = file.replace('.log', '.json');

			const entryCount = convertLogFile(file, outputFile);
			convertedCount++;
			conversions.push({ file: outputFile, entries: entryCount });
		} catch (error) {
			errorCount++;
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			p.log.error(`Failed to convert ${file}: ${errorMessage}`);
		}
	}

	s.stop();

	// Display summary
	if (convertedCount > 0) {
		let summary = `${color.green('Successfully converted:')} ${convertedCount} file(s)\n\n`;

		for (const { file, entries } of conversions) {
			summary += `${color.cyan('•')} ${file} (${entries} entries)\n`;
		}

		if (errorCount > 0) {
			summary += `\n${color.red('Failed:')} ${errorCount} file(s)`;
		}

		p.note(summary.trim(), 'Conversion Summary');
	}

	if (errorCount > 0 && convertedCount === 0) {
		p.outro(`Failed to convert any files.`);
	} else {
		p.outro('Conversion complete.');
	}
};

void convertLogs();
