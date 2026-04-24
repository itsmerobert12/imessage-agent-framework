/**
 * State Manager - Local SQLite storage for contacts, conversations, agent memory
 * Everything stays on your machine - no cloud
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from './observability';

export class StateManager {
  private db: Database.Database;
  private dataDir: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new Database(path.join(this.dataDir, 'agent.db'));
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY, agent_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact TEXT, content TEXT, is_outgoing INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS agent_context (
        contact TEXT PRIMARY KEY, context TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  saveContact(contactId: string, agentName: string): void {
    this.db.prepare('INSERT OR REPLACE INTO contacts (id, agent_name) VALUES (?, ?)').run(contactId, agentName);
  }

  logMessage(contact: string, content: string, isOutgoing: boolean): void {
    this.db.prepare('INSERT INTO messages (contact, content, is_outgoing) VALUES (?, ?, ?)')
      .run(contact, content, isOutgoing ? 1 : 0);
  }

  getMessageHistory(contact: string, limit: number = 50): any[] {
    return this.db.prepare('SELECT * FROM messages WHERE contact = ? ORDER BY timestamp DESC LIMIT ?')
      .all(contact, limit);
  }

  saveContext(contact: string, context: any): void {
    this.db.prepare('INSERT OR REPLACE INTO agent_context (contact, context) VALUES (?, ?)')
      .run(contact, JSON.stringify(context));
  }

  getContext(contact: string): any | null {
    const row = this.db.prepare('SELECT context FROM agent_context WHERE contact = ?').get(contact) as any;
    return row ? JSON.parse(row.context) : null;
  }

  close(): void { this.db.close(); }
}

export default StateManager;
