import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  getCredentials,
  getPlan,
  getPlanHistory,
  getPlanInfo,
  listPlans,
  startPlan,
  stopPlan,
} from '../client.js';
import type { CallToolResult } from './types.js';
import { errorResult, requireCredentials, textResult } from './shared.js';

export const PLANS_TOOLS: Tool[] = [
  {
    name: 'msp360_list_plans',
    description: 'List backup/restore plans configured on a computer.',
    inputSchema: {
      type: 'object',
      properties: { hid: { type: 'string', description: 'HID of the computer.' } },
      required: ['hid'],
    },
  },
  {
    name: 'msp360_get_plan',
    description: 'Get a single backup/restore plan on a computer by plan ID.',
    inputSchema: {
      type: 'object',
      properties: {
        hid: { type: 'string', description: 'HID of the computer.' },
        id: { type: 'string', description: 'Plan ID (GUID).' },
      },
      required: ['hid', 'id'],
    },
  },
  {
    name: 'msp360_get_plan_info',
    description: 'Get status/info for a backup/restore plan on a computer.',
    inputSchema: {
      type: 'object',
      properties: {
        hid: { type: 'string', description: 'HID of the computer.' },
        id: { type: 'string', description: 'Plan ID (GUID).' },
      },
      required: ['hid', 'id'],
    },
  },
  {
    name: 'msp360_get_plan_history',
    description: 'Get run history for a backup/restore plan on a computer, optionally filtered to a specific date.',
    inputSchema: {
      type: 'object',
      properties: {
        hid: { type: 'string', description: 'HID of the computer.' },
        id: { type: 'string', description: 'Plan ID (GUID).' },
        year: { type: 'number', description: 'Filter year (2023-9999).' },
        month: { type: 'number', description: 'Filter month (1-12).' },
        day: { type: 'number', description: 'Filter day (1-31).' },
      },
      required: ['hid', 'id'],
    },
  },
  {
    name: 'msp360_start_plan',
    description: 'Start a backup run for a plan on a computer.',
    inputSchema: {
      type: 'object',
      properties: {
        hid: { type: 'string', description: 'HID of the computer.' },
        id: { type: 'string', description: 'Plan ID (GUID).' },
        mode: { type: 'string', description: 'Vendor-defined run mode, if applicable.' },
      },
      required: ['hid', 'id'],
    },
  },
  {
    name: 'msp360_stop_plan',
    description: 'Stop a currently running backup for a plan on a computer.',
    inputSchema: {
      type: 'object',
      properties: {
        hid: { type: 'string', description: 'HID of the computer.' },
        id: { type: 'string', description: 'Plan ID (GUID).' },
        force: { type: 'boolean', description: 'Force-stop the run.' },
      },
      required: ['hid', 'id'],
    },
  },
];

export async function handlePlansTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const creds = getCredentials();
  const missing = requireCredentials(creds);
  if (missing) return missing;

  const hid = args.hid as string;
  const id = args.id as string | undefined;

  try {
    if (name === 'msp360_list_plans') {
      if (!hid) return errorResult('hid is required.');
      return textResult(await listPlans(creds!, hid));
    }

    if (name === 'msp360_get_plan') {
      if (!hid) return errorResult('hid is required.');
      if (!id) return errorResult('id is required.');
      return textResult(await getPlan(creds!, hid, id));
    }

    if (name === 'msp360_get_plan_info') {
      if (!hid) return errorResult('hid is required.');
      if (!id) return errorResult('id is required.');
      return textResult(await getPlanInfo(creds!, hid, id));
    }

    if (name === 'msp360_get_plan_history') {
      if (!hid) return errorResult('hid is required.');
      if (!id) return errorResult('id is required.');
      return textResult(
        await getPlanHistory(creds!, hid, id, {
          year: args.year as number | undefined,
          month: args.month as number | undefined,
          day: args.day as number | undefined,
        })
      );
    }

    if (name === 'msp360_start_plan') {
      if (!hid) return errorResult('hid is required.');
      if (!id) return errorResult('id is required.');
      return textResult(await startPlan(creds!, hid, id, args.mode as string | undefined));
    }

    if (name === 'msp360_stop_plan') {
      if (!hid) return errorResult('hid is required.');
      if (!id) return errorResult('id is required.');
      return textResult(await stopPlan(creds!, hid, id, args.force as boolean | undefined));
    }

    return errorResult(`Unknown plans tool: ${name}`);
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
