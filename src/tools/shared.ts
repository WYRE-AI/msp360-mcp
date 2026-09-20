import type { Msp360Credentials } from '../types.js';
import type { CallToolResult } from './types.js';

export function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Returns an error CallToolResult if credentials are missing, else null. */
export function requireCredentials(creds: Msp360Credentials | null): CallToolResult | null {
  if (!creds) {
    return errorResult('No MSP360 credentials configured. Set MSP360_USERNAME and MSP360_PASSWORD.');
  }
  return null;
}
