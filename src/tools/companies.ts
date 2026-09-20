import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCompany, getCredentials, listCompanies } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const COMPANIES_TOOLS: Tool[] = [
  {
    name: 'msp360_list_companies',
    description: 'List all companies (customer organizations) managed under this MSP360 provider account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'msp360_get_company',
    description: 'Get a single MSP360 company by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Company ID (GUID).' } },
      required: ['id'],
    },
  },
];

export async function handleCompaniesTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'msp360_list_companies') {
      return textResult(await listCompanies(creds!));
    }

    if (name === 'msp360_get_company') {
      const id = args.id as string;
      if (!id) return errorResult('id is required.');
      return textResult(await getCompany(creds!, id));
    }

    return errorResult(`Unknown companies tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
