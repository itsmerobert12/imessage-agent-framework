/**
 * Orchestrator - Multi-agent coordination
 * Routes messages to appropriate agents, manages agent lifecycle
 */

import { Agent, AgentConfig, agentFactory } from './agents';
import { iMessageBridge, Message } from './imessage';
import { logger } from './observability';

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  routingStrategy: 'direct' | 'round-robin' | 'capability';
}

export class Orchestrator {
  private agents: Map<string, Agent> = new Map();
  private bridge: iMessageBridge;
  private config: OrchestratorConfig;

  constructor(bridge: iMessageBridge, config?: Partial<OrchestratorConfig>) {
    this.bridge = bridge;
    this.config = {
      maxConcurrentAgents: config?.maxConcurrentAgents || 10,
      routingStrategy: config?.routingStrategy || 'direct',
    };
  }

  /** Create and register a new agent */
  addAgent(id: string, type: string, config: Partial<AgentConfig> & { name: string; role: string }): Agent {
    if (this.agents.size >= this.config.maxConcurrentAgents) {
      throw new Error(`Max agents (${this.config.maxConcurrentAgents}) reached`);
    }
    const agent = agentFactory.createAgent(type, config);
    this.agents.set(id, agent);
    logger.info(`Orchestrator: added agent "${agent.name}" (${id})`);
    return agent;
  }

  /** Assign agent to a contact for auto-response */
  assignToContact(agentId: string, contactId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);
    this.bridge.registerAgent(contactId, agent);
  }

  /** Remove an agent */
  removeAgent(id: string): void {
    this.agents.delete(id);
    logger.info(`Orchestrator: removed agent ${id}`);
  }

  /** Route a message to the best agent based on strategy */
  async routeMessage(message: Message): Promise<string | null> {
    const agentEntries = Array.from(this.agents.entries());
    if (agentEntries.length === 0) return null;

    // Direct routing: first available agent
    const [, agent] = agentEntries[0];
    return agent.handleMessage(message.text, message);
  }

  /** Get all managed agents */
  getAgents(): Map<string, Agent> { return this.agents; }

  /** Get status summary */
  getStatus(): Record<string, any> {
    return {
      agentCount: this.agents.size,
      maxAgents: this.config.maxConcurrentAgents,
      strategy: this.config.routingStrategy,
      agents: Array.from(this.agents.entries()).map(([id, a]) => ({
        id, name: a.name, role: a.role,
      })),
    };
  }
}

export default Orchestrator;
