/**
 * iMessage Bridge - SQLite connection to Messages.app
 * THE CORE MODULE - Reads from ~/Library/Messages/chat.db
 * and sends replies via AppleScript
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './state/observability';
import { StateManager } from './state';

export interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: Date;
  isFromMe: boolean;
  chatId: string;
  handleId: string;
}

export interface Contact {
  id: string;
  handleId: string;
  displayName: string;
}

export class iMessageBridge {
  private db: Database.Database | null = null;
  private dbPath: string;
  private agents: Map<string, any> = new Map();
  private watching: boolean = false;
  private lastMessageId: number = 0;
  private pollInterval: number;
  private stateManager: StateManager;

  constructor() {
    this.dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    this.pollInterval = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);
    this.stateManager = new StateManager();
  }

  /** Connect to the Messages.app SQLite database (read-only) */
  async initialize(): Promise<boolean> {
    try {
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      this.db.pragma('journal_mode = WAL');
      // Get the latest message ID so we only process new messages
      const row = this.db.prepare('SELECT MAX(ROWID) as maxId FROM message').get() as any;
      this.lastMessageId = row?.maxId || 0;
      logger.info(`Connected to iMessage database. Last message ID: ${this.lastMessageId}`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to connect to iMessage: ${error.message}`);
      logger.info('Ensure Full Disk Access is granted in System Preferences > Privacy & Security');
      return false;
    }
  }

  /** Register an AI agent for a specific contact */
  registerAgent(contactId: string, agent: any): void {
    this.agents.set(contactId.toLowerCase(), agent);
    this.stateManager.saveContact(contactId, agent.name);
    logger.info(`Agent "${agent.name}" registered for contact: ${contactId}`);
  }

  /** Unregister an agent from a contact */
  unregisterAgent(contactId: string): void {
    this.agents.delete(contactId.toLowerCase());
    logger.info(`Agent unregistered for contact: ${contactId}`);
  }

  /** Get all registered agent-contact mappings */
  getRegisteredAgents(): Map<string, any> { return this.agents; }

  /** Poll for new incoming messages from registered contacts */
  getNewMessages(): Message[] {
    if (!this.db) return [];
    try {
      const query = `
        SELECT m.ROWID, m.text, m.is_from_me, m.date,
               h.id as handle_id, c.chat_identifier
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.text IS NOT NULL
        ORDER BY m.ROWID ASC
      `;
      const rows = this.db.prepare(query).all(this.lastMessageId) as any[];
      const messages: Message[] = rows.map(row => {
        if (row.ROWID > this.lastMessageId) this.lastMessageId = row.ROWID;
        return {
          id: uuidv4(),
          text: row.text,
          sender: row.handle_id || 'unknown',
          timestamp: this.convertAppleTimestamp(row.date),
          isFromMe: row.is_from_me === 1,
          chatId: row.chat_identifier || '',
          handleId: row.handle_id || '',
        };
      });
      return messages;
    } catch (error: any) {
      logger.error(`Error fetching messages: ${error.message}`);
      return [];
    }
  }

  /** Send a reply via AppleScript through Messages.app */
  async sendMessage(contact: string, text: string): Promise<boolean> {
    try {
      const sanitized = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const maxLen = parseInt(process.env.MAX_MESSAGE_LENGTH || '0', 10);
      const finalText = maxLen > 0 ? sanitized.slice(0, maxLen) : sanitized;
      const script = `
        tell application "Messages"
          set targetService to 1st account whose service type = iMessage
          set targetBuddy to participant "${contact}" of targetService
          send "${finalText}" to targetBuddy
        end tell
      `;
      execSync(`osascript -e '${script}'`, { timeout: 10000 });
      logger.info(`Message sent to ${contact}: ${finalText.slice(0, 50)}...`);
      this.stateManager.logMessage(contact, finalText, true);
      return true;
    } catch (error: any) {
      logger.error(`Failed to send message to ${contact}: ${error.message}`);
      return false;
    }
  }

  /** Start watching for incoming messages and routing to agents */
  async watchMessages(): Promise<void> {
    if (this.watching) { logger.warn('Already watching'); return; }
    this.watching = true;
    logger.info(`Watching for messages (poll every ${this.pollInterval}ms)...`);

    while (this.watching) {
      const messages = this.getNewMessages();
      for (const msg of messages) {
        const agent = this.agents.get(msg.sender.toLowerCase());
        if (agent) {
          logger.info(`Message from ${msg.sender}: "${msg.text.slice(0, 80)}"`);
          try {
            const response = await agent.handleMessage(msg.text, msg);
            if (response && process.env.AUTO_RESPOND !== 'false') {
              await this.sendMessage(msg.sender, response);
            }
          } catch (err: any) {
            logger.error(`Agent error for ${msg.sender}: ${err.message}`);
          }
        }
      }
      await this.sleep(this.pollInterval);
    }
  }

  /** Stop watching for messages */
  stopWatching(): void {
    this.watching = false;
    logger.info('Stopped watching for messages');
  }

  /** Get conversation history for a contact */
  getConversationHistory(contact: string, limit: number = 50): Message[] {
    if (!this.db) return [];
    try {
      const query = `
        SELECT m.ROWID, m.text, m.is_from_me, m.date,
               h.id as handle_id, c.chat_identifier
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE h.id = ?
        ORDER BY m.date DESC LIMIT ?
      `;
      const rows = this.db.prepare(query).all(contact, limit) as any[];
      return rows.map(row => ({
        id: String(row.ROWID),
        text: row.text || '',
        sender: row.handle_id || contact,
        timestamp: this.convertAppleTimestamp(row.date),
        isFromMe: row.is_from_me === 1,
        chatId: row.chat_identifier || '',
        handleId: row.handle_id || '',
      })).reverse();
    } catch (error: any) {
      logger.error(`Error fetching history: ${error.message}`);
      return [];
    }
  }

  /** Get system status */
  getStats(): Record<string, any> {
    return {
      connected: this.db !== null,
      watching: this.watching,
      registeredAgents: this.agents.size,
      lastMessageId: this.lastMessageId,
      agents: Array.from(this.agents.entries()).map(([c, a]) => ({ contact: c, agent: a.name })),
    };
  }

  /** Convert Apple's Core Data timestamp to JS Date */
  private convertAppleTimestamp(timestamp: number): Date {
    // Apple uses nanoseconds since 2001-01-01
    const appleEpoch = new Date('2001-01-01T00:00:00Z').getTime();
    return new Date(appleEpoch + timestamp / 1000000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Close database connection */
  close(): void {
    if (this.db) { this.db.close(); this.db = null; }
    this.watching = false;
    logger.info('iMessage bridge closed');
  }
}

export default iMessageBridge;
