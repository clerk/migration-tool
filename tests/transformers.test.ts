import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Tests to ensure all transformers are properly registered in index.ts
 *
 * This prevents a common issue where a custom transformer is created but not
 * registered, causing the delete command to fail to find migrated users.
 */

const TRANSFORMERS_DIR = path.join(process.cwd(), 'src/transformers');
const INDEX_FILE = path.join(TRANSFORMERS_DIR, 'index.ts');

/**
 * Gets all transformer files (excluding index.ts)
 */
function getTransformerFiles(): string[] {
	const files = fs.readdirSync(TRANSFORMERS_DIR);
	return files
		.filter((file) => file.endsWith('.ts') && file !== 'index.ts')
		.map((file) => file.replace('.ts', ''));
}

describe('transformer registration', () => {
	const transformerFiles = getTransformerFiles();
	const indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');

	test('should have at least one transformer file', () => {
		expect(transformerFiles.length).toBeGreaterThan(0);
	});

	describe('each transformer file has a default export', () => {
		test.each(transformerFiles)('%s has a default export', (fileName) => {
			const filePath = path.join(TRANSFORMERS_DIR, `${fileName}.ts`);
			const content = fs.readFileSync(filePath, 'utf-8');

			// Check for default export pattern
			const hasDefaultExport =
				/export\s+default\s+\w+/.test(content) ||
				/export\s*\{\s*\w+\s+as\s+default\s*\}/.test(content);

			expect(
				hasDefaultExport,
				`${fileName}.ts must have a default export`
			).toBe(true);
		});
	});

	describe('each transformer file is imported in index.ts', () => {
		test.each(transformerFiles)('%s is imported in index.ts', (fileName) => {
			// Check for import statement - handles various import patterns
			// e.g., import auth0Transformer from './auth0';
			// e.g., import customTransformer from './custom';
			const importPattern = new RegExp(
				`import\\s+\\w+\\s+from\\s+['"]\\.\\/${fileName}['"]`
			);

			expect(
				importPattern.test(indexContent),
				`${fileName} must be imported in index.ts. Add: import ${fileName}Transformer from './${fileName}';`
			).toBe(true);
		});
	});

	describe('each transformer is exported in the transformers array', () => {
		test.each(transformerFiles)(
			'%s transformer is in the exports array',
			(fileName) => {
				// Extract the transformer key from the file content
				const filePath = path.join(TRANSFORMERS_DIR, `${fileName}.ts`);
				const content = fs.readFileSync(filePath, 'utf-8');

				// Extract the key value from the transformer definition
				const keyMatch = content.match(/key:\s*['"]([^'"]+)['"]/);
				expect(
					keyMatch,
					`${fileName}.ts must have a key property`
				).not.toBeNull();

				// After the expect, we know keyMatch is not null
				const transformerKey = keyMatch ? keyMatch[1] : '';

				// Check that the variable name used in the file is exported in index.ts
				// The transformer should be imported and added to the array
				const variableMatch = content.match(
					/const\s+(\w+)\s*=\s*\{[\s\S]*?key:\s*['"]/
				);
				expect(
					variableMatch,
					`${fileName}.ts must define a transformer constant`
				).not.toBeNull();

				// After the expect, we know variableMatch is not null
				const variableName = variableMatch ? variableMatch[1] : '';

				// Check the variable is in the transformers array in index.ts
				const arrayPattern = new RegExp(`\\b${variableName}\\b`);
				expect(
					arrayPattern.test(indexContent),
					`Transformer "${variableName}" with key "${transformerKey}" from ${fileName}.ts must be added to the transformers array in index.ts`
				).toBe(true);
			}
		);
	});

	test('transformers array has correct number of entries', () => {
		// Count the number of imports in index.ts (excluding type imports)
		const importMatches = indexContent.match(
			/import\s+\w+\s+from\s+['"]\.\/\w+['"]/g
		);
		const importCount = importMatches ? importMatches.length : 0;

		expect(
			importCount,
			`Expected ${transformerFiles.length} transformer imports but found ${importCount}. ` +
				`Make sure all transformer files are imported in index.ts`
		).toBe(transformerFiles.length);
	});

	describe('each transformer has required properties', () => {
		test.each(transformerFiles)(
			'%s has key, label, description, and transformer fields',
			(fileName) => {
				const filePath = path.join(TRANSFORMERS_DIR, `${fileName}.ts`);
				const content = fs.readFileSync(filePath, 'utf-8');

				// Check for key property
				expect(
					/key:\s*['"][^'"]+['"]/.test(content),
					`${fileName}.ts must have a key property`
				).toBe(true);

				// Check for label property
				expect(
					/label:\s*['"][^'"]+['"]/.test(content),
					`${fileName}.ts must have a label property`
				).toBe(true);

				// Check for description property
				expect(
					/description:\s*/.test(content),
					`${fileName}.ts must have a description property`
				).toBe(true);

				// Check for transformer property (object with field mappings)
				expect(
					/transformer:\s*\{/.test(content),
					`${fileName}.ts must have a transformer property with field mappings`
				).toBe(true);
			}
		);
	});

	describe('each transformer maps a field to userId', () => {
		test.each(transformerFiles)(
			'%s transformer maps a source field to userId',
			(fileName) => {
				const filePath = path.join(TRANSFORMERS_DIR, `${fileName}.ts`);
				const content = fs.readFileSync(filePath, 'utf-8');

				// Check that a field maps to 'userId'
				// Patterns: 'field': 'userId' or field: 'userId'
				const mapsToUserId = /['"]?\w+['"]?\s*:\s*['"]userId['"]/.test(content);

				expect(
					mapsToUserId,
					`Transformer ${fileName}.ts must map a source field to 'userId'. ` +
						`This is required for the delete command to identify migrated users.`
				).toBe(true);
			}
		);
	});
});
