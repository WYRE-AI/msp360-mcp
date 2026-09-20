import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getLicense, listLicenses } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const LICENSES_TOOLS: Tool[] = [
  {
    name: 'msp360_list_licenses',
    description: 'List available MSP360 licenses, optionally filtered to only unassigned ones.',
    inputSchema: {
      type: 'object',
      properties: { isAvailable: { type: 'boolean', description: 'Only return unassigned licenses.' } },
    },
  },
  {
    name: 'msp360_get_license',
    description: 'Get a single MSP360 license by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'License unique identifier.' } },
      required: ['id'],
    },
  },
];

export async function handleLicensesTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'msp360_list_licenses') {
      return textResult(await listLicenses(creds!, args.isAvailable as boolean | undefined));
    }

    if (name === 'msp360_get_license') {
      const id = args.id as string;
      if (!id) return errorResult('id is required.');
      return textResult(await getLicense(creds!, id));
    }

    return errorResult(`Unknown licenses tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
