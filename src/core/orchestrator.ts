/**
 * Orchestrator — THE BRAIN
 * Receives messages, classifies intent, checks skills + memory,
 * dynamically selects model(s) per sub-task, assembles agent config(s),
 * spawns agents (parallel if needed), collects results, triggers learning.
 * NO predefined agent types — everything is assembled on the fly.
 */

import { LLMProvider, selectModel, ChatMessage, TaskDomain, ModelProfile } from './llm';
import { runAgent, createAgentConfig, AgentConfig, AgentResult } from './agent';
import { SkillLibrary, Skill } from './skills';
import { Memory } from './memory';
import { ToolRegistry } from '../tools/registry';
import { logger, metrics } from '../state/observability';
import { randomUUID as uuidv4 } from 'crypto';

// ── Intent Classification ──────────────────────────────────────

export interface Intent {
  domain: TaskDomain;
  complexity: 'simple' | 'moderate' | 'complex';
  description: string;
  subTasks?: SubTask[];
  requiredTools: string[];
}

export interface SubTask {
  domain: TaskDomain;
  description: string;
  dependsOn?: string[];
  id: string;
}

// ── Orchestrator Config ────────────────────────────────────────
export interface OrchestratorConfig {
  defaultCostPreference: 'free' | 'cheap' | 'standard' | 'premium';
  defaultLatencyPreference: 'realtime' | 'fast' | 'standard' | 'slow';
  maxParallelAgents: number;
  skillAutoCreateThreshold: number; // tool calls before auto-creating a skill
  reflectionEnabled: boolean;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  defaultCostPreference: 'standard',
  defaultLatencyPreference: 'fast',
  maxParallelAgents: 5,
  skillAutoCreateThreshold: 5,
  reflectionEnabled: true,
};

// ── Orchestrator ───────────────────────────────────────────────

export class Orchestrator {
  private llm: LLMProvider;
  private skills: SkillLibrary;
  private memory: Memory;
  private toolRegistry: ToolRegistry;
  private config: OrchestratorConfig;
  private conversationHistory: Map<string, ChatMessage[]> = new Map();

  constructor(
    llm: LLMProvider,
    skills: SkillLibrary,
    memory: Memory,
    toolRegistry: ToolRegistry,
    config: Partial<OrchestratorConfig> = {},
  ) {
    this.llm = llm;
    this.skills = skills;
    this.memory = memory;
    this.toolRegistry = toolRegistry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  /**
   * Main entry point — receive a user message, produce a response.
   * This is what transports call.
   */
  async handleMessage(userId: string, message: string): Promise<string> {
    const startTime = Date.now();
    metrics.record('orchestrator.message', 1);

    // 1. Get/create conversation history for this user
    if (!this.conversationHistory.has(userId)) {
      this.conversationHistory.set(userId, []);
    }
    const history = this.conversationHistory.get(userId)!;

    // 2. Retrieve relevant memory
    const memoryContext = await this.memory.retrieve(userId, message);

    // 3. Classify intent — use a fast, cheap model
    const intent = await this.classifyIntent(message, memoryContext);
    logger.info(`Intent: ${intent.domain} (${intent.complexity}) — "${intent.description}"`);

    // 4. Check skill library for relevant learned skills
    const relevantSkills = await this.skills.search(message, intent.domain);

    // 5. Route based on complexity
    let result: AgentResult;
    if (intent.complexity === 'complex' && intent.subTasks && intent.subTasks.length > 1) {
      result = await this.runParallelAgents(intent, history, relevantSkills, memoryContext);
    } else {
      result = await this.runSingleAgent(intent, history, relevantSkills, memoryContext, message);
    }
    // 6. Update conversation history
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: result.response });
    // Keep history manageable
    if (history.length > 100) {
      const compressed = await this.memory.compressHistory(history.slice(0, -40));
      this.conversationHistory.set(userId, [
        { role: 'system', content: `Previous context: ${compressed}` },
        ...history.slice(-40),
      ]);
    }

    // 7. Store to memory
    await this.memory.store(userId, message, result.response);

    // 8. Post-task reflection & skill creation
    if (this.config.reflectionEnabled && result.toolCalls >= this.config.skillAutoCreateThreshold) {
      this.triggerReflection(intent, result).catch(err =>
        logger.warn(`Reflection failed: ${err.message}`)
      );
    }

