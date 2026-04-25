/**
 * Agent Runtime — NOT a class hierarchy. An agent is a runtime config.
 * The orchestrator assembles one on the fly from:
 *   - intent classification
 *   - relevant skills from the skill library
 *   - user memory/preferences
 *   - model selection based on task domain
 * Then executes it, collects results, and dissolves it.
 */

import { LLMProvider, LLMRequest, LLMResponse, ModelProfile, ChatMessage } from './llm';
import { ToolRegistry, ToolResult } from '../tools/registry';
import { logger } from '../state/observability';
import { v4 as uuidv4 } from 'uuid';

export interface AgentConfig {
  /** Generated on the fly — not a predefined type */
  id: string;
  /** Assembled from intent + skills + user context */
  systemPrompt: string;
  /** Orchestrator picks this based on task domain */
  model: ModelProfile;
  /** Scoped to what this task needs */
  tools: string[];
  temperature: number;
  maxTokens: number;
  /** Parent agent ID if this is a sub-agent */
  parentId?: string;
  /** Max tool-call iterations before forcing a response */
  maxIterations: number;
}

export interface AgentResult {
  agentId: string;
  response: string;
  toolCalls: number;
  model: string;
  provider: string;
  tokensUsed: number;
  latencyMs: number;
  subAgentResults: AgentResult[];
}

/**
 * Run an agent to completion.
 * This is a function, not a class — agents are ephemeral.
 * The agentic loop: prompt → LLM → check for tool calls → execute tools → re-prompt → repeat
 */
export async function runAgent(
  config: AgentConfig,
  userMessage: string,
  conversationHistory: ChatMessage[],
  llm: LLMProvider,
  toolRegistry: ToolRegistry,
): Promise<AgentResult> {
  const startTime = Date.now();
  let totalTokens = 0;
  let toolCallCount = 0;
  const subAgentResults: AgentResult[] = [];

  // Build message history for this agent run
  const messages: ChatMessage[] = [
    ...conversationHistory.slice(-20), // last 20 messages for context
    { role: 'user', content: userMessage },
  ];

  // Build tool descriptions for the system prompt
  const availableTools = config.tools
    .map(name => toolRegistry.getTool(name))
    .filter(Boolean);

  const toolSection = availableTools.length > 0
    ? `\n\nYou have these tools available. To use a tool, respond with a JSON block:\n\`\`\`tool\n{"tool": "tool_name", "args": { ... }}\n\`\`\`\n\nAvailable tools:\n${availableTools.map(t => `- ${t!.name}: ${t!.description}. Args: ${JSON.stringify(t!.schema)}`).join('\n')}\n\nIf you don't need a tool, just respond normally.`
    : '';

  const fullSystemPrompt = config.systemPrompt + toolSection;

  // Agentic loop
  let iteration = 0;
  while (iteration < config.maxIterations) {
    iteration++;

    const response = await llm.chat({
      model: config.model,
      systemPrompt: fullSystemPrompt,
      messages,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    });

    totalTokens += response.tokensUsed;

    // Check if response contains a tool call
    const toolCall = extractToolCall(response.content);

    if (!toolCall) {
      // No tool call — agent is done, return final response
      return {
        agentId: config.id,
        response: response.content,
        toolCalls: toolCallCount,
        model: response.model,
        provider: response.provider,
        tokensUsed: totalTokens,
        latencyMs: Date.now() - startTime,
        subAgentResults,
      };
    }

    // Execute the tool
    toolCallCount++;
    logger.info(`Agent ${config.id} calling tool: ${toolCall.tool}(${JSON.stringify(toolCall.args).slice(0, 100)})`);

    try {
      const result = await toolRegistry.execute(toolCall.tool, toolCall.args);
      // Feed result back into conversation for next iteration
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: `Tool "${toolCall.tool}" returned:\n${result.output}` });
    } catch (err: any) {
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: `Tool "${toolCall.tool}" failed: ${err.message}` });
    }
  }

  // Max iterations reached — return last response
  const finalResp = await llm.chat({
    model: config.model,
    systemPrompt: fullSystemPrompt + '\n\nYou have reached the maximum number of tool calls. Provide your best final answer now.',
    messages,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });
  totalTokens += finalResp.tokensUsed;

  return {
    agentId: config.id,
    response: finalResp.content,
    toolCalls: toolCallCount,
    model: finalResp.model,
    provider: finalResp.provider,
    tokensUsed: totalTokens,
    latencyMs: Date.now() - startTime,
    subAgentResults,
  };
}

/** Extract a tool call from LLM response text */
function extractToolCall(text: string): { tool: string; args: Record<string, any> } | null {
  // Match ```tool\n{...}\n``` blocks
  const match = text.match(/```tool\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.tool && typeof parsed.tool === 'string') {
      return { tool: parsed.tool, args: parsed.args || {} };
    }
  } catch { /* not valid JSON */ }
  return null;
}

/** Create a default agent config — orchestrator overrides everything */
export function createAgentConfig(overrides: Partial<AgentConfig> & { systemPrompt: string; model: ModelProfile }): AgentConfig {
  return {
    id: uuidv4().slice(0, 8),
    tools: [],
    temperature: 0.7,
    maxTokens: 4096,
    maxIterations: 10,
    ...overrides,
  };
}
