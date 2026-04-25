/**
 * Browser/Fetch Tool — fetch web pages and extract text content
 */

import { Tool, ToolResult } from './registry';

async function fetchPage(url: string, extractText: boolean = true): Promise<ToolResult> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentFramework/2.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { output: '', error: `HTTP ${resp.status}: ${resp.statusText}` };

    const html = await resp.text();
    if (!extractText) return { output: html };

    // Strip HTML tags, scripts, styles for text extraction
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);

    return { output: text };
  } catch (err: any) {
    return { output: '', error: `Fetch failed: ${err.message}` };
  }
}

export const browserTool: Tool = {
  name: 'browser',
  description: 'Fetch a URL and extract its text content. Can also return raw HTML.',
  schema: {
    url: { type: 'string', description: 'URL to fetch' },
    extractText: { type: 'boolean', description: 'Extract text only (default true)', optional: true },
  },
  execute: async (args) => fetchPage(args.url, args.extractText !== false),
};
