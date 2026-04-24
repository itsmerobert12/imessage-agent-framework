/**
 * Streaming - Real-time response streaming support
 * Enables chunked responses for long agent outputs
 */

import { logger } from './observability';

export class StreamingHandler {
  private chunkSize: number;

  constructor(chunkSize: number = 160) {
    this.chunkSize = chunkSize;
  }

  /** Split long response into iMessage-sized chunks */
  chunkResponse(text: string): string[] {
    if (text.length <= this.chunkSize) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      // Try to break at sentence or word boundary
      let end = Math.min(remaining.length, this.chunkSize);
      if (end < remaining.length) {
        const lastPeriod = remaining.lastIndexOf('.', end);
        const lastSpace = remaining.lastIndexOf(' ', end);
        if (lastPeriod > end * 0.5) end = lastPeriod + 1;
        else if (lastSpace > end * 0.5) end = lastSpace;
      }
      chunks.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    return chunks;
  }

  /** Stream callback for progressive responses */
  async streamToCallback(
    text: string,
    callback: (chunk: string, index: number, total: number) => Promise<void>
  ): Promise<void> {
    const chunks = this.chunkResponse(text);
    for (let i = 0; i < chunks.length; i++) {
      await callback(chunks[i], i, chunks.length);
    }
  }
}

export default StreamingHandler;
