import { describe, it, expect } from 'vitest';
import { parseDeviceList } from '../src/ios.js';

describe('parseDeviceList', () => {
  it('maps proxy frontend /json to {deviceId, port}', () => {
    const json = [{ deviceId: 'UDID-1', deviceName: 'iPhone', url: 'localhost:9331' }];
    expect(parseDeviceList(json)).toEqual([{ deviceId: 'UDID-1', port: 9331 }]);
  });
  it('returns [] for empty', () => {
    expect(parseDeviceList([])).toEqual([]);
  });
});
