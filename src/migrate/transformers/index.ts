import clerkTransformer from './clerk';
import auth0Transformer from './auth0';
import authjsTransformer from './authjs';
import supabaseTransformer from './supabase';

export const transformers = [
	clerkTransformer,
	auth0Transformer,
	authjsTransformer,
	supabaseTransformer,
];
