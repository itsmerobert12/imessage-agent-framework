/**
 * Telegram Transport — grammY-based bot
 */

import { Bot } from 'grammy';
import { Transport } from './base';
import { Orchestrator } from '../core/orchestrator';
import { logger } from '../state/observability';

export class TelegramTransport extends Transport {
  private bot: Bot;

  constructor(orchestrator: Orchestrator) {
    super(orchestrator, 'telegram');
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');
    this.bot = new Bot(token);
  }

  async start(): Promise<void> {
    this.bot.on('message:text', async (ctx) => {
      const userId = `tg-${ctx.from.id}`;
      const text = ctx.message.text;
      logger.info(`[Telegram] ${userId}: ${text.slice(0, 80)}`);

      try {
        const response = await this.handleMessage({ userId, text, platform: 'telegram' });
        // Split long messages (Telegram 4096 char limit)
        for (let i = 0; i < response.length; i += 4000) {
          await ctx.reply(response.slice(i, i + 4000));
        }
      } catch (err: any) {
        logger.error(`Telegram error: ${err.message}`);
        await ctx.reply('Sorry, something went wrong. Please try again.');
      }
    });

    logger.info('Telegram bot starting...');
    this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
