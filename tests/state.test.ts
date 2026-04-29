import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, resetState, isConnected, ensureConnected } from '../src/state.js';

vi.mock('../src/discovery.js', () => ({
  pickDevice: vi.fn(),
  pickSocket: vi.fn(),
}));
vi.mock('../src/adb.js', () => ({
  forwardPort: vi.fn(),
  removeForward: vi.fn(),
}));
vi.mock('../src/cdp.js', () => ({
  CdpClient: vi.fn().mockImplementation(() => ({
    connected: true,
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
  })),
}));

import * as discovery from '../src/discovery.js';
import * as adb from '../src/adb.js';

describe('state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

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

describe('ensureConnected — auto-discover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it('runs discovery when state empty', async () => {
    vi.mocked(discovery.pickDevice).mockResolvedValue({
      id: 'XYZ',
      state: 'device',
    } as any);
    vi.mocked(discovery.pickSocket).mockResolvedValue({
      pid: 1,
      socketName: 'sock',
    } as any);
    vi.mocked(adb.forwardPort).mockResolvedValue(9222 as any);
    const cdp = await ensureConnected();
    expect(cdp.connected).toBe(true);
    expect(discovery.pickDevice).toHaveBeenCalled();
    expect(discovery.pickSocket).toHaveBeenCalledWith('XYZ');
  });

  it('skips auto-discover when previous connection info present', async () => {
    state.forwardedPort = 9222;
    state.socketName = 'sock';
    await expect(ensureConnected()).resolves.toBeDefined();
    expect(discovery.pickDevice).not.toHaveBeenCalled();
  });

  it('propagates FlowError from discovery', async () => {
    const { FlowError, ErrorCode } = await import('../src/errors.js');
    vi.mocked(discovery.pickDevice).mockRejectedValue(
      new FlowError(ErrorCode.NO_DEVICE),
    );
    await expect(ensureConnected()).rejects.toMatchObject({
      code: ErrorCode.NO_DEVICE,
    });
  });
});
