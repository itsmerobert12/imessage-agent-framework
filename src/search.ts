/**
 * Search Provider - Web search capabilities for agents
 * Supports Tavily API with fallback to basic fetch
 */

import { logger } from './observability';

export class SearchProvider {
  private tavilyKey: string | undefined;

  constructor() {
    this.tavilyKey = process.env.TAVILY_KEY;
  }

  async search(query: string, maxResults: number = 3): Promise<string> {
    if (this.tavilyKey) return this.searchTavily(query, maxResults);
    return this.searchFallback(query);
  }

  private async searchTavily(query: string, maxResults: number): Promise<string> {
    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.tavilyKey,
          query, max_results: maxResults,
          include_answer: true,
        }),
      });
      const data = await resp.json() as any;
      if (data.answer) return data.answer;
      return (data.results || [])
        .map((r: any) => `${r.title}: ${r.content}`)
        .join('\n\n');
    } catch (error: any) {
      logger.error(`Tavily search error: ${error.message}`);
      return `Search failed: ${error.message}`;
    }
  }

  private async searchFallback(query: string): Promise<string> {
    logger.info('No Tavily key - using fallback search notice');
    return `[Web search not available - set TAVILY_KEY for search. Query was: "${query}"]`;
  }
}

export default SearchProvider;
