/**
 * Discord Transport — discord.js bot
 */

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { Transport } from './base';
import { Orchestrator } from '../core/orchestrator';
import { logger } from '../state/observability';

export class DiscordTransport extends Transport {
  private client: Client;

  constructor(orchestrator: Orchestrator) {
    super(orchestrator, 'discord');
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });
  }

  async start(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) throw new Error('DISCORD_BOT_TOKEN not set');

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      // Respond to DMs or when mentioned
      const isDM = !message.guild;
      const isMentioned = message.mentions.has(this.client.user!);
      if (!isDM && !isMentioned) return;
      const userId = `dc-${message.author.id}`;
      const text = message.content.replace(/<@!?\d+>/g, '').trim();
      if (!text) return;

      logger.info(`[Discord] ${userId}: ${text.slice(0, 80)}`);

      try {
        const response = await this.handleMessage({ userId, text, platform: 'discord' });
        // Split long messages (Discord 2000 char limit)
        for (let i = 0; i < response.length; i += 1900) {
          await message.reply(response.slice(i, i + 1900));
        }
      } catch (err: any) {
        logger.error(`Discord error: ${err.message}`);
        await message.reply('Sorry, something went wrong.');
      }
    });

    this.client.once(Events.ClientReady, (c) => {
      logger.info(`Discord bot ready as ${c.user.tag}`);
    });

    await this.client.login(token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }
}
