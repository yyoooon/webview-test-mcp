import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/tools/wait.js';
import * as stateModule from '../../src/state.js';

describe('webview_wait_for handler (in-page polling)', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('resolves in a SINGLE CDP round-trip when condition holds', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: true } }) };
    stateModule.state.cdp = fakeCdp as any;
    const result = await handler({ selector: '#target' });
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toContain('조건 충족');
    // the whole wait runs in-page → exactly one evaluate, not per-poll round-trips
    expect(fakeCdp.send).toHaveBeenCalledTimes(1);
    const call = fakeCdp.send.mock.calls[0];
    expect(call[0]).toBe('Runtime.evaluate');
    expect(call[1].awaitPromise).toBe(true);
  });

  it('returns error when no condition provided', async () => {
    stateModule.state.cdp = { connected: true, send: vi.fn() } as any;
    const result = await handler({});
    expect(result.isError).toBe(true);
  });

  it('times out when condition never met (single chunk, one round-trip)', async () => {
    // real browser blocks in-page for the chunk budget then returns false; simulate with a delayed resolve
    const fakeCdp = {
      connected: true,
      send: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r({ result: { value: false } }), 30))),
    };
    stateModule.state.cdp = fakeCdp as any;
    const result = await handler({ selector: '#never', timeout: 10 });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('시간 초과');
    expect(fakeCdp.send).toHaveBeenCalledTimes(1);
  });

  it('role condition targets a visible [role=x] element', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: true } }) };
    stateModule.state.cdp = fakeCdp as any;
    const result = await handler({ role: 'dialog' });
    expect(result.isError).toBeUndefined();
    const expr = fakeCdp.send.mock.calls[0][1].expression as string;
    expect(expr).toContain('role=');
    expect(expr).toContain('dialog');
    expect((result.content[0] as { text: string }).text).toContain('dialog');
  });

  it('gone condition tests for absence/invisibility', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: true } }) };
    stateModule.state.cdp = fakeCdp as any;
    const result = await handler({ gone: '[role=dialog]' });
    expect(result.isError).toBeUndefined();
    const expr = fakeCdp.send.mock.calls[0][1].expression as string;
    expect(expr).toContain('[role=dialog]');
    expect(expr).toMatch(/!el|! *\(/);
  });
});
