/**
 * SQLite State Store — central database for all persistent state
 */

import Database from 'better-sqlite3';
import { logger } from './observability';
import * as path from 'path';
import * as fs from 'fs';

export class StateStore {
  private db: Database.Database;

  constructor(dataDir: string = './data') {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'agent-framework.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    logger.info(`State store initialized: ${dbPath}`);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  /** Get the DB path for sub-systems (skills, memory) */
  getDbPath(): string {
    return this.db.name;
  }

  close(): void {
    this.db.close();
  }
}
