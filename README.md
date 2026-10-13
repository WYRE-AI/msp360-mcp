# MSP360 MCP Server

MCP server for [MSP360](https://www.msp360.com/)'s Managed Backup Service API (formerly CloudBerry Lab) - companies, managed computers, backup plans, monitoring, and licenses, for AI assistants and the WYRE Conduit gateway.

## Authentication

Provide the Managed Backup Service provider-portal `UserName`/`Password` pair. This server exchanges it for a short-lived bearer token via `POST /api/Provider/Login` and caches it, re-authenticating automatically whenever the vendor rejects the cached token (HTTP 401) - callers only ever need to supply the long-lived username/password.

## Configuration

Copy [`.env.example`](.env.example) and set the variables below. Leave `CONDUIT_S2S_SECRET` empty in that file.

| Env var | Required | Description |
|---|---|---|
| `MSP360_USERNAME` | For stdio and `AUTH_MODE=env` | MSP360 provider-portal username. |
| `MSP360_PASSWORD` | For stdio and `AUTH_MODE=env` | MSP360 provider-portal password. |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http`. |
| `MCP_HTTP_HOST` | No | Bind address when `MCP_TRANSPORT=http`. Defaults to `127.0.0.1`. A configured `CONDUIT_S2S_SECRET` honors this value. The container image sets `0.0.0.0`. |
| `MCP_HTTP_PORT` | No | HTTP port. Defaults to `8080`. |
| `AUTH_MODE` | No | `env` (default) or `gateway`. Gateway mode requires `X-MSP360-Username` and `X-MSP360-Password` on each `/mcp` request and does not fall back to `MSP360_*`. `env` uses those variables after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `placeholder`, `your-s2s-secret`, `secret`, `password`, `test`, and unresolved `${...}` templates). Compose will not start when it is unset. Never commit a real value. |
| `MCP_ALLOW_INSECURE_DEV` | No | Set to `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning, does not enforce `X-Gateway-S2S`, and listens on `127.0.0.1` only (a wider `MCP_HTTP_HOST` is overridden). A placeholder secret is still refused. |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, or `error`. |

`/health` stays unauthenticated and does not read MSP360 credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### X-Gateway-S2S signing

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. The header value is:

```text
t=<unix seconds>,v1=<hex hmac-sha256>
```

`v1` is HMAC-SHA256 (hex, lowercase) of the ASCII string `t=<unix seconds>`, keyed with `CONDUIT_S2S_SECRET`. The timestamp must be within 300 seconds of the server clock. A missing or invalid header returns 401. The process never writes the secret to logs.

```text
X-Gateway-S2S: t=1710000000,v1=<hmac-sha256("t=1710000000")>
```

Generate a secret with `openssl rand -hex 32`.

In `AUTH_MODE=gateway`, `/mcp` also requires `X-MSP360-Username` and `X-MSP360-Password`. Those headers are the only credential source for that request. A request missing either header returns 401 and does not read `MSP360_USERNAME` or `MSP360_PASSWORD` from the environment.

## Tools

### Companies
- `msp360_list_companies` - list companies (customer organizations) under this provider account.
- `msp360_get_company` - get a single company by ID.

### Computers
- `msp360_list_computers` - paginated list of managed computers (endpoints).
- `msp360_get_computer` - get a single computer by HID.

### Backup Plans
- `msp360_list_plans` - list backup/restore plans on a computer.
- `msp360_get_plan` - get a single plan by ID.
- `msp360_get_plan_info` - get status/info for a plan.
- `msp360_get_plan_history` - get run history for a plan, optionally filtered to a date.
- `msp360_start_plan` - start a backup run for a plan.
- `msp360_stop_plan` - stop a currently running backup for a plan.

### Monitoring
- `msp360_get_monitoring` - status data for the latest plan runs on all endpoints.
- `msp360_get_monitoring_for_user` - status data for the latest plan runs, filtered by user.

### Licenses
- `msp360_list_licenses` - list available licenses, optionally filtered to unassigned ones.
- `msp360_get_license` - get a single license by ID.

## Scope

This is a v1 / MVP surface covering the core "what's backed up and is it healthy" MSP workflow. Explicitly out of scope for now: Administrators, Billing, Builds, Packages, Destinations/Accounts (storage-provisioning config), Users/Authenticate, and License Grant/Release/Revoke (mutating license assignment) and computer authorization/de-authorization - these are provider/reseller-admin-console-level operations with real billing/access consequences, distinct from day-to-day MSP monitoring, and worth a deliberate separate decision later rather than bundling into v1.

## Development

```bash
npm install
npm run build
npm test
npm run lint   # tsc --noEmit
```

HTTP refuses to start until `CONDUIT_S2S_SECRET` is set:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" npm run start:http
```

Local HTTP without a secret is development-only. It binds `127.0.0.1` and logs a warning:

```bash
MCP_ALLOW_INSECURE_DEV=1 npm run start:http
```

## Docker

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, MSP360 credentials arrive on each request as `X-MSP360-Username` and `X-MSP360-Password`. They are not read from the environment.

```bash
docker build -t msp360-mcp .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  msp360-mcp
```

The checked-in Compose service is gateway mode. It does not set `MSP360_USERNAME` or `MSP360_PASSWORD` and does not use `env_file`, so a project `.env` cannot inject static vendor credentials into the container. Compose still interpolates `CONDUIT_S2S_SECRET` and `LOG_LEVEL` from that file. It refuses to start when `CONDUIT_S2S_SECRET` is unset and publishes `127.0.0.1:8080:8080`. Every `/mcp` request must carry `X-Gateway-S2S` (see [X-Gateway-S2S signing](#x-gateway-s2s-signing)) plus the credential headers.

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `MSP360_USERNAME` and `MSP360_PASSWORD`:

```bash
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e MSP360_USERNAME=your-username \
  -e MSP360_PASSWORD=your-password \
  -p 127.0.0.1:8080:8080 \
  msp360-mcp
```
