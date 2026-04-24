/**
 * Agent Factory - Create and manage AI agents for iMessage
 * Supports custom personalities, system prompts, capabilities, and models
 */

import { LLMProvider, LLMResponse } from './llm';
import { SearchProvider } from './search';
import { ImageGenerator } from './image';
import { CacheManager } from './cache';
import { logger } from './observability';
import { Message } from './imessage';

export interface AgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  capabilities: string[];
  model: 'smart' | 'fast' | 'creative';
  temperature: number;
  maxTokens?: number;
}

export interface AgentContext {
  conversationHistory: Array<{ role: string; content: string }>;
  metadata: Record<string, any>;
}

/** Base Agent class - extend this for custom agent types */
export class Agent {
  public name: string;
  public role: string;
  protected config: AgentConfig;
  protected llm: LLMProvider;
  protected context: AgentContext;
  protected search: SearchProvider;
  protected imageGen: ImageGenerator;
  protected cache: CacheManager;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.role = config.role;
    this.config = config;
    this.llm = new LLMProvider();
    this.search = new SearchProvider();
    this.imageGen = new ImageGenerator();
    this.cache = new CacheManager();
    this.context = {
      conversationHistory: [],
      metadata: {},
    };
  }

  /** Handle an incoming message - override for custom behavior */
  async handleMessage(text: string, message?: Message): Promise<string> {
    this.context.conversationHistory.push({ role: 'user', content: text });
    // Check cache first
    const cached = this.cache.get(text);
    if (cached) { logger.info(`Cache hit for: ${text.slice(0, 40)}`); return cached; }

    let response: string;
    try {
      // Use capabilities to enhance response
      let enrichedPrompt = text;
      if (this.config.capabilities.includes('search') && this.shouldSearch(text)) {
        const results = await this.search.search(text);
        if (results) enrichedPrompt = `Context from search:\n${results}\n\nUser question: ${text}`;
      }

      const llmResponse = await this.llm.chat({
        model: this.config.model,
        systemPrompt: this.config.systemPrompt,
        messages: [...this.context.conversationHistory.slice(-10)],
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens || 1024,
      });
      response = llmResponse.content;
    } catch (error: any) {
      logger.error(`Agent "${this.name}" error: ${error.message}`);
      response = `Sorry, I encountered an error. Please try again.`;
    }

    this.context.conversationHistory.push({ role: 'assistant', content: response });
    this.cache.set(text, response);
    return response;
  }

  /** Quick chat without search or caching */
  async chat(text: string): Promise<string> {
    const resp = await this.llm.chat({
      model: this.config.model,
      systemPrompt: this.config.systemPrompt,
      messages: [{ role: 'user', content: text }],
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens || 1024,
    });
    return resp.content;
  }

  /** Research a topic with web search */
  async research(query: string): Promise<string> {
    const searchResults = await this.search.search(query);
    const prompt = `Based on the following research:\n${searchResults}\n\nProvide a comprehensive answer to: ${query}`;
    return this.chat(prompt);
  }

  /** Determine if query warrants a web search */
  protected shouldSearch(text: string): boolean {
    const searchTriggers = ['what is', 'who is', 'how to', 'when did', 'where is',
      'tell me about', 'explain', 'search', 'find', 'look up', 'latest', 'news', 'current'];
    return searchTriggers.some(t => text.toLowerCase().includes(t));
  }

  /** Show typing indicator (override per platform) */
  async showTyping(): Promise<void> { /* stub for subclasses */ }

  /** Clear conversation context */
  clearHistory(): void { this.context.conversationHistory = []; }
}

/** Factory for creating pre-configured agents */
export class AgentFactory {
  createAgent(type: string, config: Partial<AgentConfig> & { name: string; role: string }): Agent {
    const defaults: AgentConfig = {
      name: config.name,
      role: config.role,
      systemPrompt: config.systemPrompt || `You are ${config.name}, a ${config.role}. Be helpful, concise, and friendly.`,
      capabilities: config.capabilities || ['analysis'],
      model: config.model || 'smart',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
    };

    switch (type) {
      case 'research': return new ResearchAgent(defaults);
      case 'writer': return new WriterAgent(defaults);
      case 'code': return new CodeAgent(defaults);
      default: return new Agent(defaults);
    }
  }
}

/** Pre-built: Research Assistant */
class ResearchAgent extends Agent {
  constructor(config: AgentConfig) {
    super({ ...config, capabilities: [...config.capabilities, 'search'], temperature: 0.5 });
  }
  async handleMessage(text: string, message?: Message): Promise<string> {
    return this.research(text);
  }
}

/** Pre-built: Writing Partner */
class WriterAgent extends Agent {
  constructor(config: AgentConfig) {
    super({ ...config, temperature: 0.8 });
  }
}

/** Pre-built: Code Helper */
class CodeAgent extends Agent {
  constructor(config: AgentConfig) {
    super({ ...config, temperature: 0.3 });
  }
}

export const agentFactory = new AgentFactory();
export default Agent;
