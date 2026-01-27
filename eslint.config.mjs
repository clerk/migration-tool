import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default [
	// Base config for all files
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.es2021,
				...globals.node,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: true,
		},
	},

	// TypeScript files configuration
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json',
			},
		},
		plugins: {
			'@typescript-eslint': tsPlugin,
		},
		rules: {
			// ESLint recommended rules
			...tsPlugin.configs['recommended'].rules,
			...tsPlugin.configs['recommended-requiring-type-checking'].rules,

			// TypeScript-specific rules
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/consistent-type-imports': [
				'warn',
				{
					prefer: 'type-imports',
					fixStyle: 'separate-type-imports',
				},
			],
			'@typescript-eslint/no-unnecessary-condition': 'warn',
			'@typescript-eslint/no-non-null-assertion': 'warn',

			// General best practices
			'no-console': 'warn',
			'no-debugger': 'error',
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'no-throw-literal': 'error',
			'prefer-template': 'warn',
			'object-shorthand': ['warn', 'always'],
			'no-nested-ternary': 'warn',

			// Code quality
			complexity: ['warn', 15],
			'max-depth': ['warn', 4],
			'no-else-return': 'warn',
			'prefer-arrow-callback': 'warn',
			'no-lonely-if': 'warn',

			// Import organization
			'sort-imports': [
				'warn',
				{
					ignoreCase: true,
					ignoreDeclarationSort: true,
				},
			],
		},
	},

	// Test files configuration - disable unsafe-* rules for mock/test code
	{
		files: ['**/*.test.ts', '**/*.test.tsx'],
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},

	// Prettier config (must be last to override other configs)
	prettier,
];
