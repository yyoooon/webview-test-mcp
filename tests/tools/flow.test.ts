import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flowHandler } from '../../src/tools/flow.js';
import * as stateModule from '../../src/state.js';

function makeFakeCdp(evalReturn: unknown) {
  return {
    connected: true,
    send: vi.fn().mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { value: evalReturn } });
      }
      return Promise.resolve({});
    }),
  };
}

describe('flowHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); stateModule.resetState(); });

  it('returns error when steps missing', async () => {
    stateModule.state.cdp = makeFakeCdp({}) as any;
    const result = await flowHandler({} as any);
    expect(result.isError).toBe(true);
  });

  it('runs compiled flow and returns marks', async () => {
    const fakeReturn = { marks: [{ i: 0, kind: 'sleep', ok: true, ms: 10 }], totalMs: 12 };
    stateModule.state.cdp = makeFakeCdp(fakeReturn) as any;
    const result = await flowHandler({ steps: [{ sleep: 10 }] });
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toMatchObject({ totalMs: 12 });
  });

  it('truncates oversized capture per outputMaxBytes', async () => {
    const big = 'x'.repeat(2000);
    const fakeReturn = { marks: [{ i: 0, kind: 'capture', ok: true, ms: 1 }], totalMs: 1, captured: { dialog: { text: big } } };
    stateModule.state.cdp = makeFakeCdp(fakeReturn) as any;
    const result = await flowHandler({ steps: [{ capture: { dialog: { text: true } } }], outputMaxBytes: 500 });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.__truncated).toBeDefined();
  });
});
