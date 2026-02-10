import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default function setup() {
	// Set mock CLERK_SECRET_KEY if not already set (required by envs-constants.ts)
	if (!process.env.CLERK_SECRET_KEY) {
		process.env.CLERK_SECRET_KEY = 'sk_test_mock_key_for_testing';
	}

	const logsDir = join(process.cwd(), 'logs');
	if (!existsSync(logsDir)) {
		mkdirSync(logsDir);
	}
}
