/**
 * Transformer registry
 *
 * Central registration of all available platform transformers. The migration
 * CLI reads from this array to build the interactive picker and resolve
 * --transformer flags.
 *
 * To add a new transformer:
 * 1. Create src/transformers/[platform].ts with a transformer config
 * 2. Import and register it here
 * 3. The CLI will automatically include it in the platform selection
 */
import type { TransformerRegistryEntry } from '../types';
import clerkTransformer from './clerk';
import auth0Transformer from './auth0';
import authjsTransformer from './authjs';
import betterAuthTransformer from './betterauth';
import firebaseTransformer from './firebase';
import supabaseTransformer from './supabase';

export const transformers: TransformerRegistryEntry[] = [
	clerkTransformer,
	auth0Transformer,
	authjsTransformer,
	betterAuthTransformer,
	firebaseTransformer,
	supabaseTransformer,
];
