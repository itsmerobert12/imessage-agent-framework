/**
 * CLI Transport — interactive terminal for testing
 */

import * as readline from 'readline';
import { Transport } from './base';
import { logger } from '../state/observability';

export class CLITransport extends Transport {
  private rl: readline.Interface | null = null;

  async start(): Promise<void> {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n🤖 Agent Framework v2.0 — CLI Mode');
    console.log('Type your message (or "exit" to quit)\n');

    const prompt = () => {
      this.rl!.question('you > ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
          console.log('Goodbye!');
          await this.stop();
          process.exit(0);
        }

        try {
          const response = await this.handleMessage({
            userId: 'cli-user',
            text: trimmed,
            platform: 'cli',
          });
          console.log(`\nassistant > ${response}\n`);
        } catch (err: any) {
          logger.error(`CLI error: ${err.message}`);
          console.log(`\n[error] ${err.message}\n`);
        }

        prompt();
      });
    };

    prompt();
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}
