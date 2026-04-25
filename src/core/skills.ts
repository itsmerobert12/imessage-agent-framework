/**
 * Skill Library — auto-created, self-improving skill documents.
 * After complex tasks (5+ tool calls), the orchestrator reflects
 * and creates a skill doc. Future tasks search the library to
 * inject relevant skills into agent system prompts.
 */

import Database from 'better-sqlite3';
import { TaskDomain } from './llm';
import { logger } from '../state/observability';
import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  name: string;
  domain: TaskDomain;
  description: string;
  content: string;
  usageCount: number;
  lastUsed: number;
}

export class SkillLibrary {
  private db: Database.Database;
  private skillDir: string;

  constructor(dbPath: string, skillDir: string = './skills') {
    this.skillDir = skillDir;
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        name TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT NOT NULL,
        usage_count INTEGER DEFAULT 1,
        last_used INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
        name, description, content, content=skills, content_rowid=rowid
      );
      CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, content) VALUES (new.rowid, new.name, new.description, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
        DELETE FROM skills_fts WHERE rowid = old.rowid;
        INSERT INTO skills_fts(rowid, name, description, content) VALUES (new.rowid, new.name, new.description, new.content);
      END;
    `);
    logger.info(`Skill library initialized: ${this.count()} skills loaded`);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM skills').get() as any).c;
  }
  /** Search skills by query and optionally filter by domain */
  async search(query: string, domain?: TaskDomain, limit: number = 5): Promise<Skill[]> {
    try {
      let rows: any[];
      if (domain) {
        rows = this.db.prepare(`
          SELECT s.* FROM skills s
          JOIN skills_fts f ON s.rowid = f.rowid
          WHERE skills_fts MATCH ? AND s.domain = ?
          ORDER BY rank LIMIT ?
        `).all(query, domain, limit);
      } else {
        rows = this.db.prepare(`
          SELECT s.* FROM skills s
          JOIN skills_fts f ON s.rowid = f.rowid
          WHERE skills_fts MATCH ?
          ORDER BY rank LIMIT ?
        `).all(query, limit);
      }
      return rows.map(this.rowToSkill);
    } catch {
      // FTS query might fail on weird input; fall back to LIKE
      const rows = this.db.prepare(
        `SELECT * FROM skills WHERE description LIKE ? OR name LIKE ? LIMIT ?`
      ).all(`%${query}%`, `%${query}%`, limit);
      return rows.map(this.rowToSkill);
    }
  }

  /** Create a new skill or update an existing one (self-improvement) */
  async createOrUpdate(skill: Skill): Promise<void> {
    const existing = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(skill.name);
    if (existing) {
      this.db.prepare(`
        UPDATE skills SET content = ?, description = ?, usage_count = usage_count + 1, last_used = ? WHERE name = ?
      `).run(skill.content, skill.description, skill.lastUsed, skill.name);
    } else {
      this.db.prepare(`
        INSERT INTO skills (name, domain, description, content, usage_count, last_used) VALUES (?, ?, ?, ?, ?, ?)
      `).run(skill.name, skill.domain, skill.description, skill.content, skill.usageCount, skill.lastUsed);
    }
    // Also write to disk as markdown
    const filePath = path.join(this.skillDir, `${skill.name.replace(/[^a-z0-9_-]/gi, '_')}.md`);
    fs.writeFileSync(filePath, skill.content, 'utf-8');
    logger.info(`Skill ${existing ? 'updated' : 'created'}: ${skill.name}`);
  }
  /** Record that a skill was used */
  recordUsage(name: string): void {
    this.db.prepare('UPDATE skills SET usage_count = usage_count + 1, last_used = ? WHERE name = ?')
      .run(Date.now(), name);
  }

  /** Get the most-used skills (for bootstrapping system prompts) */
  getTopSkills(limit: number = 10): Skill[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY usage_count DESC LIMIT ?').all(limit);
    return rows.map(this.rowToSkill);
  }

  private rowToSkill(row: any): Skill {
    return {
      name: row.name,
      domain: row.domain as TaskDomain,
      description: row.description,
      content: row.content,
      usageCount: row.usage_count,
      lastUsed: row.last_used,
    };
  }
}
