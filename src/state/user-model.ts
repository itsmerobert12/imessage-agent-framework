/**
 * User Model — tracks preferences with drift detection
 */

import Database from 'better-sqlite3';
import { logger } from './observability';

export interface UserProfile {
  userId: string;
  preferredTone: string;
  preferredDetail: 'brief' | 'detailed' | 'auto';
  topDomains: string[];
  messageCount: number;
  lastActive: number;
  customPrefs: Record<string, any>;
}

export class UserModel {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_model (
        user_id TEXT PRIMARY KEY,
        preferred_tone TEXT DEFAULT 'neutral',
        preferred_detail TEXT DEFAULT 'auto',
        top_domains TEXT DEFAULT '[]',
        message_count INTEGER DEFAULT 0,
        last_active INTEGER NOT NULL,
        custom_prefs TEXT DEFAULT '{}'
      );
    `);
  }
  getProfile(userId: string): UserProfile {
    const row = this.db.prepare('SELECT * FROM user_model WHERE user_id = ?').get(userId) as any;
    if (!row) {
      return {
        userId, preferredTone: 'neutral', preferredDetail: 'auto',
        topDomains: [], messageCount: 0, lastActive: Date.now(), customPrefs: {},
      };
    }
    return {
      userId: row.user_id,
      preferredTone: row.preferred_tone,
      preferredDetail: row.preferred_detail,
      topDomains: JSON.parse(row.top_domains),
      messageCount: row.message_count,
      lastActive: row.last_active,
      customPrefs: JSON.parse(row.custom_prefs),
    };
  }

  /** Update profile after each interaction — detects preference drift */
  recordInteraction(userId: string, domain: string): void {
    const profile = this.getProfile(userId);
    profile.messageCount++;
    profile.lastActive = Date.now();

    // Track domain frequency
    if (!profile.topDomains.includes(domain)) {
      profile.topDomains.push(domain);
      if (profile.topDomains.length > 10) profile.topDomains.shift();
    }

    this.db.prepare(`
      INSERT INTO user_model (user_id, preferred_tone, preferred_detail, top_domains, message_count, last_active, custom_prefs)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        top_domains = ?, message_count = ?, last_active = ?
    `).run(
      userId, profile.preferredTone, profile.preferredDetail,
      JSON.stringify(profile.topDomains), profile.messageCount, profile.lastActive,
      JSON.stringify(profile.customPrefs),
      JSON.stringify(profile.topDomains), profile.messageCount, profile.lastActive,
    );
  }

  setPreference(userId: string, key: string, value: any): void {
    const profile = this.getProfile(userId);
    profile.customPrefs[key] = value;
    this.db.prepare('UPDATE user_model SET custom_prefs = ? WHERE user_id = ?')
      .run(JSON.stringify(profile.customPrefs), userId);
    logger.info(`User ${userId} preference set: ${key} = ${value}`);
  }
}
