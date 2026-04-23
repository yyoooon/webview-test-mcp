import { describe, it, expect, beforeEach } from 'vitest';
import { state, resetState, isConnected, ensureConnected } from '../src/state.js';

describe('state', () => {
  beforeEach(() => resetState());

  it('isConnected returns false when no cdp client', () => {
    expect(isConnected()).toBe(false);
  });

  it('isConnected returns false when cdp exists but disconnected', () => {
    state.cdp = { connected: false } as any;
    expect(isConnected()).toBe(false);
  });

  it('isConnected returns true when cdp is connected', () => {
    state.cdp = { connected: true } as any;
    expect(isConnected()).toBe(true);
  });

  it('ensureConnected throws when not connected', async () => {
    await expect(ensureConnected()).rejects.toThrow(
      'WebView에 연결되어 있지 않습니다',
    );
  });

  it('ensureConnected returns cdp when connected', async () => {
    const fakeCdp = { connected: true } as any;
    state.cdp = fakeCdp;
    const result = await ensureConnected();
    expect(result).toBe(fakeCdp);
  });

  it('resetState clears all fields', () => {
    state.cdp = { connected: true } as any;
    state.deviceId = 'ABC';
    state.forwardedPort = 9222;
    state.socketName = 'test';
    resetState();
    expect(state.cdp).toBeNull();
    expect(state.deviceId).toBeNull();
    expect(state.forwardedPort).toBeNull();
    expect(state.socketName).toBeNull();
  });
});
