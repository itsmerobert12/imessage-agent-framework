/**
 * Web Search Tool — uses fetch to search via DuckDuckGo HTML
 */

import { Tool, ToolResult } from './registry';

async function webSearch(query: string, maxResults: number = 5): Promise<ToolResult> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentFramework/2.0)' },
    });
    const html = await resp.text();

    // Extract result snippets from DDG HTML
    const results: string[] = [];
    const regex = /<a rel="nofollow" class="result__a"[^>]*>(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < maxResults) {
      const title = match[1].replace(/<[^>]+>/g, '').trim();
      const snippet = match[2].replace(/<[^>]+>/g, '').trim();
      if (title && snippet) results.push(`${title}: ${snippet}`);
    }

    return { output: results.length > 0 ? results.join('\n\n') : 'No results found.' };
  } catch (err: any) {
    return { output: '', error: `Search failed: ${err.message}` };
  }
}
export const searchTool: Tool = {
  name: 'search',
  description: 'Search the web for information. Returns top results with snippets.',
  schema: {
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Max results (default 5)', optional: true },
  },
  execute: async (args) => webSearch(args.query, args.maxResults || 5),
};
