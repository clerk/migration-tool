import fs from 'fs';

// Maps Supabase provider keys to human-readable labels
export const OAUTH_PROVIDER_LABELS: Record<string, string> = {
	google: 'Google',
	apple: 'Apple',
	github: 'GitHub',
	facebook: 'Facebook',
	twitter: 'Twitter (X)',
	discord: 'Discord',
	spotify: 'Spotify',
	slack: 'Slack',
	slack_oidc: 'Slack (OIDC)',
	twitch: 'Twitch',
	linkedin: 'LinkedIn',
	linkedin_oidc: 'LinkedIn (OIDC)',
	bitbucket: 'Bitbucket',
	gitlab: 'GitLab',
	azure: 'Microsoft (Azure)',
	kakao: 'Kakao',
	notion: 'Notion',
	zoom: 'Zoom',
	keycloak: 'Keycloak',
	figma: 'Figma',
	fly: 'Fly.io',
	workos: 'WorkOS',
	snapchat: 'Snapchat',
};

// Non-OAuth entries in the Supabase external config to ignore
export const IGNORED_PROVIDERS = new Set(['email', 'phone', 'anonymous_users']);

interface SupabaseAuthSettings {
	external?: Record<string, boolean>;
}

/**
 * Fetches the Supabase project's auth settings to determine which OAuth providers are enabled.
 *
 * Calls GET {supabaseUrl}/auth/v1/settings with the API key. This endpoint returns
 * the `external` config object with a boolean for each provider (google, apple, etc.).
 *
 * @param supabaseUrl - The Supabase project URL (e.g., https://xxx.supabase.co)
 * @param apiKey - Any valid Supabase API key (anon or service role)
 * @returns List of enabled OAuth provider keys, or null if the fetch failed
 */
export async function fetchSupabaseProviders(
	supabaseUrl: string,
	apiKey: string
): Promise<string[] | null> {
	try {
		const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`;
		const res = await fetch(url, {
			headers: { apikey: apiKey },
		});

		if (!res.ok) {
			return null;
		}

		const settings = (await res.json()) as SupabaseAuthSettings;
		if (!settings.external) {
			return null;
		}

		return Object.entries(settings.external)
			.filter(([key, enabled]) => enabled && !IGNORED_PROVIDERS.has(key))
			.map(([key]) => key);
	} catch {
		return null;
	}
}

/**
 * Analyzes the raw export data to count users per auth provider.
 *
 * Reads raw_app_meta_data.providers from each user record in the JSON file.
 * This runs on the raw (pre-transformation) data since the transformer
 * doesn't map raw_app_meta_data.
 *
 * @param filePath - Path to the JSON export file
 * @returns Map of provider name to user count (e.g., { email: 142, discord: 5 })
 */
export function analyzeUserProviders(filePath: string): Record<string, number> {
	try {
		const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
			string,
			unknown
		>[];
		const counts: Record<string, number> = {};

		for (const user of raw) {
			const appMeta = user.raw_app_meta_data as
				| Record<string, unknown>
				| undefined;
			if (!appMeta?.providers) continue;

			const providers = appMeta.providers as string[];
			for (const provider of providers) {
				counts[provider] = (counts[provider] || 0) + 1;
			}
		}

		return counts;
	} catch {
		return {};
	}
}

/**
 * Finds user IDs whose only providers are disabled social providers.
 *
 * Reads the raw export file and checks each user's raw_app_meta_data.providers.
 * A user is excluded only if ALL of their providers are disabled social providers —
 * users with at least one supported provider (email, phone, or an enabled social
 * provider) are never excluded.
 *
 * @param filePath - Path to the JSON export file
 * @param disabledProviders - List of provider names not enabled in Clerk (e.g., ['discord'])
 * @returns Object with excluded user IDs and per-provider counts of exclusively-affected users
 */
export function findUsersWithDisabledProviders(
	filePath: string,
	disabledProviders: string[]
): { excludedIds: Set<string>; exclusionsByProvider: Record<string, number> } {
	if (disabledProviders.length === 0)
		return { excludedIds: new Set(), exclusionsByProvider: {} };

	try {
		const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
			string,
			unknown
		>[];
		const excludedIds = new Set<string>();
		const exclusionsByProvider: Record<string, number> = {};
		const disabledSet = new Set(disabledProviders);

		for (const user of raw) {
			const appMeta = user.raw_app_meta_data as
				| Record<string, unknown>
				| undefined;
			if (!appMeta?.providers) continue;

			const providers = appMeta.providers as string[];
			const hasSupportedProvider = providers.some(
				(p) => IGNORED_PROVIDERS.has(p) || !disabledSet.has(p)
			);

			if (!hasSupportedProvider) {
				excludedIds.add(user.id as string);
				const disabledForUser = providers.filter((p) => disabledSet.has(p));
				for (const provider of disabledForUser) {
					exclusionsByProvider[provider] =
						(exclusionsByProvider[provider] || 0) + 1;
				}
			}
		}

		return { excludedIds, exclusionsByProvider };
	} catch {
		return { excludedIds: new Set(), exclusionsByProvider: {} };
	}
}
