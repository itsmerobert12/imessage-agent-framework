/**
 * Image Generator - Generate images and send via iMessage
 * Uses OpenAI DALL-E for generation
 */

import { logger } from './observability';

export class ImageGenerator {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
  }

  async generate(prompt: string, size: string = '512x512'): Promise<string | null> {
    if (!this.apiKey) {
      logger.warn('Image generation requires OPENAI_API_KEY');
      return null;
    }
    try {
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ prompt, n: 1, size }),
      });
      const data = await resp.json() as any;
      return data.data?.[0]?.url || null;
    } catch (error: any) {
      logger.error(`Image generation error: ${error.message}`);
      return null;
    }
  }
}

export default ImageGenerator;
