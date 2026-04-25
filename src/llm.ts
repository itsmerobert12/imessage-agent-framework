/**
 * LLM Provider - Claude + ChatGPT support
 * Unified interface for multiple AI model providers
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from './state/observability';

export interface ChatRequest {
  model: 'smart' | 'fast' | 'creative';
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed: number;
}

const MODEL_MAP = {
  smart: { anthropic: 'claude-sonnet-4-20250514', openai: 'gpt-4o' },
  fast: { anthropic: 'claude-haiku-3-5-20241022', openai: 'gpt-4o-mini' },
  creative: { anthropic: 'claude-sonnet-4-20250514', openai: 'gpt-4o' },
};

export class LLMProvider {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;
  private preferredProvider: 'anthropic' | 'openai';

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    this.preferredProvider = this.anthropic ? 'anthropic' : 'openai';
    if (!this.anthropic && !this.openai) {
      logger.warn('No LLM API keys configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
    }
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    if (this.preferredProvider === 'anthropic' && this.anthropic) {
      return this.chatAnthropic(request);
    } else if (this.openai) {
      return this.chatOpenAI(request);
    }
    throw new Error('No LLM provider available');
  }

  private async chatAnthropic(req: ChatRequest): Promise<LLMResponse> {
    const modelId = MODEL_MAP[req.model].anthropic;
    try {
      const response = await this.anthropic!.messages.create({
        model: modelId,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.systemPrompt,
        messages: req.messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      logger.info(`Anthropic ${modelId}: ${response.usage.input_tokens}+${response.usage.output_tokens} tokens`);
      return {
        content: text,
        model: modelId,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      };
    } catch (error: any) {
      logger.error(`Anthropic error: ${error.message}`);
      if (this.openai) return this.chatOpenAI(req); // fallback
      throw error;
    }
  }

  private async chatOpenAI(req: ChatRequest): Promise<LLMResponse> {
    const modelId = MODEL_MAP[req.model].openai;
    try {
      const response = await this.openai!.chat.completions.create({
        model: modelId,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system' as const, content: req.systemPrompt },
          ...req.messages.map(m => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
        ],
      });
      const text = response.choices[0]?.message?.content || '';
      const tokens = response.usage?.total_tokens || 0;
      logger.info(`OpenAI ${modelId}: ${tokens} tokens`);
      return { content: text, model: modelId, tokensUsed: tokens };
    } catch (error: any) {
      logger.error(`OpenAI error: ${error.message}`);
      throw error;
    }
  }
}

export default LLMProvider;
