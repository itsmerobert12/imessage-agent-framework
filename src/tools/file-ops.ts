/**
 * File Operations Tool — read, write, list files
 */

import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolResult } from './registry';

async function fileOp(operation: string, filePath: string, content?: string): Promise<ToolResult> {
  try {
    switch (operation) {
      case 'read':
        if (!fs.existsSync(filePath)) return { output: '', error: `File not found: ${filePath}` };
        return { output: fs.readFileSync(filePath, 'utf-8') };
      case 'write':
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content || '', 'utf-8');
        return { output: `Written to ${filePath}` };
      case 'append':
        fs.appendFileSync(filePath, content || '', 'utf-8');
        return { output: `Appended to ${filePath}` };
      case 'list': {
        const entries = fs.readdirSync(filePath, { withFileTypes: true });
        const listing = entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
        return { output: listing };
      }
      case 'exists':
        return { output: fs.existsSync(filePath) ? 'true' : 'false' };
      default:
        return { output: '', error: `Unknown operation: ${operation}` };
    }
  } catch (err: any) {
    return { output: '', error: err.message };
  }
}

export const fileOpsTool: Tool = {
  name: 'file_ops',
  description: 'File operations: read, write, append, list, exists.',
  schema: {
    operation: { type: 'string', description: 'read, write, append, list, or exists' },
    path: { type: 'string', description: 'File or directory path' },
    content: { type: 'string', description: 'Content for write/append', optional: true },
  },
  execute: async (args) => fileOp(args.operation, args.path, args.content),
};
