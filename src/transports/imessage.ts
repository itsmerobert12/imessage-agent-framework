/**
 * iMessage Transport — macOS only
 *
 * Personal-assistant behavior:
 *  - The agent NEVER auto-responds. Every reply requires the trigger phrase
 *    (default "hey agent", case-insensitive) at the start of the message.
 *  - This applies in every thread, including the user's self-thread (note-to-self).
 *    The self-thread is the user's natural AI-assistant space, but the trigger is
 *    still required there — explicit invocation only.
 *  - In the self-thread, messages the user sends to themselves (is_from_me=1)
 *    are eligible to invoke the agent. In any other thread, only incoming
 *    messages from the other side can trigger the agent.
 *  - Pulls recent thread messages for conversational context.
 *  - Adds a small natural-feel delay before responding.
 *  - Splits long replies, sends a friendly fallback on errors.
 *
 * Reads new messages from ~/Library/Messages/chat.db (requires Full Disk Access)
 * and sends replies via AppleScript.
 */

import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { Transport } from './base';
import { Orchestrator } from '../core/orchestrator';
import { logger } from '../state/observability';
import * as os from 'os';
import * as path from 'path';

// iMessage caps individual messages around ~16k chars in practice; stay well under.
const MAX_CHUNK_CHARS = 1500;

interface RawMessage {
  ROWID: number;
  text: string;
  is_from_me: 0 | 1;
  sender: string;
  chat_guid: string;
  chat_id: number;
  date: number;
}

export class IMessageTransport extends Transport {
  private chatDb: Database.Database | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastMessageId: number = 0;
  private pollMs: number;

  private selfId: string;
  private trigger: string;
  private contextMessages: number;
  private responseDelayMs: number;

  constructor(orchestrator: Orchestrator, pollMs: number = 3000) {
    super(orchestrator, 'imessage');
    this.pollMs = pollMs;
    this.selfId = (process.env.IMESSAGE_SELF_ID || '').trim().toLowerCase();
    this.trigger = (process.env.IMESSAGE_TRIGGER || 'hey agent').trim().toLowerCase();
    this.contextMessages = parseInt(process.env.IMESSAGE_CONTEXT_MESSAGES || '10', 10);
    this.responseDelayMs = parseInt(process.env.IMESSAGE_RESPONSE_DELAY_MS || '1500', 10);
  }

