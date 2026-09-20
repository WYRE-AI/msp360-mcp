import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { COMPANIES_TOOLS, handleCompaniesTool } from './companies.js';
import { COMPUTERS_TOOLS, handleComputersTool } from './computers.js';
import { PLANS_TOOLS, handlePlansTool } from './plans.js';
import { MONITORING_TOOLS, handleMonitoringTool } from './monitoring.js';
import { LICENSES_TOOLS, handleLicensesTool } from './licenses.js';
import type { CallToolResult } from './types.js';

export const ALL_TOOLS: Tool[] = [
  ...COMPANIES_TOOLS,
  ...COMPUTERS_TOOLS,
  ...PLANS_TOOLS,
  ...MONITORING_TOOLS,
  ...LICENSES_TOOLS,
];

const COMPANIES_NAMES = new Set(COMPANIES_TOOLS.map((t) => t.name));
const COMPUTERS_NAMES = new Set(COMPUTERS_TOOLS.map((t) => t.name));
const PLANS_NAMES = new Set(PLANS_TOOLS.map((t) => t.name));
const MONITORING_NAMES = new Set(MONITORING_TOOLS.map((t) => t.name));
const LICENSES_NAMES = new Set(LICENSES_TOOLS.map((t) => t.name));

export async function dispatchToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (COMPANIES_NAMES.has(name)) return handleCompaniesTool(name, args);
  if (COMPUTERS_NAMES.has(name)) return handleComputersTool(name, args);
  if (PLANS_NAMES.has(name)) return handlePlansTool(name, args);
  if (MONITORING_NAMES.has(name)) return handleMonitoringTool(name, args);
  if (LICENSES_NAMES.has(name)) return handleLicensesTool(name, args);
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}
