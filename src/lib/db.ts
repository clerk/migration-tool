/**
 * Database abstraction layer
 *
 * Provides a unified interface for querying PostgreSQL, MySQL, and SQLite
 * databases. Export modules use this to support multiple database types
 * without needing to know which driver is in use.
 *
 * Usage:
 *   const client = await createDbClient('postgresql://...');
 *   const { rows } = await client.query<MyRow>('SELECT * FROM users');
 *   await client.end();
 */
import { Client as PgClient } from 'pg';

export type DbType = 'postgres' | 'mysql' | 'sqlite';

export interface DbClient {
	query<T extends Record<string, unknown>>(
		sql: string,
		params?: unknown[]
	): Promise<{ rows: T[] }>;
	end(): Promise<void>;
	dbType: DbType;
}

/**
 * Detects the database type from a connection string.
 *
 * - `postgresql://` or `postgres://` → postgres
 * - `mysql://` or `mysql2://` → mysql
 * - Anything else (file path, `file:`, `.sqlite`, `.db`) → sqlite
 *
 * @param connectionString - Database connection string or file path
 * @returns The detected database type
 */
export function detectDbType(connectionString: string): DbType {
	const lower = connectionString.toLowerCase();
	if (lower.startsWith('postgresql://') || lower.startsWith('postgres://')) {
		return 'postgres';
	}
	if (lower.startsWith('mysql://') || lower.startsWith('mysql2://')) {
		return 'mysql';
	}
	return 'sqlite';
}

/**
 * Creates a database client for the given connection string.
 *
 * Automatically detects the database type and returns a unified client
 * that normalizes query results to `{ rows: T[] }`.
 *
 * @param connectionString - Database connection string or file path
 * @returns Connected database client
 */
export async function createDbClient(
	connectionString: string
): Promise<DbClient> {
	const dbType = detectDbType(connectionString);

	if (dbType === 'postgres') {
		return createPostgresClient(connectionString);
	}

	if (dbType === 'mysql') {
		return createMysqlClient(connectionString);
	}

	return createSqliteClient(connectionString);
}

async function createPostgresClient(
	connectionString: string
): Promise<DbClient> {
	const client = new PgClient({ connectionString });
	await client.connect();

	return {
		dbType: 'postgres',
		async query<T extends Record<string, unknown>>(
			sql: string,
			params?: unknown[]
		): Promise<{ rows: T[] }> {
			const result = await client.query<T>(sql, params);
			return { rows: result.rows };
		},
		async end(): Promise<void> {
			await client.end();
		},
	};
}

async function createMysqlClient(connectionString: string): Promise<DbClient> {
	const mysql = await import('mysql2/promise');
	const connection = await mysql.createConnection(connectionString);

	return {
		dbType: 'mysql',
		async query<T extends Record<string, unknown>>(
			sql: string,
			params?: unknown[]
		): Promise<{ rows: T[] }> {
			const [rows] = await connection.execute(sql, params);
			return { rows: rows as T[] };
		},
		async end(): Promise<void> {
			await connection.end();
		},
	};
}

async function createSqliteClient(connectionString: string): Promise<DbClient> {
	const BetterSqlite3 = (await import('better-sqlite3')).default;

	// Strip file: prefix if present
	let filePath = connectionString;
	if (filePath.startsWith('file:')) {
		filePath = filePath.slice(5);
	}

	const db = new BetterSqlite3(filePath);

	return {
		dbType: 'sqlite',
		query<T extends Record<string, unknown>>(
			sql: string,
			_params?: unknown[]
		): Promise<{ rows: T[] }> {
			const rows = db.prepare(sql).all() as T[];
			return Promise.resolve({ rows });
		},
		end(): Promise<void> {
			db.close();
			return Promise.resolve();
		},
	};
}
