import fs from 'fs';
import path from 'path';
import type { Settings } from '../types';

const SETTINGS_FILE = '.settings';

/**
 * Loads saved settings from the .settings file in the current directory
 *
 * Reads previously saved migration parameters to use as defaults in the CLI.
 * Returns an empty object if the file doesn't exist or is corrupted.
 *
 * @returns The saved settings object with key and file properties
 */
export const loadSettings = (): Settings => {
	try {
		const settingsPath = path.join(process.cwd(), SETTINGS_FILE);
		if (fs.existsSync(settingsPath)) {
			const content = fs.readFileSync(settingsPath, 'utf-8');
			return JSON.parse(content) as Settings;
		}
	} catch {
		// If settings file is corrupted or unreadable, return empty settings
	}
	return {};
};

/**
 * Saves migration settings to the .settings file in the current directory
 *
 * Persists the current migration parameters (transformer key, file path)
 * so they can be used as defaults in future runs. Fails silently if unable to write.
 *
 * @param settings - The settings object to save
 */
export const saveSettings = (settings: Settings): void => {
	try {
		const settingsPath = path.join(process.cwd(), SETTINGS_FILE);
		fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
	} catch {
		// Silently fail if we can't write settings
	}
};
