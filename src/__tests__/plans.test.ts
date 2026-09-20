import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlansTool } from '../tools/plans.js';
import { runWithCredentials } from '../client.js';
import { jsonResponse, textOf } from './test-helpers.js';

describe('handlePlansTool', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('msp360_list_plans requires hid', async () => {
    const creds = { username: 'u-plan-1', password: 'p-plan-1' };
    const result = await runWithCredentials(creds, () => handlePlansTool('msp360_list_plans', {}));
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_list_plans requests the Plans path for a computer', async () => {
    const creds = { username: 'u-plan-2', password: 'p-plan-2' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-plan-2' }))
      .mockResolvedValueOnce(jsonResponse({ plans: [{ Id: 'p1' }] }));

    const result = await runWithCredentials(creds, () => handlePlansTool('msp360_list_plans', { hid: 'h1' }));

    expect(textOf(result)).toContain('p1');
    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/h1/Plans');
  });

  it('msp360_get_plan requires hid and id', async () => {
    const creds = { username: 'u-plan-3', password: 'p-plan-3' };
    const missingId = await runWithCredentials(creds, () => handlePlansTool('msp360_get_plan', { hid: 'h1' }));
    expect(missingId.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('msp360_get_plan_info requests the info sub-path', async () => {
    const creds = { username: 'u-plan-4', password: 'p-plan-4' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-plan-4' }))
      .mockResolvedValueOnce(jsonResponse({ Status: 0 }));

    await runWithCredentials(creds, () => handlePlansTool('msp360_get_plan_info', { hid: 'h1', id: 'p1' }));

    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/h1/Plans/p1/info');
  });

  it('msp360_get_plan_history includes optional date query params', async () => {
    const creds = { username: 'u-plan-5', password: 'p-plan-5' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-plan-5' }))
      .mockResolvedValueOnce(jsonResponse({ runs: [] }));

    await runWithCredentials(creds, () =>
      handlePlansTool('msp360_get_plan_history', { hid: 'h1', id: 'p1', year: 2026, month: 9, day: 20 })
    );

    const url = new URL(fetchMock.mock.calls[1][0] as string);
    expect(url.pathname).toBe('/api/Computers/h1/Plans/p1/history');
    expect(url.searchParams.get('date.year')).toBe('2026');
    expect(url.searchParams.get('date.month')).toBe('9');
    expect(url.searchParams.get('date.day')).toBe('20');
  });

  it('msp360_get_plan_history omits query params when no date is given', async () => {
    const creds = { username: 'u-plan-6', password: 'p-plan-6' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-plan-6' }))
      .mockResolvedValueOnce(jsonResponse({ runs: [] }));

    await runWithCredentials(creds, () => handlePlansTool('msp360_get_plan_history', { hid: 'h1', id: 'p1' }));

    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/h1/Plans/p1/history');
  });

  it('msp360_start_plan POSTs the Mode body', async () => {
    const creds = { username: 'u-plan-7', password: 'p-plan-7' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-plan-7' }))
      .mockResolvedValueOnce(jsonResponse({ Started: true }));

    const result = await runWithCredentials(creds, () =>
      handlePlansTool('msp360_start_plan', { hid: 'h1', id: 'p1', mode: 'Full' })
    );

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/h1/Plans/p1/start');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ Mode: 'Full' });
  });

  it('msp360_stop_plan POSTs the Force body', async () => {
    const creds = { username: 'u-plan-8', password: 'p-plan-8' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'tok-plan-8' }))
      .mockResolvedValueOnce(jsonResponse({ Stopped: true }));

    const result = await runWithCredentials(creds, () =>
      handlePlansTool('msp360_stop_plan', { hid: 'h1', id: 'p1', force: true })
    );

    expect(result.isError).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.mspbackups.com/api/Computers/h1/Plans/p1/stop');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ Force: true });
  });
});