  async start(): Promise<void> {
    if (os.platform() !== 'darwin') {
      throw new Error('iMessage transport only works on macOS');
    }
    if (!this.selfId) {
      logger.warn('IMESSAGE_SELF_ID is not set — self-thread detection disabled. Set your phone number or Apple ID email in .env to enable always-on personal-assistant mode.');
    }

    const dbPath = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
    try {
      this.chatDb = new Database(dbPath, { readonly: true });
    } catch (err: any) {
      throw new Error(`Cannot open Messages database. Grant Full Disk Access in System Settings → Privacy & Security → Full Disk Access. ${err.message}`);
    }

    const latest = this.chatDb.prepare('SELECT MAX(ROWID) as maxId FROM message').get() as any;
    this.lastMessageId = latest?.maxId || 0;

    logger.info(`iMessage transport started — polling every ${this.pollMs}ms from message ID ${this.lastMessageId}. Trigger="${this.trigger}", self="${this.selfId || '(unset)'}", context=${this.contextMessages}, delay=${this.responseDelayMs}ms`);

    this.pollInterval = setInterval(() => this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (!this.chatDb) return;

    let messages: RawMessage[];
    try {
      messages = this.chatDb.prepare(`
        SELECT m.ROWID, m.text, m.is_from_me, m.date,
          COALESCE(h.id, '') as sender,
          COALESCE(c.guid, '') as chat_guid,
          COALESCE(c.ROWID, 0) as chat_id
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.ROWID > ? AND m.text IS NOT NULL AND m.text != ''
        ORDER BY m.ROWID ASC
        LIMIT 25
      `).all(this.lastMessageId) as RawMessage[];
    } catch (err: any) {
      logger.error(`iMessage poll query failed: ${err.message}`);
      return;
    }

    for (const msg of messages) {
      this.lastMessageId = Math.max(this.lastMessageId, msg.ROWID);
      try {
        await this.processMessage(msg);
      } catch (err: any) {
        logger.error(`iMessage handler error on ROWID ${msg.ROWID}: ${err.message}`);
      }
    }
  }

  private async processMessage(msg: RawMessage): Promise<void> {
    if (!msg.chat_guid) return; // can't reply without a chat

    const isSelfThread = this.isSelfThread(msg.chat_id);

    // Trigger is required EVERYWHERE — including the self-thread. The agent
    // never responds unless explicitly invoked.
    // In shared threads, only incoming messages can invoke the agent. In the
    // self-thread, the user is texting themselves so is_from_me=1 is allowed.
    if (!isSelfThread && msg.is_from_me === 1) return;

    const trimmedText = msg.text.trim();
    const lower = trimmedText.toLowerCase();
    if (!lower.startsWith(this.trigger)) return;

    // Strip the trigger phrase from the prompt that goes to the agent.
    const userText = trimmedText.slice(this.trigger.length).replace(/^[\s,:!-]+/, '').trim() || trimmedText;

    const senderLabel = msg.is_from_me === 1 ? 'me' : (msg.sender || 'unknown');
    logger.info(`[iMessage] ${isSelfThread ? '(self)' : '(triggered)'} ${senderLabel}: ${msg.text.slice(0, 100)}`);

    // Pull recent thread context.
    const context = this.fetchThreadContext(msg.chat_id, msg.ROWID);
    const promptForAgent = this.buildPrompt(context, userText, isSelfThread);

    // Stable per-thread userId so the orchestrator/memory can keep continuity.
    const userId = `imsg-${msg.chat_guid}`;

    // Natural-feel delay before responding.
    if (this.responseDelayMs > 0) {
      await new Promise(r => setTimeout(r, this.responseDelayMs));
    }

    let response: string;
    try {
      response = await this.handleMessage({
        userId,
        text: promptForAgent,
        platform: 'imessage',
        metadata: { chatGuid: msg.chat_guid, isSelfThread, sender: msg.sender },
      });
    } catch (err: any) {
      logger.error(`Orchestrator failed for ROWID ${msg.ROWID}: ${err.message}`);
      response = this.friendlyErrorMessage(err);
    }

    if (!response || !response.trim()) return;

    this.sendToChat(msg.chat_guid, response);
  }

  /**
   * A chat is the "self thread" when its only participant handle matches IMESSAGE_SELF_ID.
   * (When you text your own number, Messages creates a 1-participant chat with your own handle.)
   */
  private isSelfThread(chatId: number): boolean {
    if (!this.chatDb || !this.selfId || !chatId) return false;
    try {
      const handles = this.chatDb.prepare(`
        SELECT h.id as id
        FROM chat_handle_join chj
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE chj.chat_id = ?
      `).all(chatId) as { id: string }[];

      if (handles.length !== 1) return false;
      return handles[0].id.trim().toLowerCase() === this.selfId;
    } catch (err: any) {
      logger.error(`isSelfThread check failed: ${err.message}`);
      return false;
    }
  }

  private fetchThreadContext(chatId: number, beforeRowId: number): { sender: string; text: string; fromMe: boolean }[] {
    if (!this.chatDb || !chatId || this.contextMessages <= 0) return [];
    try {
      const rows = this.chatDb.prepare(`
        SELECT m.text, m.is_from_me, COALESCE(h.id, '') as sender
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        WHERE cmj.chat_id = ? AND m.ROWID < ? AND m.text IS NOT NULL AND m.text != ''
        ORDER BY m.ROWID DESC
        LIMIT ?
      `).all(chatId, beforeRowId, this.contextMessages) as any[];

      return rows.reverse().map(r => ({
        sender: r.sender,
        text: r.text,
        fromMe: r.is_from_me === 1,
      }));
    } catch (err: any) {
      logger.error(`fetchThreadContext failed: ${err.message}`);
      return [];
    }
  }

  private buildPrompt(
    context: { sender: string; text: string; fromMe: boolean }[],
    currentText: string,
    isSelfThread: boolean,
  ): string {
    if (context.length === 0) return currentText;

    const lines = context.map(c => {
      const who = c.fromMe ? 'Me' : (c.sender || 'Them');
      return `${who}: ${c.text}`;
    }).join('\n');

    const header = isSelfThread
      ? '[Recent messages in your personal note-to-self thread]'
      : '[Recent messages in this iMessage thread, for context only]';

    return `${header}\n${lines}\n\n[Current message]\n${currentText}`;
  }

  private friendlyErrorMessage(err: any): string {
    const m = (err?.message || '').toLowerCase();
    if (m.includes('api key') || m.includes('unauthorized') || m.includes('401')) {
      return "Sorry — my API keys aren't working. Check the .env config.";
    }
    if (m.includes('rate') || m.includes('429') || m.includes('overloaded') || m.includes('quota')) {
      return "Sorry — I'm overloaded right now. Try again in a moment.";
    }
    if (m.includes('timeout') || m.includes('etimedout')) {
      return "Sorry — that took too long. Try again?";
    }
    return "Sorry, I hit an error. Try again.";
  }

  /**
   * Send a (possibly long) message to a chat by its GUID. Splits into chunks
   * that respect iMessage's per-message limits and avoids breaking mid-word.
   */
  private sendToChat(chatGuid: string, text: string): void {
    const chunks = this.splitMessage(text, MAX_CHUNK_CHARS);
    for (const chunk of chunks) {
      this.sendOne(chatGuid, chunk);
    }
  }

  private splitMessage(text: string, max: number): string[] {
    const trimmed = text.trim();
    if (trimmed.length <= max) return [trimmed];

    const out: string[] = [];
    let remaining = trimmed;
    while (remaining.length > max) {
      let cut = remaining.lastIndexOf('\n', max);
      if (cut < max * 0.5) cut = remaining.lastIndexOf('. ', max);
      if (cut < max * 0.5) cut = remaining.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) out.push(remaining);
    return out;
  }

  private sendOne(chatGuid: string, text: string): void {
    // AppleScript: address the chat directly by GUID. This works for both
    // 1:1 and group threads, and for the user's own note-to-self thread.
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedGuid = chatGuid.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "Messages"
      set targetChat to a reference to chat id "${escapedGuid}"
      send "${escaped}" to targetChat
    end tell`;

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, { timeout: 15000 });
    } catch (err: any) {
      logger.error(`Failed to send iMessage to chat ${chatGuid}: ${err.message}`);
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.chatDb?.close();
  }
}
