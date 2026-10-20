import { createServer as createHttpServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { runWithCredentials } from './client.js';
import { logger } from './utils/logger.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

/**
 * Public example values. A copied placeholder must not verify as a real
 * secret, and MCP_ALLOW_INSECURE_DEV does not bypass this list.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-real-secret',
  'your-s2s-secret',
  'your-secret',
  'your_s2s_secret',
  'changeme',
  'change-me',
  'change_me',
  'placeholder',
  'secret',
  'password',
  'test',
  'testing',
  'example',
  'dummy',
  'todo',
  'fixme',
  'replace-me',
  'replace_me',
  'xxx',
  'xxxx',
  'none',
  'null',
  'undefined',
  'conduit_s2s_secret',
  's2s-secret',
  's2s_secret',
  'set-me',
  'setme',
]);

/** Entire value is an unresolved template, e.g. `${CONDUIT_S2S_SECRET}`. */
const UNRESOLVED_TEMPLATE = /^\$\{.+\}$/;

const LOOPBACK_HOST = '127.0.0.1';

const MISSING_S2S_SECRET_ERROR =
  'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. ' +
  'An empty secret would accept unauthenticated /mcp requests (CWE-306). ' +
  'Set CONDUIT_S2S_SECRET to the gateway-provisioned service-to-service secret, ' +
  'or set MCP_ALLOW_INSECURE_DEV=1 to bypass this check for local development only.';

const PLACEHOLDER_S2S_SECRET_ERROR =
  'Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. ' +
  'Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.';

const INSECURE_DEV_WARNING =
  'SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. ' +
  'HTTP /mcp is starting WITHOUT service-to-service authentication and listens on 127.0.0.1 only. ' +
  'Do not use MCP_ALLOW_INSECURE_DEV outside local development.';

const S2S_UNAUTHORIZED = {
  error:
    'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
};

const GATEWAY_CREDENTIALS_UNAUTHORIZED = {
  error:
    'Unauthorized: missing required gateway credential headers X-MSP360-Username and X-MSP360-Password',
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function refuse(message: string): never {
  logger.error(message);
  process.exit(1);
}

/** Hosts that are already loopback. The insecure-dev bypass still binds 127.0.0.1. */
function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, '$1');
  if (normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1') {
    return true;
  }
  const bare = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
  const parts = bare.split('.');
  if (parts.length !== 4) return false;
  if (parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  return parts[0] === '127';
}

function isKnownPlaceholderSecret(secret: string): boolean {
  if (!secret) return false;
  if (UNRESOLVED_TEMPLATE.test(secret)) return true;
  return KNOWN_PLACEHOLDER_SECRETS.has(secret.toLowerCase());
}

/**
 * Secret for X-Gateway-S2S on /mcp. Read at HTTP startup, not module load.
 * Empty fails closed unless MCP_ALLOW_INSECURE_DEV=1. A known placeholder
 * always fails closed. The secret value is never written to logs.
 */
function resolveHttpS2sSecret(): string {
  const secret = (process.env.CONDUIT_S2S_SECRET ?? '').trim();
  if (isKnownPlaceholderSecret(secret)) {
    refuse(PLACEHOLDER_S2S_SECRET_ERROR);
  }
  if (secret) return secret;

  if (process.env.MCP_ALLOW_INSECURE_DEV === '1') {
    logger.error(INSECURE_DEV_WARNING);
    return '';
  }

  refuse(MISSING_S2S_SECRET_ERROR);
}

/**
 * No secret (insecure-dev bypass only): always 127.0.0.1, including when
 * MCP_HTTP_HOST is a wider address such as 0.0.0.0.
 * A configured secret honors MCP_HTTP_HOST. Unset defaults to 127.0.0.1.
 */
function resolveListenHost(s2sSecret: string): string {
  const configured = (process.env.MCP_HTTP_HOST ?? '').trim();
  if (s2sSecret) return configured || LOOPBACK_HOST;
  if (configured && !isLoopbackHost(configured)) {
    logger.error(
      `WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. ` +
        'MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. ' +
        `Binding ${LOOPBACK_HOST} only.`
    );
  }
  return LOOPBACK_HOST;
}

/**
 * Start the MSP360 MCP Streamable HTTP server.
 *
 * Fails closed: a missing, blank, or placeholder CONDUIT_S2S_SECRET logs an
 * error and calls process.exit(1) before anything listens, unless
 * MCP_ALLOW_INSECURE_DEV=1 is set, which skips X-Gateway-S2S and binds
 * 127.0.0.1 only. With a secret, every /mcp request must carry a valid
 * X-Gateway-S2S header; /health stays unauthenticated.
 *
 * @returns The listening `Server`, once `listen` has succeeded.
 * @throws Rejects with the bind error (for example EADDRINUSE or EACCES) if
 *   the port cannot be bound.
 */
export async function startHttpTransport(): Promise<Server> {
  const s2sSecret = resolveHttpS2sSecret();
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  // Loopback unless the operator opts into a wider bind. A wider bind is
  // honored only when CONDUIT_S2S_SECRET is set. The insecure-dev bypass
  // always listens on 127.0.0.1, including when the image sets 0.0.0.0.
  const host = resolveListenHost(s2sSecret);
  const isGatewayMode = process.env.AUTH_MODE === 'gateway';

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      // /health is container LIVENESS, not credential-readiness. In gateway
      // mode, credentials arrive per-request via X-MSP360-* headers, not at
      // startup. This handler must not read vendor credentials.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          transport: 'http',
          mode: isGatewayMode ? 'gateway' : 'standalone',
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', endpoints: ['/mcp', '/health'] }));
      return;
    }

    // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1;
    // startup refuses otherwise. A configured secret is always enforced,
    // before any credential extraction.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(S2S_UNAUTHORIZED));
      return;
    }

    const username = headerValue(req.headers['x-msp360-username']);
    const password = headerValue(req.headers['x-msp360-password']);

    // node:http does not await this listener. Catch a rejected connect or
    // handleRequest so one bad request cannot crash the process. The log
    // stays generic because error text can echo tenant credentials.
    const fail = (error: unknown): void => {
      logger.error('MCP request failed', { errorName: error instanceof Error ? error.name : typeof error });
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'Internal server error' }));
    };

    const handle = async () => {
      // SECURITY-CRITICAL invariant: this transport MUST stay stateless
      // (sessionIdGenerator: undefined + enableJsonResponse: true).
      // Per-request tenant credentials are carried in an AsyncLocalStorage
      // context opened by runWithCredentials() below. A stateless
      // request->single-response flow keeps the tool call inside that
      // context - switching to a stateful/SSE transport would let a
      // long-lived connection serve later messages under a stale/foreign
      // credential context.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    if (isGatewayMode) {
      // Gateway mode: credentials must arrive on every request via the
      // X-MSP360-Username and X-MSP360-Password headers. Reject explicitly
      // when either is missing. Falling through would resolve MSP360_* from
      // the process environment, which is not request-scoped.
      if (!username || !password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(GATEWAY_CREDENTIALS_UNAUTHORIZED));
        return;
      }
      await runWithCredentials({ username, password }, handle).catch(fail);
      return;
    }

    await handle().catch(fail);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      logger.info(`HTTP streaming server listening on ${host}:${port}`);
      resolve();
    });
  });

  return httpServer;
}

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint there. `node dist/http.js` still starts HTTP or stdio.
if (process.env.VITEST !== 'true') {
  if (process.env.MCP_TRANSPORT === 'http') {
    startHttpTransport().catch((error) => {
      logger.error('Fatal HTTP startup error', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
  } else {
    import('./index.js');
  }
}
