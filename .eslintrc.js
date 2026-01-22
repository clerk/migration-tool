module.exports = {
	env: {
		browser: true,
		es2021: true,
		node: true,
	},
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:@typescript-eslint/recommended-requiring-type-checking',
		'prettier', // Must be last to override other configs
	],
	overrides: [
		{
			env: {
				node: true,
			},
			files: ['.eslintrc.{js,cjs}'],
			parserOptions: {
				sourceType: 'script',
			},
		},
	],
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		project: './tsconfig.json',
	},
	plugins: ['@typescript-eslint'],
	rules: {
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
};
