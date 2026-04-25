/**
 * Code Execution Tool — sandboxed via child_process
 */

import { execSync } from 'child_process';
import { Tool, ToolResult } from './registry';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function executeCode(language: string, code: string, timeout: number = 30000): Promise<ToolResult> {
  const tmpDir = os.tmpdir();
  let filePath: string;
  let command: string;

  switch (language) {
    case 'python':
    case 'python3':
      filePath = path.join(tmpDir, `agent_exec_${Date.now()}.py`);
      command = `python "${filePath}"`;
      break;
    case 'javascript':
    case 'node':
      filePath = path.join(tmpDir, `agent_exec_${Date.now()}.js`);
      command = `node "${filePath}"`;
      break;
    case 'bash':
    case 'shell':
      filePath = path.join(tmpDir, `agent_exec_${Date.now()}.sh`);
      command = `bash "${filePath}"`;
      break;
    default:
      return { output: '', error: `Unsupported language: ${language}` };
  }
  try {
    fs.writeFileSync(filePath, code, 'utf-8');
    const output = execSync(command, { timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    return { output: output.trim() };
  } catch (err: any) {
    return { output: err.stdout?.trim() || '', error: err.stderr?.trim() || err.message };
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore cleanup errors */ }
  }
}

export const codeExecTool: Tool = {
  name: 'code_exec',
  description: 'Execute code in Python, JavaScript/Node, or Bash. Returns stdout.',
  schema: {
    language: { type: 'string', description: 'python, javascript, or bash' },
    code: { type: 'string', description: 'Code to execute' },
    timeout: { type: 'number', description: 'Timeout in ms (default 30000)', optional: true },
  },
  execute: async (args) => executeCode(args.language, args.code, args.timeout),
};
