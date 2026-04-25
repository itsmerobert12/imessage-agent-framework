/**
 * Three-Layer Memory System
 * Layer 1: Context window compression (summarize old messages)
 * Layer 2: FTS5 SQLite searchable session history
 * Layer 3: Persistent files (long-term knowledge, user model)
 */

import Database from 'better-sqlite3';
import { LLMProvider, selectModel, ChatMessage } from './llm';
import { logger } from '../state/observability';
import * as fs from 'fs';
import * as path from 'path';

export interface MemoryEntry {
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sessionId: string;
}

export class Memory {
  private db: Database.Database;
  private llm: LLMProvider;
  private persistDir: string;

  constructor(dbPath: string, llm: LLMProvider, persistDir: string = './memory') {
    this.llm = llm;
    this.persistDir = persistDir;
    if (!fs.existsSync(persistDir)) fs.mkdirSync(persistDir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, timestamp);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content=messages, content_rowid=id);
      CREATE TRIGGER IF NOT EXISTS msg_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        preferences TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS long_term (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    logger.info('Memory system initialized');
  }
  /** Store a message exchange to Layer 2 (SQLite) */
  async store(userId: string, userMessage: string, assistantResponse: string, sessionId: string = 'default'): Promise<void> {
    const now = Date.now();
    const insert = this.db.prepare('INSERT INTO messages (user_id, role, content, timestamp, session_id) VALUES (?, ?, ?, ?, ?)');
    insert.run(userId, 'user', userMessage, now, sessionId);
    insert.run(userId, 'assistant', assistantResponse, now + 1, sessionId);
  }

  /** Retrieve relevant context for a query — searches all three layers */
  async retrieve(userId: string, query: string, limit: number = 10): Promise<string> {
    const parts: string[] = [];

    // Layer 2: FTS5 search over message history
    try {
      const ftsRows = this.db.prepare(`
        SELECT m.role, m.content, m.timestamp FROM messages m
        JOIN messages_fts f ON m.id = f.rowid
        WHERE messages_fts MATCH ? AND m.user_id = ?
        ORDER BY rank LIMIT ?
      `).all(query, userId, limit) as any[];
      if (ftsRows.length > 0) {
        parts.push('Relevant past messages:\n' + ftsRows.map(r => `[${r.role}] ${r.content.slice(0, 200)}`).join('\n'));
      }
    } catch { /* FTS query failed, skip */ }

    // Layer 2 fallback: recent messages
    const recent = this.db.prepare(
      'SELECT role, content FROM messages WHERE user_id = ? ORDER BY timestamp DESC LIMIT 5'
    ).all(userId) as any[];
    if (recent.length > 0) {
      parts.push('Recent messages:\n' + recent.reverse().map(r => `[${r.role}] ${r.content.slice(0, 150)}`).join('\n'));
    }
    // Layer 3: User preferences
    const prefs = this.db.prepare('SELECT preferences FROM user_preferences WHERE user_id = ?').get(userId) as any;
    if (prefs) {
      parts.push(`User preferences: ${prefs.preferences}`);
    }

    // Layer 3: Long-term persistent knowledge
    const ltFile = path.join(this.persistDir, `${userId}_memory.md`);
    if (fs.existsSync(ltFile)) {
      const ltContent = fs.readFileSync(ltFile, 'utf-8');
      if (ltContent.length > 0) {
        parts.push(`Long-term memory:\n${ltContent.slice(0, 500)}`);
      }
    }

    return parts.join('\n\n');
  }

  /** Layer 1: Compress conversation history into a summary */
  async compressHistory(messages: ChatMessage[]): Promise<string> {
    const compressModel = selectModel('conversation', 'cheap', 'realtime', this.llm.availableProviders);
    const text = messages.map(m => `[${m.role}] ${m.content}`).join('\n');

    const resp = await this.llm.chat({
      model: compressModel,
      systemPrompt: 'Summarize this conversation concisely. Preserve key facts, decisions, and context. Be brief.',
      messages: [{ role: 'user', content: text.slice(0, 8000) }],
      temperature: 0.2,
      maxTokens: 1024,
    });

    return resp.content;
  }
  /** Update user preferences (drift detection) */
  async updatePreferences(userId: string, key: string, value: any): Promise<void> {
    const existing = this.db.prepare('SELECT preferences FROM user_preferences WHERE user_id = ?').get(userId) as any;
    const prefs = existing ? JSON.parse(existing.preferences) : {};
    prefs[key] = value;
    this.db.prepare(`
      INSERT INTO user_preferences (user_id, preferences, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET preferences = ?, updated_at = ?
    `).run(userId, JSON.stringify(prefs), Date.now(), JSON.stringify(prefs), Date.now());
  }

  /** Store a long-term fact */
  async storeLongTerm(key: string, value: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO long_term (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `).run(key, value, Date.now(), value, Date.now());
  }

  /** Append to a user's persistent memory file */
  async appendPersistent(userId: string, content: string): Promise<void> {
    const filePath = path.join(this.persistDir, `${userId}_memory.md`);
    fs.appendFileSync(filePath, `\n${content}\n`, 'utf-8');
  }
}
