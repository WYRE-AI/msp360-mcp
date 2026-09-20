import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMonitoring, login, listCompanies } from '../client.js';
import { jsonResponse } from './test-helpers.js';

describe('login', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts UserName/Password and returns the access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'tok-123' }));

    const token = await login({ username: 'user1', password: 'pass1' });

    expect(token).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mspbackups.com/api/Provider/Login');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.UserName).toBe('user1');
    expect(body.Password).toBe('pass1');
  });

  it('throws Msp360AuthError when the vendor returns 2xx with no access_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await expect(login({ username: 'user1', password: 'pass1' })).rejects.toThrow(/no access_token/);
  });

  it('throws on a 401/403 response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(login({ username: 'bad', password: 'bad' })).rejects.toThrow(/rejected credentials/);
  });

  it('throws Msp360ApiError on a non-auth non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(login({ username: 'user1', password: 'pass1' })).rejects.toThrow(/HTTP 500/);
  });
});

describe('listCompanies / getMonitoring - token caching, isolation, and refresh', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in once and embeds the bearer token in the Authorization header', async () => {
    const creds = { username: 'user-cache', password: 'pass-cache' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-cache-1' }))
      .mockResolvedValueOnce(jsonResponse([{ Id: 'c1', Name: 'Acme' }]));

    const result = await listCompanies(creds);

    expect(result[0].Name).toBe('Acme');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [companiesUrl, companiesInit] = fetchMock.mock.calls[1];
    expect(companiesUrl).toBe('https://api.mspbackups.com/api/Companies');
    expect(companiesInit.headers.Authorization).toBe('Bearer tok-cache-1');

    // A second call with the same credentials must reuse the cached token
    // rather than logging in again.
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await listCompanies(creds);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never shares a cached token between two tenants whose credentials would collide under a naive colon-join', async () => {
    // username="a:b"/password="c" and username="a"/password="b:c" both
    // concatenate to "a:b:c" under a plain `${a}:${b}` join — this guards the
    // actual cache-key encoding (JSON.stringify) against that collision.
    const tenantOne = { username: 'a:b', password: 'c' };
    const tenantTwo = { username: 'a', password: 'b:c' };

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-tenant-one' }))
      .mockResolvedValueOnce(jsonResponse([]));
    await listCompanies(tenantOne);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-tenant-two' }))
      .mockResolvedValueOnce(jsonResponse([]));
    await listCompanies(tenantTwo);

    // 4 total fetches (login+request per tenant) means tenant two did its own
    // login rather than reusing tenant one's cached token — a colon-join
    // collision would collapse this to 3.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, tenantTwoInit] = fetchMock.mock.calls[3];
    expect(tenantTwoInit.headers.Authorization).toBe('Bearer tok-tenant-two');
  });

  it('re-logs-in exactly once when the vendor rejects the token mid-call, then retries', async () => {
    const creds = { username: 'user-refresh', password: 'pass-refresh' };
    fetchMock
      // Initial login
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-stale' }))
      // First monitoring call: vendor says the token is invalid (HTTP 401)
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // Forced re-login
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-fresh' }))
      // Retried monitoring call succeeds
      .mockResolvedValueOnce(jsonResponse([{ ComputerName: 'PC1' }]));

    const result = await getMonitoring(creds);

    expect(result[0].ComputerName).toBe('PC1');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [, retriedInit] = fetchMock.mock.calls[3];
    expect(retriedInit.headers.Authorization).toBe('Bearer tok-fresh');
  });
});
