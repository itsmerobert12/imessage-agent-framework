/**
 * iMessage Transport — macOS only
 * Reads from Messages.app SQLite database, sends via AppleScript.
 * Polls chat.db for new messages and forwards to orchestrator.
 */

import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { Transport } from './base';
import { Orchestrator } from '../core/orchestrator';
import { logger } from '../state/observability';
import * as os from 'os';
import * as path from 'path';

export class IMessageTransport extends Transport {
  private chatDb: Database.Database | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastMessageId: number = 0;
  private pollMs: number;

  constructor(orchestrator: Orchestrator, pollMs: number = 3000) {
    super(orchestrator, 'imessage');
    this.pollMs = pollMs;
  }

  async start(): Promise<void> {
    if (os.platform() !== 'darwin') {
      throw new Error('iMessage transport only works on macOS');
    }
    const dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    try {
      this.chatDb = new Database(dbPath, { readonly: true });
    } catch (err: any) {
      throw new Error(`Cannot open Messages database. Grant Full Disk Access in System Settings. ${err.message}`);
    }

    // Get the latest message ID so we only process new ones
    const latest = this.chatDb.prepare('SELECT MAX(ROWID) as maxId FROM message').get() as any;
    this.lastMessageId = latest?.maxId || 0;

    logger.info(`iMessage transport started. Polling every ${this.pollMs}ms from message ID ${this.lastMessageId}`);

    this.pollInterval = setInterval(() => this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (!this.chatDb) return;

    try {
      const messages = this.chatDb.prepare(`
        SELECT m.ROWID, m.text, m.is_from_me,
          COALESCE(h.id, 'unknown') as sender
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.text IS NOT NULL
        ORDER BY m.ROWID ASC LIMIT 10
      `).all(this.lastMessageId) as any[];

      for (const msg of messages) {
        this.lastMessageId = msg.ROWID;
        const userId = `imsg-${msg.sender}`;
        logger.info(`[iMessage] ${msg.sender}: ${msg.text.slice(0, 80)}`);

        try {
          const response = await this.handleMessage({ userId, text: msg.text, platform: 'imessage' });
          this.sendMessage(msg.sender, response);
        } catch (err: any) {
          logger.error(`iMessage handler error: ${err.message}`);
        }
      }
    } catch (err: any) {
      logger.error(`iMessage poll error: ${err.message}`);
    }
  }
  private sendMessage(recipient: string, text: string): void {
    // Escape for AppleScript
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "Messages"
      set targetService to 1st account whose service type = iMessage
      set targetBuddy to participant "${recipient}" of targetService
      send "${escaped}" to targetBuddy
    end tell`;

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { timeout: 10000 });
    } catch (err: any) {
      logger.error(`Failed to send iMessage to ${recipient}: ${err.message}`);
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.chatDb?.close();
  }
}
