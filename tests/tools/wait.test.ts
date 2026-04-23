import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handler } from '../../src/tools/wait.js';
import * as stateModule from '../../src/state.js';

describe('webview_wait_for handler', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves when selector found immediately', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: true } }) };
    stateModule.state.cdp = fakeCdp as any;
    const resultPromise = handler({ selector: '#target' });
    await vi.advanceTimersByTimeAsync(0);
    const result = await resultPromise;
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toContain('조건 충족');
  });

  it('resolves when expression becomes truthy after polling', async () => {
    let callCount = 0;
    const fakeCdp = { connected: true, send: vi.fn().mockImplementation(() => { callCount++; return Promise.resolve({ result: { value: callCount >= 3 } }); }) };
    stateModule.state.cdp = fakeCdp as any;
    const resultPromise = handler({ expression: 'window.ready === true', timeout: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result.isError).toBeUndefined();
  });

  it('returns error when neither selector nor expression provided', async () => {
    stateModule.state.cdp = { connected: true, send: vi.fn() } as any;
    const result = await handler({});
    expect(result.isError).toBe(true);
  });

  it('times out when condition never met', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { value: false } }) };
    stateModule.state.cdp = fakeCdp as any;
    const resultPromise = handler({ selector: '#never', timeout: 1000 });
    await vi.advanceTimersByTimeAsync(1200);
    const result = await resultPromise;
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('시간 초과');
  });
});
