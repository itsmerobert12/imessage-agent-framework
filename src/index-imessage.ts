/**
 * iMessage AI Agent Framework - Main Entry Point
 * Interactive menu-driven system for managing AI agents via iMessage
 */

import dotenv from 'dotenv';
dotenv.config();

import readline from 'readline';
import { iMessageBridge } from './imessage';
import { Orchestrator } from './orchestrator';
import { CLIManager } from './cli-local';
import { logger } from './observability';

const bridge = new iMessageBridge();
const orchestrator = new Orchestrator(bridge);
const cli = new CLIManager(bridge, orchestrator);

function showMenu(): void {
  console.log(`
╔══════════════════════════════════════════╗
║    iMessage AI Agent Framework v1.0      ║
╠══════════════════════════════════════════╣
║  1. Connect to iMessage                 ║
║  2. Create Agent                        ║
║  3. Register Agent with Contact         ║
║  4. List Contacts                       ║
║  5. List Active Agents                  ║
║  6. Start Watching (begin responding)   ║
║  7. Stop Watching                       ║
║  8. View Conversation History           ║
║  9. Send Test Message                   ║
║ 10. View System Status                  ║
║ 11. Help                                ║
║ 12. Quit                                ║
╚══════════════════════════════════════════╝
`);
}

async function handleChoice(choice: string): Promise<boolean> {
  switch (choice.trim()) {
    case '1': {
      console.log('\n🔌 Connecting to iMessage...');
      const ok = await bridge.initialize();
      console.log(ok ? '✅ Connected to Messages.app!\n' : '❌ Failed to connect. Check Full Disk Access.\n');
      break;
    }
    case '2': await cli.createAgentInteractive(); break;
    case '3': await cli.registerAgentInteractive(); break;
    case '4': {
      const stats = bridge.getStats();
      console.log('\n📇 Registered contacts:');
      if (stats.agents.length === 0) console.log('  (none)');
      else stats.agents.forEach((a: any) => console.log(`  ${a.contact} → ${a.agent}`));
      console.log();
      break;
    }
    case '5': {
      const orch = orchestrator.getStatus();
      console.log(`\n🤖 Active agents (${orch.agentCount}/${orch.maxAgents}):`);
      if (orch.agents.length === 0) console.log('  (none)');
      else orch.agents.forEach((a: any) => console.log(`  [${a.id}] ${a.name} - ${a.role}`));
      console.log();
      break;
    }
    case '6': {
      console.log('\n👁️ Starting message watcher...');
      bridge.watchMessages(); // runs in background
      console.log('Watching for messages. Agents will auto-respond.\n');
      break;
    }
    case '7': bridge.stopWatching(); console.log('\n⏹️ Stopped watching.\n'); break;
    case '8': {
      const contact = await cli.prompt('Contact to view history: ');
      const history = bridge.getConversationHistory(contact);
      console.log(`\n📜 Last ${history.length} messages with ${contact}:`);
      history.forEach(m => {
        const dir = m.isFromMe ? '→' : '←';
        console.log(`  ${dir} [${m.timestamp.toLocaleTimeString()}] ${m.text.slice(0, 80)}`);
      });
      console.log();
      break;
    }
    case '9': {
      const to = await cli.prompt('Send to (phone/email): ');
      const msg = await cli.prompt('Message: ');
      const sent = await bridge.sendMessage(to, msg);
      console.log(sent ? '✅ Message sent!\n' : '❌ Failed to send.\n');
      break;
    }
    case '10': {
      const status = bridge.getStats();
      console.log('\n📊 System Status:');
      console.log(`  Connected: ${status.connected}`);
      console.log(`  Watching: ${status.watching}`);
      console.log(`  Agents: ${status.registeredAgents}`);
      console.log(`  Last msg ID: ${status.lastMessageId}\n`);
      break;
    }
    case '11':
      console.log('\n📖 Help:');
      console.log('  1. Connect to iMessage first (option 1)');
      console.log('  2. Create an agent (option 2)');
      console.log('  3. Register agent with a contact (option 3)');
      console.log('  4. Start watching (option 6)');
      console.log('  5. Send a test message from that contact');
      console.log('  The agent will auto-respond!\n');
      break;
    case '12': case 'q': case 'quit': case 'exit':
      console.log('\n👋 Shutting down...');
      bridge.close();
      cli.close();
      return false;
    default:
      console.log('\n❓ Invalid choice. Enter 1-12.\n');
  }
  return true;
}

async function main(): Promise<void> {
  console.log('\n🚀 iMessage AI Agent Framework');
  console.log('   100% Local · No Cloud · Complete Privacy\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let running = true;
  while (running) {
    showMenu();
    const choice = await new Promise<string>(resolve => rl.question('Choose (1-12): ', resolve));
    running = await handleChoice(choice);
  }

  rl.close();
  process.exit(0);
}

main().catch(err => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
