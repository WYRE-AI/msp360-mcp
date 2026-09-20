# MSP360 MCP Server

MCP server for [MSP360](https://www.msp360.com/)'s Managed Backup Service API (formerly CloudBerry Lab) - companies, managed computers, backup plans, monitoring, and licenses, for AI assistants and the WYRE Conduit gateway.

## Authentication

Provide the Managed Backup Service provider-portal `UserName`/`Password` pair. This server exchanges it for a short-lived bearer token via `POST /api/Provider/Login` and caches it, re-authenticating automatically whenever the vendor rejects the cached token (HTTP 401) - callers only ever need to supply the long-lived username/password.

## Configuration

| Env var | Description |
|---|---|
| `MSP360_USERNAME` | MSP360 provider-portal username. |
| `MSP360_PASSWORD` | MSP360 provider-portal password. |
| `MCP_TRANSPORT` | `stdio` (default) or `http`. |
| `AUTH_MODE` | `env` (default, reads the vars above) or `gateway` (credentials arrive per-request via `X-MSP360-Username` / `X-MSP360-Password` headers, injected by the Conduit gateway). |
| `CONDUIT_S2S_SECRET` | When set, the HTTP transport requires a valid `X-Gateway-S2S` header (Conduit sidecar auth) on every `/mcp` request. |
| `LOG_LEVEL` | `debug` \| `info` (default) \| `warn` \| `error`. |

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

## Docker

```bash
docker build -t msp360-mcp .
docker run -p 8080:8080 -e MSP360_USERNAME=... -e MSP360_PASSWORD=... msp360-mcp
```
