import clerkTransformer from './clerk';
import auth0Transformer from './auth0';
import authjsTransformer from './authjs';
import betterAuthTransformer from './betterauth';
import firebaseTransformer from './firebase';
import supabaseTransformer from './supabase';

export const transformers = [
	clerkTransformer,
	auth0Transformer,
	authjsTransformer,
	betterAuthTransformer,
	firebaseTransformer,
	supabaseTransformer,
];
