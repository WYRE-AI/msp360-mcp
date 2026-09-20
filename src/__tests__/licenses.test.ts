import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLicensesTool } from '../tools/licenses.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handleLicensesTool', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('msp360_list_licenses lists all licenses when isAvailable is omitted', async () => {
    const creds = { username: 'u-lic-1', password: 'p-lic-1' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-lic-1' }))
      .mockResolvedValueOnce(jsonResponse([{ ID: 'lic1', IsTaken: false }]));

    const result = await runWithCredentials(creds, () => handleLicensesTool('msp360_list_licenses', {}));

    expect(textOf(result)).toContain('lic1');
    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Licenses');
  });

  it('msp360_list_licenses passes isAvailable as a query param', async () => {
    const creds = { username: 'u-lic-2', password: 'p-lic-2' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-lic-2' }))
      .mockResolvedValueOnce(jsonResponse([]));

    await runWithCredentials(creds, () => handleLicensesTool('msp360_list_licenses', { isAvailable: true }));

    const url = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url.pathname).toBe('/api/Licenses');
    expect(url.searchParams.get('isAvailable')).toBe('true');
  });

  it('msp360_get_license requires an id', async () => {
    const creds = { username: 'u-lic-3', password: 'p-lic-3' };
    const result = await runWithCredentials(creds, () => handleLicensesTool('msp360_get_license', {}));
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_get_license fetches the license by id', async () => {
    const creds = { username: 'u-lic-4', password: 'p-lic-4' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-lic-4' }))
      .mockResolvedValueOnce(jsonResponse({ ID: 'lic4', LicenseType: 'Server' }));

    const result = await runWithCredentials(creds, () => handleLicensesTool('msp360_get_license', { id: 'lic4' }));

    expect(textOf(result)).toContain('Server');
    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Licenses/lic4');
  });
});
