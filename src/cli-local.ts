/**
 * CLI Local Management - Helper functions for the interactive menu
 */

import { iMessageBridge } from './imessage';
import { Orchestrator } from './orchestrator';
import { agentFactory, AgentConfig } from './agents';
import { logger } from './state/observability';
import readline from 'readline';

export class CLIManager {
  private bridge: iMessageBridge;
  private orchestrator: Orchestrator;
  private rl: readline.Interface;

  constructor(bridge: iMessageBridge, orchestrator: Orchestrator) {
    this.bridge = bridge;
    this.orchestrator = orchestrator;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  prompt(question: string): Promise<string> {
    return new Promise(resolve => this.rl.question(question, resolve));
  }

  async createAgentInteractive(): Promise<void> {
    const name = await this.prompt('Agent name: ');
    const role = await this.prompt('Agent role: ');
    const systemPrompt = await this.prompt('System prompt: ');
    const typeInput = await this.prompt('Type (default/research/writer/code): ');
    const type = typeInput || 'default';
    const id = name.toLowerCase().replace(/\s+/g, '-');

    const agent = this.orchestrator.addAgent(id, type, {
      name, role,
      systemPrompt: systemPrompt || undefined,
    } as any);
    console.log(`\n✅ Agent "${agent.name}" created (id: ${id})\n`);
  }

  async registerAgentInteractive(): Promise<void> {
    const agents = this.orchestrator.getAgents();
    if (agents.size === 0) { console.log('\n❌ No agents created yet.\n'); return; }

    console.log('\nAvailable agents:');
    for (const [id, agent] of agents) {
      console.log(`  ${id} - ${agent.name} (${agent.role})`);
    }
    const agentId = await this.prompt('\nAgent ID: ');
    const contact = await this.prompt('Contact (phone/email): ');

    try {
      this.orchestrator.assignToContact(agentId, contact);
      console.log(`\n✅ Agent registered for ${contact}\n`);
    } catch (err: any) {
      console.log(`\n❌ ${err.message}\n`);
    }
  }

  close(): void { this.rl.close(); }
}

export default CLIManager;