    metrics.record('orchestrator.latency_ms', Date.now() - startTime);
    metrics.record('orchestrator.tokens', result.tokensUsed);
    return result.response;
  }
  /**
   * Classify user intent using a fast model.
   * Returns domain, complexity, sub-tasks if complex.
   */
  private async classifyIntent(message: string, memoryContext: string): Promise<Intent> {
    const classifierModel = selectModel('conversation', 'cheap', 'realtime', this.llm.availableProviders);

    const prompt = `Classify this user message. Return ONLY valid JSON, no other text.
{
  "domain": one of "reasoning"|"coding"|"creative"|"factual"|"analysis"|"conversation"|"planning",
  "complexity": "simple"|"moderate"|"complex",
  "description": "brief task description",
  "requiredTools": ["tool names needed, from: search, code_exec, file_ops, browser"],
  "subTasks": [{"id":"t1","domain":"...","description":"...","dependsOn":[]}] // only if complex
}

User context: ${memoryContext.slice(0, 500)}
User message: "${message}"`;

    try {
      const resp = await this.llm.chat({
        model: classifierModel,
        systemPrompt: 'You are an intent classifier. Return ONLY JSON. No markdown, no explanation.',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 1024,
        jsonMode: true,
      });
      const parsed = JSON.parse(resp.content);
      return {
        domain: parsed.domain || 'conversation',
        complexity: parsed.complexity || 'simple',
        description: parsed.description || message.slice(0, 100),
        subTasks: parsed.subTasks,
        requiredTools: parsed.requiredTools || [],
      };
    } catch (err) {
      logger.warn(`Intent classification failed, defaulting to conversation: ${err}`);
      return { domain: 'conversation', complexity: 'simple', description: message.slice(0, 100), requiredTools: [] };
    }
  }
  /**
   * Build a system prompt dynamically from intent, skills, and memory.
   */
  private buildSystemPrompt(intent: Intent, skills: Skill[], memoryContext: string): string {
    let prompt = `You are a capable AI assistant. Your current task: ${intent.description}\n`;

    if (memoryContext) {
      prompt += `\nRelevant context from memory:\n${memoryContext}\n`;
    }

    if (skills.length > 0) {
      prompt += `\nRelevant learned skills:\n`;
      for (const skill of skills) {
        prompt += `--- ${skill.name} ---\n${skill.content.slice(0, 1000)}\n`;
      }
    }

    prompt += `\nBe concise but thorough. If you need tools, use them. Think step by step for complex tasks.`;
    return prompt;
  }

  /**
   * Run a single agent for simple/moderate tasks.
   */
  private async runSingleAgent(
    intent: Intent,
    history: ChatMessage[],
    skills: Skill[],
    memoryContext: string,
    userMessage: string,
  ): Promise<AgentResult> {
    const model = selectModel(
      intent.domain,
      this.config.defaultCostPreference,
      this.config.defaultLatencyPreference,
      this.llm.availableProviders,
    );

    const config = createAgentConfig({
      systemPrompt: this.buildSystemPrompt(intent, skills, memoryContext),
      model,
      tools: intent.requiredTools,
      maxIterations: intent.complexity === 'simple' ? 3 : 10,
    });

    logger.info(`Spawning agent ${config.id} with ${model.name} for ${intent.domain}`);
    return runAgent(config, userMessage, history, this.llm, this.toolRegistry);
  }
  /**
   * Run multiple agents in parallel for complex multi-step tasks.
   * Resolves dependencies: independent sub-tasks run concurrently,
   * dependent ones wait for their prerequisites.
   */
  private async runParallelAgents(
    intent: Intent,
    history: ChatMessage[],
    skills: Skill[],
    memoryContext: string,
  ): Promise<AgentResult> {
    const subTasks = intent.subTasks || [];
    const results = new Map<string, AgentResult>();
    const pending = new Set(subTasks.map(st => st.id));

    while (pending.size > 0) {
      // Find tasks whose dependencies are all resolved
      const ready = subTasks.filter(st =>
        pending.has(st.id) &&
        (!st.dependsOn || st.dependsOn.every(dep => results.has(dep)))
      );

      if (ready.length === 0) {
        logger.warn('Deadlock in sub-task dependencies, forcing remaining');
        break;
      }

      // Run ready tasks in parallel (up to maxParallelAgents)
      const batch = ready.slice(0, this.config.maxParallelAgents);
      const batchPromises = batch.map(async (subTask) => {
        const model = selectModel(
          subTask.domain,
          this.config.defaultCostPreference,
          this.config.defaultLatencyPreference,
          this.llm.availableProviders,
        );

        // Inject dependency results into context
        let depContext = '';
        if (subTask.dependsOn) {
          depContext = subTask.dependsOn
            .map(dep => `Result from subtask ${dep}: ${results.get(dep)?.response.slice(0, 500) || 'N/A'}`)
            .join('\n');
        }

        const config = createAgentConfig({
          systemPrompt: this.buildSystemPrompt(intent, skills, memoryContext + '\n' + depContext),
          model,
          tools: intent.requiredTools,
          maxIterations: 8,
        });

        logger.info(`Spawning sub-agent ${config.id} (${subTask.id}) with ${model.name}`);
        const result = await runAgent(config, subTask.description, history, this.llm, this.toolRegistry);
        return { id: subTask.id, result };
      });

      const batchResults = await Promise.all(batchPromises);
      for (const { id, result } of batchResults) {
        results.set(id, result);
        pending.delete(id);
      }
    }
    // Synthesize all sub-results into a final response
    return this.synthesizeResults(intent, [...results.values()], history);
  }

  /**
   * Combine multiple agent results into one coherent response.
   */
  private async synthesizeResults(
    intent: Intent,
    subResults: AgentResult[],
    history: ChatMessage[],
  ): Promise<AgentResult> {
    const synthModel = selectModel('reasoning', 'standard', 'fast', this.llm.availableProviders);
    const subSummaries = subResults.map((r, i) => `[Sub-task ${i + 1}] ${r.response.slice(0, 1000)}`).join('\n\n');

    const config = createAgentConfig({
      systemPrompt: `You are synthesizing results from multiple sub-agents into one coherent response.
Original task: ${intent.description}
Sub-task results follow. Combine them into a single, well-structured answer.`,
      model: synthModel,
      tools: [],
      maxIterations: 1,
    });

    const result = await runAgent(config, subSummaries, history, this.llm, this.toolRegistry);
    result.subAgentResults = subResults;
    result.tokensUsed += subResults.reduce((sum, r) => sum + r.tokensUsed, 0);
    return result;
  }
  /**
   * Post-task reflection: analyze what worked, create/update skills.
   * Runs async after response is sent — doesn't block the user.
   */
  private async triggerReflection(intent: Intent, result: AgentResult): Promise<void> {
    logger.info(`Reflecting on task: ${intent.description} (${result.toolCalls} tool calls)`);

    const reflectionModel = selectModel('analysis', 'cheap', 'standard', this.llm.availableProviders);

    const resp = await this.llm.chat({
      model: reflectionModel,
      systemPrompt: `You are a self-improvement system. Analyze this completed task and extract a reusable skill document.
Return JSON: { "skillName": "...", "description": "...", "steps": ["..."], "tools": ["..."], "tips": ["..."] }`,
      messages: [{
        role: 'user',
        content: `Task: ${intent.description}\nDomain: ${intent.domain}\nTool calls: ${result.toolCalls}\nResponse preview: ${result.response.slice(0, 500)}`,
      }],
      temperature: 0.3,
      maxTokens: 2048,
      jsonMode: true,
    });

    try {
      const skillData = JSON.parse(resp.content);
      await this.skills.createOrUpdate({
        name: skillData.skillName,
        domain: intent.domain,
        description: skillData.description,
        content: `# ${skillData.skillName}\n\n${skillData.description}\n\n## Steps\n${skillData.steps?.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') || ''}\n\n## Tools\n${skillData.tools?.join(', ') || 'none'}\n\n## Tips\n${skillData.tips?.map((t: string) => `- ${t}`).join('\n') || ''}`,
        usageCount: 1,
        lastUsed: Date.now(),
      });
      logger.info(`Skill created/updated: ${skillData.skillName}`);
    } catch (err) {
      logger.warn(`Skill extraction failed: ${err}`);
    }
  }
}

export default Orchestrator;
