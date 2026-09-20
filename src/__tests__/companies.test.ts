import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleCompaniesTool } from '../tools/companies.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handleCompaniesTool', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('msp360_list_companies logs in then lists companies', async () => {
    const creds = { username: 'u-comp-1', password: 'p-comp-1' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-comp-1' }))
      .mockResolvedValueOnce(jsonResponse([{ Id: 'c1', Name: 'Acme Corp' }]));

    const result = await runWithCredentials(creds, () => handleCompaniesTool('msp360_list_companies', {}));

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Acme Corp');

    const [companiesUrl, companiesInit] = fetchMock.mock.calls[1];
    expect(companiesUrl).toBe('https://api.mspbackups.com/api/Companies');
    expect(companiesInit.headers.Authorization).toBe('Bearer tok-comp-1');
  });

  it('msp360_get_company requires an id', async () => {
    const creds = { username: 'u-comp-2', password: 'p-comp-2' };
    const result = await runWithCredentials(creds, () => handleCompaniesTool('msp360_get_company', {}));
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_get_company fetches the company by id', async () => {
    const creds = { username: 'u-comp-3', password: 'p-comp-3' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-comp-3' }))
      .mockResolvedValueOnce(jsonResponse({ Id: 'c3', Name: 'Beta LLC' }));

    const result = await runWithCredentials(creds, () => handleCompaniesTool('msp360_get_company', { id: 'c3' }));

    expect(textOf(result)).toContain('Beta LLC');
    const [companyUrl] = fetchMock.mock.calls[1];
    expect(companyUrl).toBe('https://api.mspbackups.com/api/Companies/c3');
  });

  it('returns an error result without calling fetch when credentials are missing', async () => {
    const result = await handleCompaniesTool('msp360_list_companies', {});
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
