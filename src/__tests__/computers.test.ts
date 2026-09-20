import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleComputersTool } from '../tools/computers.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handleComputersTool', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('msp360_list_computers requires offset and count', async () => {
    const creds = { username: 'u-cmp-1', password: 'p-cmp-1' };
    const missingOffset = await runWithCredentials(creds, () =>
      handleComputersTool('msp360_list_computers', { count: 25 })
    );
    expect(missingOffset.isError).toBe(true);

    const missingCount = await runWithCredentials(creds, () =>
      handleComputersTool('msp360_list_computers', { offset: 0 })
    );
    expect(missingCount.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_list_computers requests the offset/count path', async () => {
    const creds = { username: 'u-cmp-2', password: 'p-cmp-2' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-cmp-2' }))
      .mockResolvedValueOnce(jsonResponse({ computers: [{ Hid: 'h1' }] }));

    const result = await runWithCredentials(creds, () =>
      handleComputersTool('msp360_list_computers', { offset: 10, count: 25 })
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('h1');
    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/10/25');
  });

  it('msp360_get_computer requires hid', async () => {
    const creds = { username: 'u-cmp-3', password: 'p-cmp-3' };
    const result = await runWithCredentials(creds, () => handleComputersTool('msp360_get_computer', {}));
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_get_computer requests the hid path', async () => {
    const creds = { username: 'u-cmp-4', password: 'p-cmp-4' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-cmp-4' }))
      .mockResolvedValueOnce(jsonResponse({ Hid: 'abc123', ComputerName: 'DESKTOP-1' }));

    const result = await runWithCredentials(creds, () => handleComputersTool('msp360_get_computer', { hid: 'abc123' }));

    expect(textOf(result)).toContain('DESKTOP-1');
    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/abc123');
  });
});
