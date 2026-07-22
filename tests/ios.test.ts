import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseDeviceList, discoverIosPages } from '../src/ios.js';

describe('parseDeviceList', () => {
  it('maps proxy frontend /json to {deviceId, port}', () => {
    const json = [{ deviceId: 'UDID-1', deviceName: 'iPhone', url: 'localhost:9331' }];
    expect(parseDeviceList(json)).toEqual([{ deviceId: 'UDID-1', port: 9331 }]);
  });
  it('returns [] for empty', () => {
    expect(parseDeviceList([])).toEqual([]);
  });
});

describe('discoverIosPages', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('polls until pages appear', async () => {
    let deviceCall = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('9330')) {
        return { ok: true, json: async () => [{ deviceId: 'D', url: '127.0.0.1:9331' }] };
      }
      // device port: 첫 호출 빈 목록, 두 번째부터 페이지 있음
      deviceCall += 1;
      return { ok: true, json: async () => (deviceCall >= 2
        ? [{ url: 'https://x/', webSocketDebuggerUrl: 'ws://x/1' }]
        : []) };
    }));
    const { devicePort, pages } = await discoverIosPages(9330, 3000);
    expect(devicePort).toBe(9331);
    expect(pages).toHaveLength(1);
    expect(deviceCall).toBeGreaterThanOrEqual(2);
  });
});
