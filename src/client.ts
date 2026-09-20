import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from './utils/logger.js';
import type {
  CompanyModel,
  LicenseModel,
  LoginResponse,
  MonitoringModel,
  Msp360Credentials,
  UntypedVendorResponse,
} from './types.js';

export const BASE_URL = 'https://api.mspbackups.com';

// Request-scoped credential store. In gateway mode the HTTP layer runs each
// request inside runWithCredentials({username, password}); getCredentials()
// reads from it. Falls back to process.env for stdio/single-tenant mode.
const credStore = new AsyncLocalStorage<Msp360Credentials>();

export function runWithCredentials<T>(creds: Msp360Credentials, fn: () => T): T {
  return credStore.run(creds, fn);
}

export function getCredentials(): Msp360Credentials | null {
  const scoped = credStore.getStore();
  if (scoped?.username && scoped?.password) return scoped;
  const username = process.env.MSP360_USERNAME;
  const password = process.env.MSP360_PASSWORD;
  if (!username || !password) {
    logger.warn('Missing credentials', { hasUsername: !!username, hasPassword: !!password });
    return null;
  }
  return { username, password };
}

/** Thrown when the vendor API rejects the current bearer token - triggers exactly one re-login-and-retry in withToken(). */
export class Msp360AuthError extends Error {}

/** Thrown for any other non-2xx / unexpected vendor response. */
export class Msp360ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

// Keyed by JSON.stringify([username, password]) so multiple tenants sharing
// one gateway process (AsyncLocalStorage swaps credentials per request)
// never cross-pollinate cached tokens - a colon-join (`${username}:${password}`)
// would collapse two distinct tenants onto the same cache key whenever a
// colon appears inside either credential value, which MSP360's API does not
// rule out for either field.
const tokenCache = new Map<string, string>();

function cacheKeyFor(creds: Msp360Credentials): string {
  return JSON.stringify([creds.username, creds.password]);
}

/**
 * Exchange the provider-portal username/password for a bearer token via
 * POST /api/Provider/Login. MSP360's docs describe the result as a
 * "temporary Access Token" without stating an exact TTL ("re-authenticate as
 * needed"), so this server does not attempt to track an expiry - it caches
 * the token and only re-logs-in when the vendor actually rejects it
 * (HTTP 401), via withToken() below.
 */
export async function login(creds: Msp360Credentials): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/Provider/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ UserName: creds.username, Password: creds.password }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Msp360AuthError(`MSP360 rejected credentials: HTTP ${res.status}`);
    }
    throw new Msp360ApiError(`MSP360 Login failed: HTTP ${res.status}`, res.status);
  }

  const data = (await res.json()) as LoginResponse;
  if (!data.access_token) {
    throw new Msp360AuthError('MSP360 Login succeeded but returned no access_token');
  }
  return data.access_token;
}

async function getToken(creds: Msp360Credentials, forceRefresh = false): Promise<string> {
  const key = cacheKeyFor(creds);
  const cached = tokenCache.get(key);
  if (!forceRefresh && cached) return cached;
  const fresh = await login(creds);
  tokenCache.set(key, fresh);
  return fresh;
}

/**
 * Runs `fn` with a fresh/cached bearer token, and retries it exactly once
 * with a forced re-login if `fn` throws Msp360AuthError (the vendor rejected
 * the token - expired or otherwise invalid). Every real API call in this
 * file goes through this wrapper so the refresh logic lives in one place.
 */
async function withToken<T>(creds: Msp360Credentials, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getToken(creds);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof Msp360AuthError) {
      logger.warn('Bearer token rejected mid-call, re-logging in and retrying once');
      const refreshed = await getToken(creds, true);
      return await fn(refreshed);
    }
    throw err;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function doGet<T>(path: string, query: URLSearchParams | undefined, token: string): Promise<T> {
  const qs = query && query.toString() ? `?${query.toString()}` : '';
  const res = await fetch(`${BASE_URL}${path}${qs}`, {
    method: 'GET',
    headers: authHeaders(token),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Msp360AuthError(`MSP360 rejected the bearer token (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Msp360ApiError(`MSP360 ${path} failed: HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

async function doPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Msp360AuthError(`MSP360 rejected the bearer token (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Msp360ApiError(`MSP360 ${path} failed: HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------

/** GET /api/Companies - list all companies under this provider account. */
export async function listCompanies(creds: Msp360Credentials): Promise<CompanyModel[]> {
  return withToken(creds, (token) => doGet<CompanyModel[]>('/api/Companies', undefined, token));
}

/** GET /api/Companies/{id} - a single company by ID. */
export async function getCompany(creds: Msp360Credentials, id: string): Promise<CompanyModel> {
  return withToken(creds, (token) => doGet<CompanyModel>(`/api/Companies/${encodeURIComponent(id)}`, undefined, token));
}

// ---------------------------------------------------------------------
// Computers
// ---------------------------------------------------------------------

/** GET /api/Computers/{offset}/{count} - paginated list of managed computers (endpoints). */
export async function listComputers(
  creds: Msp360Credentials,
  offset: number,
  count: number
): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doGet<UntypedVendorResponse>(
      `/api/Computers/${encodeURIComponent(String(offset))}/${encodeURIComponent(String(count))}`,
      undefined,
      token
    )
  );
}

/** GET /api/Computers/{hid} - a single computer by HID. */
export async function getComputer(creds: Msp360Credentials, hid: string): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doGet<UntypedVendorResponse>(`/api/Computers/${encodeURIComponent(hid)}`, undefined, token)
  );
}

// ---------------------------------------------------------------------
// Backup Plans (per computer)
// ---------------------------------------------------------------------

/** GET /api/Computers/{hid}/Plans - list backup/restore plans on a computer. */
export async function listPlans(creds: Msp360Credentials, hid: string): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doGet<UntypedVendorResponse>(`/api/Computers/${encodeURIComponent(hid)}/Plans`, undefined, token)
  );
}

