import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../../src/tools/evaluate.js';
import * as stateModule from '../../src/state.js';

describe('webview_evaluate handler', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('evaluates sync expression and returns result', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { type: 'number', value: 42 } }) };
    stateModule.state.cdp = fakeCdp as any;
    const result = await handler({ expression: '21 * 2' });
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toContain('42');
  });

  it('evaluates async expression with awaitPromise', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ result: { type: 'string', value: 'done' } }) };
    stateModule.state.cdp = fakeCdp as any;
    await handler({ expression: 'await fetch("/api")' });
    expect(fakeCdp.send).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({ awaitPromise: true }));
  });

  it('returns exception details on JS error', async () => {
    const fakeCdp = { connected: true, send: vi.fn().mockResolvedValue({ exceptionDetails: { exception: { description: 'ReferenceError: foo is not defined' } } }) };
    stateModule.state.cdp = fakeCdp as any;
    const result = await handler({ expression: 'foo()' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('ReferenceError');
  });

  it('returns error when expression is empty', async () => {
    stateModule.state.cdp = { connected: true, send: vi.fn() } as any;
    const result = await handler({ expression: '' });
    expect(result.isError).toBe(true);
  });
});
