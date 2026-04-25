/**
 * Agent Framework v2.0 — Entry Point
 * Self-improving multi-agent framework with dynamic agent spawning,
 * multi-LLM orchestration, and multi-platform transport.
 */

import 'dotenv/config';
import { LLMProvider } from './core/llm';
import { Orchestrator } from './core/orchestrator';
import { SkillLibrary } from './core/skills';
import { Memory } from './core/memory';
import { ToolRegistry } from './tools/registry';
import { searchTool } from './tools/search';
import { codeExecTool } from './tools/code-exec';
import { fileOpsTool } from './tools/file-ops';
import { browserTool } from './tools/browser';
import { CLITransport } from './transports/cli';
import { TelegramTransport } from './transports/telegram';
import { DiscordTransport } from './transports/discord';
import { IMessageTransport } from './transports/imessage';
import { Transport } from './transports/base';
import { logger } from './state/observability';

async function main() {
  // Parse transport from args: --transport=cli|telegram|discord|imessage
  const transportArg = process.argv.find(a => a.startsWith('--transport='));
  const transportName = transportArg?.split('=')[1] || 'cli';

  logger.info(`Agent Framework v2.0 starting — transport: ${transportName}`);
  // 1. Initialize LLM provider
  const llm = new LLMProvider();

  // Check Ollama availability — provides local fallback resilience
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  let ollamaUp = false;
  try {
    const res = await fetch(`${ollamaHost}/api/tags`);
    if (res.ok) {
      ollamaUp = true;
      const data: any = await res.json();
      const names = (data.models || []).map((m: any) => m.name);
      logger.info(`Ollama up at ${ollamaHost} — local models: ${names.join(', ') || '(none pulled)'}`);
    }
  } catch {
    if (process.env.OLLAMA_ENABLED === 'true') {
      logger.warn(`OLLAMA_ENABLED=true but Ollama not reachable at ${ollamaHost} — fallback unavailable`);
    } else {
      logger.info(`Ollama not running at ${ollamaHost} — local fallback disabled`);
    }
  }

  const cloudConfigured = ['anthropic', 'openai', 'openrouter'].some(p => llm.availableProviders.has(p));
  if (!cloudConfigured && !ollamaUp) {
    logger.error('No LLM providers available! Set an API key in .env or start Ollama locally.');
    process.exit(1);
  }
  if (!cloudConfigured) {
    logger.info('No cloud API keys configured — running in Ollama-only mode');
  }

  // 2. Initialize skill library and memory (shared SQLite DB)
  const dataDir = process.env.DATA_DIR || './data';
  const dbPath = `${dataDir}/agent-framework.db`;
  const skills = new SkillLibrary(dbPath, `${dataDir}/skills`);
  const memory = new Memory(dbPath, llm, `${dataDir}/memory`);

  // 3. Initialize tool registry with built-in tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerMany([searchTool, codeExecTool, fileOpsTool, browserTool]);

  // 4. Initialize orchestrator
  const orchestrator = new Orchestrator(llm, skills, memory, toolRegistry, {
    defaultCostPreference: (process.env.COST_PREFERENCE as any) || 'standard',
    defaultLatencyPreference: (process.env.LATENCY_PREFERENCE as any) || 'fast',
    reflectionEnabled: process.env.REFLECTION_ENABLED !== 'false',
  });

  // 5. Select and start transport
  let transport: Transport;
  switch (transportName) {
    case 'telegram': transport = new TelegramTransport(orchestrator); break;
    case 'discord': transport = new DiscordTransport(orchestrator); break;
    case 'imessage': transport = new IMessageTransport(orchestrator); break;
    case 'cli': default: transport = new CLITransport(orchestrator, 'cli'); break;
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await transport.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await transport.start();
}

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
