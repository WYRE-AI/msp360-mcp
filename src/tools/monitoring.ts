import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCredentials, getMonitoring, getMonitoringForUser } from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const MONITORING_TOOLS: Tool[] = [
  {
    name: 'msp360_get_monitoring',
    description: 'Get status data for the latest backup plan runs on all endpoints (account-wide health/alerts).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'msp360_get_monitoring_for_user',
    description: 'Get status data for the latest backup plan runs on online endpoints, filtered to a specific user.',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string', description: 'Existing user ID.' } },
      required: ['userId'],
    },
  },
];

export async function handleMonitoringTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  try {
    if (name === 'msp360_get_monitoring') {
      return textResult(await getMonitoring(creds!));
    }

    if (name === 'msp360_get_monitoring_for_user') {
      const userId = args.userId as string;
      if (!userId) return errorResult('userId is required.');
      return textResult(await getMonitoringForUser(creds!, userId));
    }

    return errorResult(`Unknown monitoring tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
