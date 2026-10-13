/**
 * HTTP transport fail-closed auth (CWE-306).
 *
 * Startup requires a real CONDUIT_S2S_SECRET unless MCP_ALLOW_INSECURE_DEV=1.
 * Known placeholder secrets always refuse to start. The dev bypass binds
 * 127.0.0.1 only. /mcp rejects a missing or invalid X-Gateway-S2S header.
 * AUTH_MODE=gateway rejects requests that omit vendor credential headers
 * and must not fall back to MSP360_* in process.env.
 */

import { createHmac } from 'node:crypto';
import { request as httpRequest, type Server as HttpServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../client.js';
import { jsonResponse } from './test-helpers.js';
import { startHttpTransport } from '../http.js';

const S2S_SECRET = 's2s-do-not-log-7f3a9c';
const ENV_USERNAME = 'env-user-must-not-be-used';
const ENV_PASSWORD = 'env-pass-must-not-be-used';

const ENV_KEYS = [
  'CONDUIT_S2S_SECRET',
  'MCP_ALLOW_INSECURE_DEV',
  'MCP_HTTP_PORT',
  'MCP_HTTP_HOST',
  'AUTH_MODE',
  'MCP_TRANSPORT',
  'MSP360_USERNAME',
  'MSP360_PASSWORD',
  'LOG_LEVEL',
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

const servers: HttpServer[] = [];

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  return {
    text: () => lines.join('\n'),
    restore: () => spy.mockRestore(),
  };
}

function installExitSpy() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code ?? ''}`);
  }) as typeof process.exit);
}

function assertNoSecrets(text: string): void {
  expect(text).not.toContain(S2S_SECRET);
  expect(text).not.toContain(ENV_USERNAME);
  expect(text).not.toContain(ENV_PASSWORD);
}

function useCredentialEnv(): void {
  process.env.MSP360_USERNAME = ENV_USERNAME;
  process.env.MSP360_PASSWORD = ENV_PASSWORD;
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.setTimeout(5000, () => {
      req.destroy(new Error(`timeout ${options.method} ${options.path}`));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  };
}

const companiesCall = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'msp360_list_companies', arguments: {} },
});

async function listen(): Promise<{ server: HttpServer; port: number; address: string }> {
  process.env.MCP_HTTP_PORT = '0';
  const server = await startHttpTransport();
  servers.push(server);
  const info = server.address();
  if (!info || typeof info === 'string') {
    throw new Error('expected a TCP listen address');
  }
  return { server, port: info.port, address: info.address };
}

function loginUserName(fetchMock: ReturnType<typeof vi.fn>): string | undefined {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  if (!init?.body) return undefined;
  return (JSON.parse(init.body) as { UserName?: string }).UserName;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }
  restoreEnv();
});

describe('HTTP startup fails closed without CONDUIT_S2S_SECRET', () => {
  it('logs an error and exits when the secret is unset', async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.MCP_HTTP_PORT = '0';
    useCredentialEnv();

    const logs = captureStderr();
    const exitSpy = installExitSpy();
    await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const logged = logs.text();
    expect(logged).toContain('Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty.');
    expect(logged).toContain('CWE-306');
    expect(logged).toContain('MCP_ALLOW_INSECURE_DEV=1');
    assertNoSecrets(logged);
  });

  it('exits when the secret is whitespace and the dev flag is not exactly 1', async () => {
    process.env.CONDUIT_S2S_SECRET = '   ';
    process.env.MCP_ALLOW_INSECURE_DEV = 'true';
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.MCP_HTTP_PORT = '0';

    const logs = captureStderr();
    installExitSpy();
    await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
    expect(logs.text()).toContain('CONDUIT_S2S_SECRET is empty');
  });

  it.each([
    'replace-with-a-real-secret',
    'changeme',
    'secret',
    'your-s2s-secret',
    '  Your-Secret  ',
    '${CONDUIT_S2S_SECRET}',
  ])('refuses known placeholder %j and does not log it', async (placeholder) => {
    process.env.CONDUIT_S2S_SECRET = placeholder;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.MCP_HTTP_PORT = '0';

    const logs = captureStderr();
    const exitSpy = installExitSpy();
    await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const logged = logs.text();
    const staticMessage =
      'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. ' +
      'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.';
    expect(logged).toContain(staticMessage);
    expect(logged.replaceAll(staticMessage, '')).not.toContain(placeholder.trim());
  });

  it('refuses a placeholder even when MCP_ALLOW_INSECURE_DEV=1', async () => {
    process.env.CONDUIT_S2S_SECRET = '  Change-Me  ';
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.MCP_HTTP_PORT = '0';

    const logs = captureStderr();
    installExitSpy();
    await expect(startHttpTransport()).rejects.toThrow('process.exit:1');
    expect(logs.text()).toContain('CONDUIT_S2S_SECRET is a known placeholder');
    expect(logs.text()).not.toContain('Change-Me');
  });

  it('starts with a warning and binds 127.0.0.1 when MCP_ALLOW_INSECURE_DEV=1', async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    delete process.env.MCP_HTTP_HOST;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.AUTH_MODE = 'gateway';
    useCredentialEnv();

    const logs = captureStderr();
    const exitSpy = installExitSpy();
    const server = await listen();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(server.address).toBe('127.0.0.1');
    const logged = logs.text();
    expect(logged).toContain('SECURITY WARNING');
    expect(logged).toContain('MCP_ALLOW_INSECURE_DEV=1');
    expect(logged).toContain('WITHOUT service-to-service authentication');
    expect(logged).toContain('127.0.0.1');
    expect(logged).not.toContain('not a loopback address');
    assertNoSecrets(logged);
  });

  it('forces 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is not loopback', async () => {
    delete process.env.CONDUIT_S2S_SECRET;
    process.env.MCP_ALLOW_INSECURE_DEV = '1';
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    process.env.AUTH_MODE = 'gateway';

    const logs = captureStderr();
    const exitSpy = installExitSpy();
    const server = await listen();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(server.address).toBe('127.0.0.1');
    const logged = logs.text();
    expect(logged).toContain('MCP_HTTP_HOST=0.0.0.0 is not a loopback address');
    expect(logged).toContain('Binding 127.0.0.1 only');
    assertNoSecrets(logged);
  });

  it('honors a non-loopback MCP_HTTP_HOST when CONDUIT_S2S_SECRET is set', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    process.env.MCP_HTTP_HOST = '0.0.0.0';
    process.env.AUTH_MODE = 'gateway';

    const logs = captureStderr();
    const server = await listen();

    expect(server.address).toBe('0.0.0.0');
    expect(logs.text()).not.toContain('not a loopback address');
    assertNoSecrets(logs.text());
  });

  it('defaults to 127.0.0.1 when a secret is set and MCP_HTTP_HOST is unset', async () => {
    process.env.CONDUIT_S2S_SECRET = `  ${S2S_SECRET}  `;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    delete process.env.MCP_HTTP_HOST;
    process.env.AUTH_MODE = 'gateway';

    const logs = captureStderr();
    const server = await listen();

    expect(server.address).toBe('127.0.0.1');
    assertNoSecrets(logs.text());
  });
});

describe('gateway /mcp auth', () => {
  async function startGateway(): Promise<number> {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.AUTH_MODE = 'gateway';
    useCredentialEnv();
    const server = await listen();
    return server.port;
  }

  it('returns 401 when the S2S header is missing or invalid and does not read credentials', async () => {
    const logs = captureStderr();
    const credsSpy = vi.spyOn(client, 'getCredentials');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const port = await startGateway();
    credsSpy.mockClear();

    const credentialHeaders = {
      'x-msp360-username': 'header-user',
      'x-msp360-password': 'header-pass',
    };

    const missing = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders(credentialHeaders),
      body: companiesCall,
    });
    expect(missing.status).toBe(401);
    expect(missing.body).toContain('X-Gateway-S2S');
    assertNoSecrets(missing.body);

    const invalid = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        ...credentialHeaders,
        'x-gateway-s2s': mintS2sHeader('wrong-secret'),
      }),
      body: companiesCall,
    });
    expect(invalid.status).toBe(401);
    expect(invalid.body).toContain('X-Gateway-S2S');
    expect(credsSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    assertNoSecrets(logs.text());
  });

  it('returns 401 in gateway mode without credential headers and does not use env credentials', async () => {
    const credsSpy = vi.spyOn(client, 'getCredentials');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const port = await startGateway();
    credsSpy.mockClear();

    const response = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: companiesCall,
    });
    expect(response.status).toBe(401);
    const body = JSON.parse(response.body) as { error?: string };
    expect(body.error).toContain('X-MSP360-Username');
    expect(body.error).toContain('X-MSP360-Password');
    assertNoSecrets(response.body);
    expect(credsSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const partial = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
        'x-msp360-username': 'header-user',
      }),
      body: companiesCall,
    });
    expect(partial.status).toBe(401);
    expect(credsSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    assertNoSecrets(partial.body);
  });

  it('accepts a valid S2S header plus credential headers and uses those credentials', async () => {
    const logs = captureStderr();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-header' }))
      .mockResolvedValueOnce(jsonResponse([{ Id: 'c1', Name: 'Header Co' }]));
    const port = await startGateway();

    const response = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({
        'x-gateway-s2s': mintS2sHeader(S2S_SECRET),
        'x-msp360-username': 'header-user',
        'x-msp360-password': 'header-pass',
      }),
      body: companiesCall,
    });

    expect(response.status).toBe(200);
    const payload = JSON.parse(response.body) as {
      result?: { content?: Array<{ text?: string }> };
    };
    expect(payload.result?.content?.[0]?.text).toContain('Header Co');
    expect(loginUserName(fetchMock)).toBe('header-user');
    const loginBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
    expect(loginBody).toContain('header-pass');
    expect(loginBody).not.toContain(ENV_USERNAME);
    expect(loginBody).not.toContain(ENV_PASSWORD);
    assertNoSecrets(response.body);
    assertNoSecrets(logs.text());
  });

  it('serves /health without authentication and without reading credentials', async () => {
    const credsSpy = vi.spyOn(client, 'getCredentials');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const port = await startGateway();
    credsSpy.mockClear();

    const response = await sendHttp({
      port,
      method: 'GET',
      path: '/health',
    });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as { status?: string; mode?: string; credentials?: unknown };
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('gateway');
    expect(body.credentials).toBeUndefined();
    assertNoSecrets(response.body);
    expect(credsSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('env-mode HTTP still requires S2S', () => {
  it('uses MSP360_* after a valid S2S header', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.AUTH_MODE = 'env';
    useCredentialEnv();

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-env' }))
      .mockResolvedValueOnce(jsonResponse([{ Id: 'c1', Name: 'Env Co' }]));

    const port = (await listen()).port;
    const response = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders({ 'x-gateway-s2s': mintS2sHeader(S2S_SECRET) }),
      body: companiesCall,
    });

    expect(response.status).toBe(200);
    expect(loginUserName(fetchMock)).toBe(ENV_USERNAME);
    expect(response.body).toContain('Env Co');
    expect(response.body).not.toContain(S2S_SECRET);
  });

  it('returns 401 when the S2S header is missing before reading env credentials', async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    delete process.env.MCP_ALLOW_INSECURE_DEV;
    process.env.MCP_HTTP_HOST = '127.0.0.1';
    process.env.AUTH_MODE = 'env';
    useCredentialEnv();

    const credsSpy = vi.spyOn(client, 'getCredentials');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const port = (await listen()).port;
    credsSpy.mockClear();

    const response = await sendHttp({
      port,
      method: 'POST',
      path: '/mcp',
      headers: mcpHeaders(),
      body: companiesCall,
    });
    expect(response.status).toBe(401);
    expect(response.body).toContain('X-Gateway-S2S');
    expect(credsSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    assertNoSecrets(response.body);
  });
});
