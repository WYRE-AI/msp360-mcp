import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMonitoringTool } from '../tools/monitoring.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handleMonitoringTool', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('msp360_get_monitoring lists account-wide status', async () => {
    const creds = { username: 'u-mon-1', password: 'p-mon-1' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-mon-1' }))
      .mockResolvedValueOnce(jsonResponse([{ ComputerName: 'PC1', Status: 0 }]));

    const result = await runWithCredentials(creds, () => handleMonitoringTool('msp360_get_monitoring', {}));

    expect(textOf(result)).toContain('PC1');
    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Monitoring');
  });

  it('msp360_get_monitoring_for_user requires userId', async () => {
    const creds = { username: 'u-mon-2', password: 'p-mon-2' };
    const result = await runWithCredentials(creds, () => handleMonitoringTool('msp360_get_monitoring_for_user', {}));
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_get_monitoring_for_user requests the userId sub-path', async () => {
    const creds = { username: 'u-mon-3', password: 'p-mon-3' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-mon-3' }))
      .mockResolvedValueOnce(jsonResponse([{ UserID: 'user-42' }]));

    await runWithCredentials(creds, () =>
      handleMonitoringTool('msp360_get_monitoring_for_user', { userId: 'user-42' })
    );

    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Monitoring/user-42');
  });
});
