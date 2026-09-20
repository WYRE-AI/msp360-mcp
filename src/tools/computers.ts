import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getComputer, getCredentials, listComputers } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const COMPUTERS_TOOLS: Tool[] = [
  {
    name: 'msp360_list_computers',
    description: 'List managed computers (endpoints), paginated by offset/count.',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'number', description: 'Number of computers to skip before retrieving.' },
        count: { type: 'number', description: 'Number of computers to retrieve.' },
      },
      required: ['offset', 'count'],
    },
  },
  {
    name: 'msp360_get_computer',
    description: 'Get a single managed computer by its HID.',
    inputSchema: {
      type: 'object',
      properties: { hid: { type: 'string', description: 'HID of the computer.' } },
      required: ['hid'],
    },
  },
];

export async function handleComputersTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'msp360_list_computers') {
      const offset = args.offset as number;
      const count = args.count as number;
      if (offset === undefined || offset === null) return errorResult('offset is required.');
      if (count === undefined || count === null) return errorResult('count is required.');
      return textResult(await listComputers(creds!, offset, count));
    }

    if (name === 'msp360_get_computer') {
      const hid = args.hid as string;
      if (!hid) return errorResult('hid is required.');
      return textResult(await getComputer(creds!, hid));
    }

    return errorResult(`Unknown computers tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
