import { logger } from '../state/observability';

export interface Tool {
  name: string;
  description: string;
  schema: Record<string, any>;
  execute: (args: Record<string, any>) => Promise<ToolResult>;
}

export interface ToolResult {
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    logger.debug(`Tool registered: ${tool.name}`);
  }

  registerMany(tools: Tool[]): void {
    tools.forEach(t => this.register(t));
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }

  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { output: '', error: `Unknown tool: ${name}. Available: ${this.listNames().join(', ')}` };
    }
    try {
      const result = await tool.execute(args);
      logger.debug(`Tool ${name} OK: ${result.output.slice(0, 80)}`);
      return result;
    } catch (err: any) {
      logger.warn(`Tool ${name} failed: ${err.message}`);
      return { output: '', error: err.message };
    }
  }
}
