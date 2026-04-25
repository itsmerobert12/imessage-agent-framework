/**
 * Multi-LLM Provider — Unified interface across all model providers
 * The orchestrator selects which model to use per-task based on:
 *   - Task complexity (simple Q&A vs multi-step reasoning)
 *   - Task type (coding, creative, analysis, factual)
 *   - Cost sensitivity
 *   - Latency requirements
 *   - Model strengths
 *
 * Supported providers:
 *   - Anthropic (Claude Opus, Sonnet, Haiku)
 *   - OpenAI (GPT-4o, GPT-4o-mini, o3, o4-mini)
 *   - OpenRouter (290+ models: DeepSeek, Qwen, Llama, Mistral, GLM, etc.)
 *   - Ollama (local models: Llama, Qwen, DeepSeek-Coder, Mistral, etc.)
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Ollama } from 'ollama';
import { logger } from '../state/observability';

// ── Model Registry ──────────────────────────────────────────────

export type TaskDomain = 'reasoning' | 'coding' | 'creative' | 'factual' | 'analysis' | 'conversation' | 'planning';
export type CostTier = 'free' | 'cheap' | 'standard' | 'premium';
export type LatencyTier = 'realtime' | 'fast' | 'standard' | 'slow';

export interface ModelProfile {
  id: string;
  provider: 'anthropic' | 'openai' | 'openrouter' | 'ollama';
  name: string;
  strengths: TaskDomain[];
  costTier: CostTier;
  latencyTier: LatencyTier;
  maxTokens: number;
  contextWindow: number;
}

/** Every model the system knows about — orchestrator picks from here */
export const MODEL_REGISTRY: ModelProfile[] = [
  // ── Anthropic ──
  { id: 'claude-opus-4-20250918', provider: 'anthropic', name: 'Claude Opus 4', strengths: ['reasoning', 'coding', 'analysis', 'planning'], costTier: 'premium', latencyTier: 'slow', maxTokens: 16384, contextWindow: 200000 },
  { id: 'claude-sonnet-4-20250514', provider: 'anthropic', name: 'Claude Sonnet 4', strengths: ['reasoning', 'coding', 'analysis', 'creative', 'planning'], costTier: 'standard', latencyTier: 'fast', maxTokens: 16384, contextWindow: 200000 },
  { id: 'claude-haiku-3-5-20241022', provider: 'anthropic', name: 'Claude Haiku 3.5', strengths: ['factual', 'conversation'], costTier: 'cheap', latencyTier: 'realtime', maxTokens: 8192, contextWindow: 200000 },
  // ── OpenAI ──
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', strengths: ['reasoning', 'coding', 'creative', 'analysis'], costTier: 'standard', latencyTier: 'fast', maxTokens: 16384, contextWindow: 128000 },
  { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini', strengths: ['factual', 'conversation', 'coding'], costTier: 'cheap', latencyTier: 'realtime', maxTokens: 16384, contextWindow: 128000 },
  { id: 'o3', provider: 'openai', name: 'o3', strengths: ['reasoning', 'coding', 'analysis', 'planning'], costTier: 'premium', latencyTier: 'slow', maxTokens: 100000, contextWindow: 200000 },
  { id: 'o4-mini', provider: 'openai', name: 'o4-mini', strengths: ['reasoning', 'coding'], costTier: 'standard', latencyTier: 'standard', maxTokens: 100000, contextWindow: 200000 },

  // ── OpenRouter (open-source models via API) ──
  { id: 'deepseek/deepseek-r1', provider: 'openrouter', name: 'DeepSeek R1', strengths: ['reasoning', 'coding', 'analysis'], costTier: 'cheap', latencyTier: 'standard', maxTokens: 8192, contextWindow: 128000 },
  { id: 'deepseek/deepseek-chat', provider: 'openrouter', name: 'DeepSeek V3', strengths: ['coding', 'conversation', 'factual'], costTier: 'cheap', latencyTier: 'fast', maxTokens: 8192, contextWindow: 128000 },
  { id: 'qwen/qwen3-235b-a22b', provider: 'openrouter', name: 'Qwen3 235B', strengths: ['reasoning', 'coding', 'analysis', 'creative'], costTier: 'cheap', latencyTier: 'standard', maxTokens: 8192, contextWindow: 131072 },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', provider: 'openrouter', name: 'Qwen 2.5 Coder 32B', strengths: ['coding'], costTier: 'cheap', latencyTier: 'fast', maxTokens: 8192, contextWindow: 32768 },
  { id: 'meta-llama/llama-4-maverick', provider: 'openrouter', name: 'Llama 4 Maverick', strengths: ['reasoning', 'creative', 'conversation'], costTier: 'cheap', latencyTier: 'fast', maxTokens: 8192, contextWindow: 1048576 },
  { id: 'meta-llama/llama-4-scout', provider: 'openrouter', name: 'Llama 4 Scout', strengths: ['factual', 'conversation'], costTier: 'free', latencyTier: 'fast', maxTokens: 8192, contextWindow: 512000 },
  { id: 'mistralai/mistral-large-2411', provider: 'openrouter', name: 'Mistral Large', strengths: ['reasoning', 'coding', 'analysis'], costTier: 'standard', latencyTier: 'fast', maxTokens: 8192, contextWindow: 128000 },
  { id: 'mistralai/devstral-small', provider: 'openrouter', name: 'Devstral Small', strengths: ['coding'], costTier: 'cheap', latencyTier: 'realtime', maxTokens: 8192, contextWindow: 128000 },
  { id: 'google/gemini-2.5-flash-preview', provider: 'openrouter', name: 'Gemini 2.5 Flash', strengths: ['reasoning', 'coding', 'factual'], costTier: 'cheap', latencyTier: 'realtime', maxTokens: 16384, contextWindow: 1048576 },

  // ── Ollama (local, free, private) ──
  { id: 'llama3.1:8b', provider: 'ollama', name: 'Llama 3.1 8B (local)', strengths: ['conversation', 'factual'], costTier: 'free', latencyTier: 'fast', maxTokens: 4096, contextWindow: 131072 },
  { id: 'qwen2.5-coder:7b', provider: 'ollama', name: 'Qwen 2.5 Coder 7B (local)', strengths: ['coding'], costTier: 'free', latencyTier: 'fast', maxTokens: 4096, contextWindow: 32768 },
  { id: 'deepseek-coder-v2', provider: 'ollama', name: 'DeepSeek Coder v2 (local)', strengths: ['coding', 'reasoning'], costTier: 'free', latencyTier: 'standard', maxTokens: 4096, contextWindow: 128000 },
  { id: 'mistral:7b', provider: 'ollama', name: 'Mistral 7B (local)', strengths: ['conversation', 'factual', 'creative'], costTier: 'free', latencyTier: 'fast', maxTokens: 4096, contextWindow: 32768 },
  { id: 'gemma3:12b', provider: 'ollama', name: 'Gemma 3 12B (local)', strengths: ['reasoning', 'conversation'], costTier: 'free', latencyTier: 'standard', maxTokens: 4096, contextWindow: 131072 },
];

// ── Types ───────────────────────────────────────────────────────

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface LLMRequest {
  model: ModelProfile;
  systemPrompt: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  jsonMode?: boolean;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed: number;
  latencyMs: number;
}

// ── Model Selector — the orchestrator calls this ────────────────

export function selectModel(
  domain: TaskDomain,
  costPreference: CostTier = 'standard',
  latencyPreference: LatencyTier = 'fast',
  availableProviders: Set<string> = new Set(['anthropic', 'openai', 'openrouter', 'ollama'])
): ModelProfile {
  const candidates = MODEL_REGISTRY
    .filter(m => availableProviders.has(m.provider))
    .filter(m => m.strengths.includes(domain))
    .sort((a, b) => {
      // Score: strength match count + cost alignment + latency alignment
      const costOrder: Record<CostTier, number> = { free: 0, cheap: 1, standard: 2, premium: 3 };
      const latOrder: Record<LatencyTier, number> = { realtime: 0, fast: 1, standard: 2, slow: 3 };
      const costPref = costOrder[costPreference];
      const aCostDist = Math.abs(costOrder[a.costTier] - costPref);
      const bCostDist = Math.abs(costOrder[b.costTier] - costPref);
      const latPref = latOrder[latencyPreference];
      const aLatDist = Math.abs(latOrder[a.latencyTier] - latPref);
      const bLatDist = Math.abs(latOrder[b.latencyTier] - latPref);
      // Strength count for domain (secondary)
      const aStrength = a.strengths.length;
      const bStrength = b.strengths.length;
      // Lower distance = better match
      const aScore = aCostDist * 3 + aLatDist * 2 - aStrength;
      const bScore = bCostDist * 3 + bLatDist * 2 - bStrength;
      return aScore - bScore;
    });
  return candidates[0] || MODEL_REGISTRY[1]; // fallback to Claude Sonnet
}

// ── LLM Provider — executes requests against any provider ───────

export class LLMProvider {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
  private openrouter: OpenAI | null = null;
  private ollama: Ollama | null = null;
  public availableProviders: Set<string> = new Set();

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      this.availableProviders.add('anthropic');
    }
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      this.availableProviders.add('openai');
    }
    if (process.env.OPENROUTER_API_KEY) {
      this.openrouter = new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
      });
      this.availableProviders.add('openrouter');
    }
    if (process.env.OLLAMA_HOST || process.env.OLLAMA_ENABLED === 'true') {
      this.ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });
      this.availableProviders.add('ollama');
    }
    logger.info(`LLM providers available: ${[...this.availableProviders].join(', ') || 'NONE — set API keys!'}`);
  }

  async chat(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    let result: LLMResponse;

    switch (req.model.provider) {
      case 'anthropic': result = await this.chatAnthropic(req); break;
      case 'openai': result = await this.chatOpenAI(req, this.openai!); break;
      case 'openrouter': result = await this.chatOpenAI(req, this.openrouter!); break;
      case 'ollama': result = await this.chatOllama(req); break;
      default: throw new Error(`Unknown provider: ${req.model.provider}`);
    }

    result.latencyMs = Date.now() - start;
    logger.info(`[${req.model.provider}] ${req.model.name}: ${result.tokensUsed} tokens, ${result.latencyMs}ms`);
    return result;
  }

  private async chatAnthropic(req: LLMRequest): Promise<LLMResponse> {
    const resp = await this.anthropic!.messages.create({
      model: req.model.id,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system: req.systemPrompt,
      messages: req.messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });
    const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
    return { content: text, model: req.model.id, provider: 'anthropic', tokensUsed: resp.usage.input_tokens + resp.usage.output_tokens, latencyMs: 0 };
  }

  private async chatOpenAI(req: LLMRequest, client: OpenAI): Promise<LLMResponse> {
    const resp = await client.chat.completions.create({
      model: req.model.id,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      ...(req.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      messages: [
        { role: 'system' as const, content: req.systemPrompt },
        ...req.messages.map(m => ({ role: m.role, content: m.content })),
      ],
    });
    const text = resp.choices[0]?.message?.content || '';
    return { content: text, model: req.model.id, provider: req.model.provider, tokensUsed: resp.usage?.total_tokens || 0, latencyMs: 0 };
  }

  private async chatOllama(req: LLMRequest): Promise<LLMResponse> {
    const resp = await this.ollama!.chat({
      model: req.model.id,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages,
      ],
      options: { temperature: req.temperature, num_predict: req.maxTokens },
    });
    return { content: resp.message.content, model: req.model.id, provider: 'ollama', tokensUsed: (resp.eval_count || 0) + (resp.prompt_eval_count || 0), latencyMs: 0 };
  }
}

export default LLMProvider;