/** GET /api/Computers/{hid}/Plans/{id} - a single plan by ID. */
export async function getPlan(creds: Msp360Credentials, hid: string, id: string): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doGet<UntypedVendorResponse>(
      `/api/Computers/${encodeURIComponent(hid)}/Plans/${encodeURIComponent(id)}`,
      undefined,
      token
    )
  );
}

/** GET /api/Computers/{hid}/Plans/{id}/info - status/info for a plan. */
export async function getPlanInfo(creds: Msp360Credentials, hid: string, id: string): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doGet<UntypedVendorResponse>(
      `/api/Computers/${encodeURIComponent(hid)}/Plans/${encodeURIComponent(id)}/info`,
      undefined,
      token
    )
  );
}

/** GET /api/Computers/{hid}/Plans/{id}/history - run history for a plan, optionally filtered to a date. */
export async function getPlanHistory(
  creds: Msp360Credentials,
  hid: string,
  id: string,
  date?: { year?: number; month?: number; day?: number }
): Promise<UntypedVendorResponse> {
  const query = new URLSearchParams();
  if (date?.year !== undefined) query.set('date.year', String(date.year));
  if (date?.month !== undefined) query.set('date.month', String(date.month));
  if (date?.day !== undefined) query.set('date.day', String(date.day));
  return withToken(creds, (token) =>
    doGet<UntypedVendorResponse>(
      `/api/Computers/${encodeURIComponent(hid)}/Plans/${encodeURIComponent(id)}/history`,
      query,
      token
    )
  );
}

/** POST /api/Computers/{hid}/Plans/{id}/start - start a backup run for a plan. */
export async function startPlan(
  creds: Msp360Credentials,
  hid: string,
  id: string,
  mode?: string
): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doPost<UntypedVendorResponse>(
      `/api/Computers/${encodeURIComponent(hid)}/Plans/${encodeURIComponent(id)}/start`,
      { Mode: mode },
      token
    )
  );
}

/** POST /api/Computers/{hid}/Plans/{id}/stop - stop a running backup for a plan. */
export async function stopPlan(
  creds: Msp360Credentials,
  hid: string,
  id: string,
  force?: boolean
): Promise<UntypedVendorResponse> {
  return withToken(creds, (token) =>
    doPost<UntypedVendorResponse>(
      `/api/Computers/${encodeURIComponent(hid)}/Plans/${encodeURIComponent(id)}/stop`,
      { Force: force },
      token
    )
  );
}

// ---------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------

/** GET /api/Monitoring - status data for the latest plan runs on all endpoints (all users). */
export async function getMonitoring(creds: Msp360Credentials): Promise<MonitoringModel[]> {
  return withToken(creds, (token) => doGet<MonitoringModel[]>('/api/Monitoring', undefined, token));
}

/** GET /api/Monitoring/{userId} - status data for the latest plan runs, filtered by user. */
export async function getMonitoringForUser(creds: Msp360Credentials, userId: string): Promise<MonitoringModel[]> {
  return withToken(creds, (token) =>
    doGet<MonitoringModel[]>(`/api/Monitoring/${encodeURIComponent(userId)}`, undefined, token)
  );
}

// ---------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------

/** GET /api/Licenses - list available licenses, optionally filtered to unassigned ones. */
export async function listLicenses(creds: Msp360Credentials, isAvailable?: boolean): Promise<LicenseModel[]> {
  const query = new URLSearchParams();
  if (isAvailable !== undefined) query.set('isAvailable', String(isAvailable));
  return withToken(creds, (token) => doGet<LicenseModel[]>('/api/Licenses', query, token));
}

/** GET /api/Licenses/{id} - a single license by ID. */
export async function getLicense(creds: Msp360Credentials, id: string): Promise<LicenseModel> {
  return withToken(creds, (token) => doGet<LicenseModel>(`/api/Licenses/${encodeURIComponent(id)}`, undefined, token));
}
