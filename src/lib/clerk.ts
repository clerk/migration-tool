import { env } from '../envs-constants';

export interface ClerkConfig {
	attributes: Partial<Record<string, { enabled: boolean; required: boolean }>>;
	social: Partial<Record<string, { enabled: boolean }>>;
}

/**
 * Decodes a Clerk publishable key to extract the frontend API hostname.
 *
 * Format: pk_test_<base64(hostname$)> or pk_live_<base64(hostname$)>
 * The base64 payload decodes to a hostname ending with '$'.
 *
 * @param key - The Clerk publishable key
 * @returns The frontend API hostname, or null if decoding fails
 */
function decodePublishableKey(key: string): string | null {
	if (!key.startsWith('pk_test_') && !key.startsWith('pk_live_')) {
		return null;
	}
	try {
		const base64Part = key.split('_')[2];
		const decoded = Buffer.from(base64Part, 'base64').toString();
		if (!decoded.endsWith('$') || !decoded.includes('.')) {
			return null;
		}
		return decoded.slice(0, -1);
	} catch {
		return null;
	}
}

/**
 * Fetches the Clerk instance configuration via the Frontend API.
 *
 * Decodes the publishable key to derive the FAPI hostname, then calls
 * GET /v1/environment to retrieve auth settings, social connections,
 * and user model configuration.
 *
 * @param publishableKey - The Clerk publishable key (pk_test_... or pk_live_...)
 * @returns Clerk configuration with attributes and social connections, or null on failure
 */
export async function fetchClerkConfig(
	publishableKey: string
): Promise<ClerkConfig | null> {
	const frontendApi = decodePublishableKey(publishableKey);
	if (!frontendApi) return null;

	try {
		const res = await fetch(`https://${frontendApi}/v1/environment`);
		if (!res.ok) return null;

		const data = (await res.json()) as {
			user_settings?: {
				attributes?: Record<string, { enabled: boolean; required: boolean }>;
				social?: Record<string, { enabled: boolean }>;
			};
		};
		const userSettings = data.user_settings;
		if (!userSettings) return null;

		return {
			attributes: userSettings.attributes || {},
			social: userSettings.social || {},
		};
	} catch {
		return null;
	}
}

/**
 * Detects whether the Clerk instance is development or production based on the secret key
 *
 * @returns "dev" if the secret key starts with "sk_test_", otherwise "prod"
 */
export const detectInstanceType = (): 'dev' | 'prod' => {
	const secretKey = env.CLERK_SECRET_KEY;
	if (secretKey.startsWith('sk_test_')) {
		return 'dev';
	}
	return 'prod';
};
