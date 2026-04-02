/**
 * Export registry
 *
 * Central registration of all available export modules. The dispatcher
 * in index.ts reads from this array to build the interactive picker
 * and resolve --platform flags.
 *
 * To add a new export:
 * 1. Create src/export/[platform].ts with a runXxxExport function
 * 2. Import and register it here
 * 3. Add an "export:[platform]" script to package.json
 */
import type { ExportRegistryEntry } from '../types';
import { runAuth0Export } from './auth0';
import { runAuthJSExport } from './authjs';
import { runBetterAuthExport } from './betterauth';
import { runClerkExport } from './clerk';
import { runFirebaseExport } from './firebase';
import { runSupabaseExport } from './supabase';

export const exports: ExportRegistryEntry[] = [
	{
		key: 'auth0',
		label: 'Auth0',
		description: 'Export users from your Auth0 tenant',
		run: runAuth0Export,
	},
	{
		key: 'authjs',
		label: 'AuthJS (Next-Auth)',
		description: 'Export users from an AuthJS database',
		run: runAuthJSExport,
	},
	{
		key: 'betterauth',
		label: 'Better Auth',
		description: 'Export users from a Better Auth database',
		run: runBetterAuthExport,
	},
	{
		key: 'clerk',
		label: 'Clerk',
		description: 'Export users from your Clerk instance',
		run: runClerkExport,
	},
	{
		key: 'firebase',
		label: 'Firebase',
		description: 'Export users from your Firebase project',
		run: runFirebaseExport,
	},
	{
		key: 'supabase',
		label: 'Supabase',
		description: 'Export users from a Supabase Postgres database',
		run: runSupabaseExport,
	},
];
