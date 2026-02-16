import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle>;
let pool: pg.Pool;

export async function initDatabase() {
  pool = new pg.Pool({ connectionString: config.DATABASE_URL });

  try {
    const client = await pool.connect();
    client.release();
    logger.success('DB', 'PostgreSQL connected');
  } catch (err) {
    logger.warn('DB', 'PostgreSQL not available - running without database persistence');
    return null;
  }

  db = drizzle(pool, { schema });
  return db;
}

export function getDb() {
  return db;
}

export async function closeDatabase() {
  if (pool) await pool.end();
}
